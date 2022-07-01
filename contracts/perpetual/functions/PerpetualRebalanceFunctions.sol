// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./PerpetualBaseFunctions.sol";
import "../interfaces/IPerpetualTradeLogic.sol";
import "../interfaces/IPerpetualUpdateLogic.sol";
import "../interfaces/IPerpetualGetter.sol";
import "../interfaces/IPerpetualMarginLogic.sol";
import "../interfaces/IPerpetualMarginViewLogic.sol";

contract PerpetualRebalanceFunctions is PerpetualBaseFunctions {
    using ABDKMath64x64 for int128;
    int128 private constant TWO_64x64 = 0x020000000000000000; //2

    /**
     * @notice Throw error if called outside.
     */
    modifier onlyThis() {
        require(msg.sender == address(this), "can't be invoked outside");
        _;
    }

    /**
     * @dev     Modifier can be called with a 0 perpId.
     *
     * @param   _iPerpetualId   perpetual id
     * @param   _iPoolIdx       pool index of that perpetual
     */
    modifier updateFundingAndPrices(bytes32 _iPerpetualId, uint16 _iPoolIdx) {
        // choose 'random' second perpetual in pool
        bytes32 otherPerpId;
        (_iPerpetualId, otherPerpId) = _selectPerpetualIds(_iPerpetualId, _iPoolIdx);
        _getUpdateLogic().updateFundingAndPricesBefore(_iPerpetualId, otherPerpId);
        _;
        _getUpdateLogic().updateFundingAndPricesAfter(_iPerpetualId, otherPerpId);
    }

    /**
     * @dev     Select current perpetual and a "random" other perpetual that will 
     *          be processed
     *
     * @param   _iPerpetualId   perpetual id
     * @param   _iPoolIdx       pool index of that perpetual
     */
    function _selectPerpetualIds(bytes32 _iPerpetualId, uint16 _iPoolIdx) internal view
        returns (bytes32, bytes32) 
    {
        require(_iPoolIdx > 0, "pool not found");
        LiquidityPoolData memory liquidityPool = liquidityPools[_iPoolIdx];
        require(liquidityPool.iPerpetualCount>0, "no perp in pool");
        uint16 idx = uint16(block.number % uint64(liquidityPool.iPerpetualCount));
        bytes32 otherPerpId = perpetualIds[liquidityPool.id][idx];
        // function can be called with a 0 perpId, if so, choose a
        // perpetual
        if (_iPerpetualId==bytes32(0)) {
            idx = (idx+1) % liquidityPool.iPerpetualCount;
            _iPerpetualId = perpetualIds[liquidityPool.id][idx];
        }
        return (_iPerpetualId, otherPerpId);
    }

    /**
     * @dev     To re-balance the AMM margin to the initial margin.
     *          Transfer margin between the perpetual and the various cash pools, then
     *          update the AMM's cash in perpetual margin account.
     *
     * @param   _perpetual The perpetual in the liquidity pool
     */
    function _rebalance(PerpetualData storage _perpetual) internal {
        if (_perpetual.state != PerpetualState.NORMAL) {
            return;
        }
        _equalizeAMMMargin(_perpetual);
        _rebalanceToTarget(_perpetual);
        // updating the mark price changes the markprice that is
        // used for margin calculation and hence the AMM initial
        // margin will not be exactly at initial margin rate
        _updateMarkPrice(_perpetual, uint64(block.timestamp));

        // update trade size that minimizes AMM risk
        _updateKStar(_perpetual);
    }

    /**
     * @dev     To re-balance the AMM pool to the target size.
     *          This aims that the AMM pool size is funded enough so prices and slippage are reasonable.
     *          Transfers collateral perpetual and the various cash pools.
     *
     * @param   _perpetual The perpetual in the liquidity pool
     */
    function _rebalanceToTarget(PerpetualData storage _perpetual) internal {
        int128 fBaselineTarget = _getPerpetualGetter().getUpdatedTargetAMMFundSize(_perpetual.id, true);
        // cases: stress target S, baseline target B (B>S), current AMM fund cash C
        // 1)  S...B...C
        // 2)  S...C...B
        // 3)  C...S...B
        LiquidityPoolData storage pool = liquidityPools[_perpetual.poolId];
        // if we are above baseline target, we update the stored target and make sure the target is baseline
        // 1) S...B...C: set baseline target
        // set target in liquidity pool and AMM data:
        bool isBaselineTarget = (_perpetual.fAMMFundCashCC > fBaselineTarget);
        int128 fStressTarget = isBaselineTarget ? int128(0) : _getPerpetualGetter().getUpdatedTargetAMMFundSize(_perpetual.id, false);
        // if !isBaselineTarget, we are below baseline target, two options (2) and (3)
        // 2) S...C...B
        //    set target in liquidity pool and AMM data:
        isBaselineTarget = isBaselineTarget || _perpetual.fAMMFundCashCC > fStressTarget;

        if (isBaselineTarget) {
            _getUpdateLogic().updateAMMTargetFundSize(_perpetual.id, fBaselineTarget);
            return;
        }
        // 3) C...S...B: set stress target
        _getUpdateLogic().updateAMMTargetFundSize(_perpetual.id, fStressTarget);

        // draw funds in relation to available size from default fund
        // If default fund is funded we withdraw at most 75%
        int128 fGap = fStressTarget.sub(_perpetual.fAMMFundCashCC);
        int128 maxDF = pool.fDefaultFundCashCC.mul(CEIL_AMT_FUND_WITHDRAWAL);
        int128 fGapFillDF = (fGap > maxDF) ? maxDF : fGap;
        fGap = fGap.sub(fGapFillDF);
        // draw funds from pnl participants who don't otherwise contribute to
        // the default fund
        int128 maxPnlPart = pool.fPnLparticipantsCashCC.mul(CEIL_AMT_FUND_WITHDRAWAL);
        int128 fGapFillPnlPart = (fGap > maxPnlPart) ? maxPnlPart : fGap;
        if (fGapFillPnlPart > 0) {
            _decreasePoolCash(pool, fGapFillPnlPart);
        }
        _decreaseDefaultFundCash(pool, fGapFillDF);
        // contribution to AMM pool is recorded in perpetual and the aggregated amount in the liq-pool
        int128 fAmountFromPools = fGapFillPnlPart.add(fGapFillDF);
        pool.fAMMFundCashCC = pool.fAMMFundCashCC.add(fAmountFromPools);
        _perpetual.fAMMFundCashCC = _perpetual.fAMMFundCashCC.add(fAmountFromPools);
        emit UpdateAMMFundCash(_perpetual.id, _perpetual.fAMMFundCashCC, pool.fAMMFundCashCC);
    }

    function _equalizeAMMMargin(PerpetualData storage _perpetual) internal {
        int128 rebalanceMargin = _getRebalanceMargin(_perpetual);
        if (rebalanceMargin > 0) {
            // from margin to pool
            _transferFromAMMMarginToPool(_perpetual, rebalanceMargin);
        } else {
            // from pool to margin
            // It's possible that there are not enough funds to draw from
            // in this case not the full margin will be replenished
            // (and emergency state is raised)
            _transferFromPoolToAMMMargin(_perpetual, rebalanceMargin.neg());
        }
    }

    /**
     * Update k*, the trade that would minimize the AMM risk.
     * Also updates fkStarSide = sign(-k*)
     * Set 0 in quanto case.
     * @param _perpetual  The reference of perpetual storage.
     */
    function _updateKStar(PerpetualData storage _perpetual) internal {
        AMMPerpLogic.CollateralCurrency ccy = _perpetual.eCollateralCurrency;
        MarginAccount memory AMMMarginAcc = marginAccounts[_perpetual.id][address(this)];
        int128 K2 = AMMMarginAcc.fPositionBC.neg();
        if (ccy == AMMPerpLogic.CollateralCurrency.BASE) {
            // M2 = perpetual.fAMMFundCashCC
            _perpetual.fkStar = _perpetual.fAMMFundCashCC.sub(K2);
        } else if (ccy == AMMPerpLogic.CollateralCurrency.QUOTE) {
            _perpetual.fkStar = K2.neg();
        } else {
            // M3 = perpetual.fAMMFundCashCC
            int128 s2 = oraclePriceData[_perpetual.oracleS2Addr].fPrice;
            int128 s3 = oraclePriceData[_perpetual.oracleS3Addr].fPrice;
            int128 nominator = _perpetual.fRho23.mul(_perpetual.fSigma2).mul(_perpetual.fSigma3).exp().sub(ONE_64x64);
            int128 denom = (_perpetual.fSigma2).mul(_perpetual.fSigma2).exp().sub(ONE_64x64);
            _perpetual.fkStar = s3.div(s2).mul(nominator.div(denom)).mul(_perpetual.fAMMFundCashCC).sub(K2);
        }
        _perpetual.fkStarSide = _perpetual.fkStar > 0 ? ONE_64x64 : ONE_64x64.neg();
    }

    /**
     * Get the margin to rebalance the AMM in the perpetual.
     * Margin to rebalance = margin - initial margin
     * @param   _perpetual The perpetual in the liquidity pool
     * @return  The margin to rebalance in the perpetual
     */
    function _getRebalanceMargin(PerpetualData memory _perpetual) internal view returns (int128) {
        int128 fInitialMargin = _getMarginViewLogic().getInitialMargin(_perpetual.id, address(this));
        return _getMarginViewLogic().getMarginBalance(_perpetual.id, address(this)).sub(fInitialMargin);
    }

    /**
     * Transfer a given amount from the AMM margin account to the
     * liq pools (AMM pool, participation fund).
     * @param   _perpetual   The reference of perpetual storage.
     * @param   _fAmount            signed 64.64-bit fixed point number.
     */
    function _transferFromAMMMarginToPool(PerpetualData storage _perpetual, int128 _fAmount) internal {
        if (_fAmount == 0) {
            return;
        }
        require(_fAmount > 0, "transferFromAMMMarginToPool expects positive amount");
        LiquidityPoolData storage pool = liquidityPools[_perpetual.poolId];
        // update margin of AMM
        _updateTraderMargin(_perpetual, address(this), _fAmount.neg());

        int128 fPnLparticipantAmount;
        int128 fAmmAmount;
        (fPnLparticipantAmount, fAmmAmount) = _splitAmount(pool, _fAmount, false);
        _increasePoolCash(pool, fPnLparticipantAmount);
        // increase AMM fund cash, and if AMM fund full then send to default fund
        _increaseAMMFundCashForPerpetual(_perpetual, fAmmAmount);
    }

    /**
     * Transfer a given amount from the liquidity pools (AMM+PnLparticipant) into the AMM margin account.
     * Margin to rebalance = margin - initial margin
     * @param   _perpetual   The reference of perpetual storage.
     * @param   _fAmount     Amount to transfer. Signed 64.64-bit fixed point number.
     * @return  The amount that could be drawn from the pools.
     */
    function _transferFromPoolToAMMMargin(PerpetualData storage _perpetual, int128 _fAmount) internal returns (int128) {
        if (_fAmount == 0) {
            return 0;
        }
        require(_perpetual.fAMMFundCashCC > 0 || _perpetual.state != PerpetualState.NORMAL, "perpetual state cannot be normal with 0 AMM Pool Cash");
        require(_fAmount > 0, "transferFromPoolToAMM expects positive amount");
        LiquidityPoolData storage pool = liquidityPools[_perpetual.poolId];
        // set max amount to 95% (0xf333333333333333).
        // The consequence is that we don't default if the Default Fund is still
        // well stocked.
        int128 fMaxAmount = pool.fPnLparticipantsCashCC.add(pool.fAMMFundCashCC).mul(0xf333333333333333);
        int128 fAmountFromDefFund;
        if (_fAmount > fMaxAmount) {
            // not enough cash in the liquidity pool
            // draw from default fund
            fAmountFromDefFund = _fAmount.sub(fMaxAmount);
            // amount to withdraw from pools
            _fAmount = fMaxAmount;
            if (fAmountFromDefFund > pool.fDefaultFundCashCC) {
                // not enough cash in default fund
                // margin cannot be replenished fully
                fAmountFromDefFund = pool.fDefaultFundCashCC;
                // emergency state for the whole liquidity pool
                _setLiqPoolEmergencyState(pool);
            }
            _decreaseDefaultFundCash(pool, fAmountFromDefFund);
        }

        int128 fPnLparticipantAmount;
        int128 fAmmAmount;
        // split amount (takes care if not enough funds in one of the pots, total must be<=sum of funds)
        (fPnLparticipantAmount, fAmmAmount) = _splitAmount(pool, _fAmount, true);

        _decreaseAMMFundCashForPerpetual(_perpetual, fAmmAmount);

        _decreasePoolCash(pool, fPnLparticipantAmount);

        // update margin
        int128 fFeasibleMargin = _fAmount.add(fAmountFromDefFund);
        _updateTraderMargin(_perpetual, address(this), fFeasibleMargin);
        return fFeasibleMargin;
    }

    /**
     * Split amount in relation to pool sizes.
     * If withdrawing and ratio cannot be met, funds are withdrawn from the other pool.
     * Precondition: (_fAmount<PnLparticipantCash+ammcash)|| !_isWithdrawn
     * @param   _liquidityPool    reference to liquidity pool
     * @param   _fAmount          Signed 64.64-bit fixed point number. The amount to be split
     * @param   _isWithdrawn      If true, the function re-distributes the amounts so that the pool
     *                            funds remain non-negative.
     * @return  Signed 64.64-bit fixed point number x 2. Amounts for PnL participants and AMM
     */
    function _splitAmount(
        LiquidityPoolData storage _liquidityPool,
        int128 _fAmount,
        bool _isWithdrawn
    ) internal view returns (int128, int128) {
        if (_fAmount == 0) {
            return (0,0);
        }
        int128 fAvailCash = _liquidityPool.fPnLparticipantsCashCC.add(_liquidityPool.fAMMFundCashCC);
        require(_fAmount > 0, "positive amount expected");
        require(!_isWithdrawn || fAvailCash >= _fAmount, "pre-condition not met");
        int128 fWeightPnLparticipants = _liquidityPool.fPnLparticipantsCashCC.div(fAvailCash);
        // ceiling for PnL participant share of PnL
        if (fWeightPnLparticipants > CEIL_PNL_SHARE) {
            fWeightPnLparticipants = CEIL_PNL_SHARE;
        }
        int128 fAmountPnLparticipants = fWeightPnLparticipants.mul(_fAmount);
        int128 fAmountAMM = _fAmount.sub(fAmountPnLparticipants);

        // ensure we have have non-negative funds when withdrawing
        // re-distribute otherwise
        if (_isWithdrawn) {
            int128 fSpillover = _liquidityPool.fPnLparticipantsCashCC.sub(fAmountPnLparticipants);
            if (fSpillover < 0) {
                fSpillover = fSpillover.neg();
                fAmountPnLparticipants = fAmountPnLparticipants.sub(fSpillover);
                fAmountAMM = fAmountAMM.add(fSpillover);
            }
            fSpillover = _liquidityPool.fAMMFundCashCC.sub(fAmountAMM);
            if (fSpillover < 0) {
                fSpillover = fSpillover.neg();
                fAmountAMM = fAmountAMM.sub(fSpillover);
                fAmountPnLparticipants = fAmountPnLparticipants.add(fSpillover);
            }
        }

        return (fAmountPnLparticipants, fAmountAMM);
    }

    /**
     * Increase the participation fund's cash(collateral).
     * @param   _liquidityPool reference to liquidity pool data
     * @param   _fAmount     Signed 64.64-bit fixed point number. The amount of cash(collateral) to increase.
     */
    function _increasePoolCash(LiquidityPoolData storage _liquidityPool, int128 _fAmount) internal {
        require(_fAmount >= 0, "increase negative pool cash");
        _liquidityPool.fPnLparticipantsCashCC = _liquidityPool.fPnLparticipantsCashCC.add(_fAmount);

        emit UpdateParticipationFundCash(_liquidityPool.id, _fAmount, _liquidityPool.fPnLparticipantsCashCC);
    }

    /**
     * Decrease the participation fund pool's cash(collateral).
     * @param   _liquidityPool reference to liquidity pool data
     * @param   _fAmount     Signed 64.64-bit fixed point number. The amount of cash(collateral) to decrease.
     *                       Will not decrease to negative
     */
    function _decreasePoolCash(LiquidityPoolData storage _liquidityPool, int128 _fAmount) internal {
        require(_fAmount >= 0, "decrease negative pool cash");
        _liquidityPool.fPnLparticipantsCashCC = _liquidityPool.fPnLparticipantsCashCC.sub(_fAmount);
        require(_liquidityPool.fPnLparticipantsCashCC >= 0, "participation fund cash should not be negative");

        emit UpdateParticipationFundCash(_liquidityPool.id, _fAmount.neg(), _liquidityPool.fPnLparticipantsCashCC);
    }

    /**
     * Increase the AMM's cash(collateral).
     * The perpetuals cash and the total liquidity pool AMM cash needs to be updated
     * @param   _perpetual  PerpetualData struct
     * @param   _fAmount     Signed 64.64-bit fixed point number. The amount of cash(collateral) to decrease.
     *                       Will not decrease total AMM liq pool to negative
     */
    function _increaseAMMFundCashForPerpetual(PerpetualData storage _perpetual, int128 _fAmount) internal {
        require(_fAmount >= 0, "increase negative pool cash");
        LiquidityPoolData storage liqPool = liquidityPools[_perpetual.poolId];
        require(liqPool.fTargetAMMFundSize > 0, "AMM target size must be gt zero");
        require(liqPool.fTargetDFSize > 0, "DF target size must be gt zero");

        int128 ammContribution = _perpetual.fTargetAMMFundSize.sub(_perpetual.fAMMFundCashCC);
        // contribution cannot exceed _fAmount
        if (ammContribution > _fAmount) {
            ammContribution = _fAmount;
        }
        _fAmount = _fAmount.sub(ammContribution);
        // increase pool cash
        _perpetual.fAMMFundCashCC = _perpetual.fAMMFundCashCC.add(ammContribution);
        liqPool.fAMMFundCashCC = liqPool.fAMMFundCashCC.add(ammContribution);
        require(liqPool.fAMMFundCashCC > 0, "AMM Cash st 0, error in calculation");
        emit UpdateAMMFundCash(_perpetual.id, _perpetual.fAMMFundCashCC, liqPool.fAMMFundCashCC);

        // send remaining funds to default fund
        if (_fAmount > 0) {
            liqPool.fDefaultFundCashCC = liqPool.fDefaultFundCashCC.add(_fAmount);
            emit UpdateDefaultFundCash(liqPool.id, _fAmount, liqPool.fDefaultFundCashCC);
        }
    }

    /**
     * Decrease the AMM's fund cash (not the margin).
     * The perpetuals cash and the total liquidity pool cash needs to be updated
     * @param   _perpetual  PerpetualData struct
     * @param   _fAmount     Signed 64.64-bit fixed point number. The amount of cash(collateral) to increase.
     */
    function _decreaseAMMFundCashForPerpetual(PerpetualData storage _perpetual, int128 _fAmount) internal {
        require(_fAmount >= 0, "decrease negative pool cash");

        // adjust total pool amount
        liquidityPools[_perpetual.poolId].fAMMFundCashCC = (liquidityPools[_perpetual.poolId].fAMMFundCashCC).sub(_fAmount);
        // adjust perpetual's individual pool
        _perpetual.fAMMFundCashCC = _perpetual.fAMMFundCashCC.sub(_fAmount);
        emit UpdateAMMFundCash(_perpetual.id, _perpetual.fAMMFundCashCC.neg(), liquidityPools[_perpetual.poolId].fAMMFundCashCC);
    }

    /**
     * @dev     Decrease default fund cash
     * @param   _liquidityPool reference to liquidity pool data
     * @param   _fAmount     Signed 64.64-bit fixed point number. The amount of cash(collateral) to decrease.
     */
    function _decreaseDefaultFundCash(LiquidityPoolData storage _liquidityPool, int128 _fAmount) internal {
        require(_fAmount >= 0, "decrease negative pool cash");
        _liquidityPool.fDefaultFundCashCC = _liquidityPool.fDefaultFundCashCC.sub(_fAmount);
        require(_liquidityPool.fDefaultFundCashCC >= 0, "DF cash cannot be negative");
        emit UpdateDefaultFundCash(_liquidityPool.id, _fAmount.neg(), _liquidityPool.fDefaultFundCashCC);
    }

    /**
     * Loop through perpetuals of the liquidity pool and set
     * to emergency state
     * @param _liqPool reference to liquidity pool
     */
    function _setLiqPoolEmergencyState(LiquidityPoolData storage _liqPool) internal {
        uint256 length = _liqPool.iPerpetualCount;
        for (uint256 i = 0; i < length; i++) {
            bytes32 idx = perpetualIds[_liqPool.id][i];
            PerpetualData storage perpetual = perpetuals[_liqPool.id][idx];
            if (perpetual.state != PerpetualState.NORMAL) {
                continue;
            }
            _setEmergencyState(perpetual);
        }
    }

    /**
     * Set the state of the perpetual to "EMERGENCY". Must rebalance first.
     * After that the perpetual is not allowed to trade, deposit and withdraw.
     * The price of the perpetual is freezed to the settlement price
     * @param   _perpetual  reference to perpetual
     */
    function _setEmergencyState(PerpetualData storage _perpetual) internal {
        if (_perpetual.state == PerpetualState.EMERGENCY) {
            // done
            return;
        }

        require(_perpetual.state == PerpetualState.NORMAL, "perpetual should be in NORMAL state");
        // use mark price as final price when emergency
        _perpetual.fSettlementMarkPremiumRate = _perpetual.currentMarkPremiumRate.fPrice;
        _perpetual.fSettlementS2PriceData = oraclePriceData[_perpetual.oracleS2Addr].fPrice;
        _perpetual.fSettlementS3PriceData = oraclePriceData[_perpetual.oracleS3Addr].fPrice;
        _perpetual.state = PerpetualState.EMERGENCY;
        emit SetEmergencyState(
            _perpetual.id,
            _perpetual.fSettlementMarkPremiumRate,
            _perpetual.fSettlementS2PriceData,
            _perpetual.fSettlementS3PriceData
        );
    }

    /**
     * @dev     Check if the trader has opened position in the trade.
     *          Example: 2, 1 => true; 2, -1 => false; -2, -3 => true
     * @param   _fNewPos    The position of the trader after the trade
     * @param   fDeltaPos   The size of the trade
     * @return  True if the trader has opened position in the trade
     */
    function _hasOpenedPosition(int128 _fNewPos, int128 fDeltaPos) internal pure returns (bool) {
        if (_fNewPos == 0) {
            return false;
        }
        return _hasTheSameSign(_fNewPos, fDeltaPos);
    }

    /*
     * Check if two numbers have the same sign. Zero has the same sign with any number
     * @param   _fX 64.64 fixed point number
     * @param   _fY 64.64 fixed point number
     * @return  True if the numbers have the same sign or one of them is zero.
     */
    function _hasTheSameSign(int128 _fX, int128 _fY) internal pure returns (bool) {
        if (_fX == 0 || _fY == 0) {
            return true;
        }
        return (_fX ^ _fY) >> 127 == 0;
    }

    /**
     * Check if Trader is maintenance margin safe in the perpetual,
     * need to rebalance before checking.
     * @param   _perpetual   Reference to the perpetual
     * @param   _traderAddr  The address of the trader
     * @param   _hasOpened   True if the trader opens, false if they close
     * @return  True if Trader is maintenance margin safe in the perpetual.
     */
    function _isTraderMarginSafe(
        PerpetualData storage _perpetual,
        address _traderAddr,
        bool _hasOpened
    ) internal view returns (bool) {
        return
            _hasOpened ?   _getMarginViewLogic().isInitialMarginSafe(_perpetual.id, _traderAddr) : 
                            _getMarginViewLogic().isMarginSafe(_perpetual.id, _traderAddr);
    }

    function _getTradeLogic() internal view returns (IPerpetualTradeLogic) {
        return IPerpetualTradeLogic(address(this));
    }

    function _getUpdateLogic() internal view returns (IPerpetualUpdateLogic) {
        return IPerpetualUpdateLogic(address(this));
    }

    function _getMarginLogic() internal view returns (IPerpetualMarginLogic) {
        return IPerpetualMarginLogic(address(this));
    }

    function _getMarginViewLogic() internal view returns (IPerpetualMarginViewLogic) {
        return IPerpetualMarginViewLogic(address(this));
    }

    function _getPerpetualGetter() internal view returns (IPerpetualGetter) {
        return IPerpetualGetter(address(this));
    }
}
