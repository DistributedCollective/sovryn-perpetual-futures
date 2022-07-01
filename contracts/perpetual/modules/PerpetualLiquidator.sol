// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../functions/PerpetualRebalanceFunctions.sol";
import "../interfaces/IPerpetualLiquidator.sol";
import "../interfaces/IPerpetualTradeLogic.sol";
import "../interfaces/IFunctionList.sol";
import "../../libraries/Utils.sol";

contract PerpetualLiquidator is PerpetualRebalanceFunctions, IFunctionList, IPerpetualLiquidator {
    using ABDKMath64x64 for int128;
    using ConverterDec18 for int128;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
    int128 public constant THREEQUARTER_64x64 = 0xc000000000000000;

    /**
     * Liquidation can be initiated by anyone. The AMM takes over the defaulting
     * trader position.
     *
     * @param   _perpetualIndex  The reference for the perpetual.
     * @param   _liquidatorAddr  The address of the account calling the liquidation method.
     * @param   _traderAddr      The address of the liquidated account.
     * @return  fLiquidatedAmount    The amount of positions actually liquidated in the transaction.
     */
    function liquidateByAMM(
        bytes32 _perpetualIndex,
        address _liquidatorAddr,
        address _traderAddr
    ) external virtual override updateFundingAndPrices(_perpetualIndex, _getPoolIdFromPerpetual(_perpetualIndex)) 
        returns (int128 fLiquidatedAmount) 
    {
        if (_getMarginViewLogic().isMaintenanceMarginSafe(_perpetualIndex, _traderAddr)) {
            // no revert but return zero fee earned
            return 0;
        }
        require(_traderAddr != address(this), "cannot liquidate AMM");

        PerpetualData storage perpetual = _getPerpetual(_perpetualIndex);
        fLiquidatedAmount = _getPositionAmountToLiquidate(perpetual, _traderAddr).neg();
        // we liquidate at mark-price
        int128 fTraderPos;
        int128 fPrice;
        int128 fRealizedPnL;
        (fTraderPos, fPrice, fRealizedPnL) = _liquidateAndPenalize(perpetual, _traderAddr, _liquidatorAddr, fLiquidatedAmount);
        // The trader could have a balance <0, in this case the position must be zero
        require(_isTraderMarginSafe(perpetual, _traderAddr, false), "trader margin unsafe after liquidation");
        {
            int128 newpos = marginAccounts[perpetual.id][_traderAddr].fPositionBC;
            bytes32 posID = marginAccounts[perpetual.id][_traderAddr].positionId;
            emit RealizedPnL(perpetual.id, _traderAddr, posID, fRealizedPnL);
            emit Liquidate(perpetual.id, _liquidatorAddr, _traderAddr, posID, fLiquidatedAmount, fPrice, newpos);
        }
        if (fTraderPos == fLiquidatedAmount.neg()) {
            // trader was fully liquidated, set positionId to zero
            marginAccounts[perpetual.id][_traderAddr].positionId = 0;
            if (marginAccounts[perpetual.id][_traderAddr].fCashCC <= 0) {
                activeAccounts[perpetual.id].remove(_traderAddr);
            }
        }
    }

    /**
     * performs the liquidation trade and pays penalty fees
     *
     * @param   _perpetual          The reference for the perpetual.
     * @param   _traderAddr         The address of the trader being liquidated
     * @param   _liquidatorAddr     The address being paid for the liquidation
     * @param   _fLiquidatedAmount  Amount to liquidate
     * @return  (trader pos before liquidation, markprice, realized PnL)
     */
    function _liquidateAndPenalize(PerpetualData storage _perpetual, address _traderAddr, 
        address _liquidatorAddr, int128 _fLiquidatedAmount) 
        internal
        returns (int128, int128, int128)
    {
        int128 fTraderPos;
        int128 fPrice;
        int128 fRealizedPnL;
        fPrice = _getPerpetualMarkPrice(_perpetual);
        {
            fTraderPos = marginAccounts[_perpetual.id][_traderAddr].fPositionBC;
            // partially or fully close the trader's position:
            fRealizedPnL = _getTradeLogic().executeTrade(_perpetual.id, _traderAddr, fTraderPos, _fLiquidatedAmount, fPrice, true);
         
            // now the trader is initial margin safe. If margin was large enough
            // If they have some funds > maintenance margin left (if pos zero -> all funds are used)
            // there are enough funds to pay liquidation penalty.
            // subtract penalty
            int128 fRemainingMargin;
            int128 fPenaltyCC;
            (fPenaltyCC, fRemainingMargin) = _payLiquidationPenalty(_perpetual, _fLiquidatedAmount,[_traderAddr, _liquidatorAddr]);
            fRealizedPnL = fRealizedPnL.sub(fPenaltyCC);
            // rebalance, then distribute fees
            _getRebalanceLogic().rebalance(_perpetual.id);
            if (fRemainingMargin.sub(fPenaltyCC) > 0) {
                // regular fees
                fRealizedPnL = fRealizedPnL.sub(_getTradeLogic().distributeFeesNoRef(_perpetual.id, _traderAddr, _fLiquidatedAmount, false));
            }
        }
        return (fTraderPos, fPrice, fRealizedPnL);
    }

    /**
     * Pays penalty fees
     *
     * @param   _perpetual          The reference for the perpetual.
     * @param   _fLiquidatedAmount  The address of the trader being liquidated
     * @param   addr                Array[2] with _traderAddr, _liquidatorAddr
     * @return  (penalty paid, remaining margin)
     */
    function _payLiquidationPenalty(PerpetualData storage _perpetual, 
        int128 _fLiquidatedAmount, address[2] memory addr) 
        internal returns (int128, int128) 
    {
        address _traderAddr = addr[0];
        address _liquidatorAddr = addr[1];
        LiquidityPoolData storage liqPool = _getLiquidityPoolFromPerpetual(_perpetual.id);
        int128 fRemainingMargin = _getMarginViewLogic().getAvailableMargin(_perpetual.id, _traderAddr, false);
        if (fRemainingMargin < 0) {
            fRemainingMargin = 0;
        }
        // calculate liquidation penalty in collateral currency
        // liquidator fee has priority over trade-fee
        int128 fPenaltyCC;
        {
            int128 fB2C = _getBaseToCollateralConversionMultiplier(_perpetual, false);
            fPenaltyCC = _fLiquidatedAmount.mul(fB2C).abs().mul(_perpetual.fLiquidationPenaltyRate);
            fPenaltyCC = fPenaltyCC > fRemainingMargin ? fRemainingMargin : fPenaltyCC;

            // trader pays
            _updateTraderMargin(_perpetual, _traderAddr, fPenaltyCC.neg());
            // split fees between default fund and liquidator: 0x8000000000000000=0.5
            int128 fHalfPenaltyCC = fPenaltyCC.mul(0x8000000000000000);
            // pay liquidator
            address mgnTokenAddr = liqPool.marginTokenAddress;
            _transferFromVaultToUser(mgnTokenAddr, _liquidatorAddr, fHalfPenaltyCC);
            // pay default fund
            liqPool.fDefaultFundCashCC = liqPool.fDefaultFundCashCC.add(fHalfPenaltyCC);
            emit UpdateDefaultFundCash(liqPool.id, fHalfPenaltyCC, liqPool.fDefaultFundCashCC);
            emit DistributeFees(liqPool.id, _perpetual.id, _traderAddr, fHalfPenaltyCC, 0);
        }
        return (fPenaltyCC, fRemainingMargin);
    }

    /**
     * Round value up (away from zero) to precision. If at precision, value will still be rounded up,
     * e.g. growToLot(0.02, 0.01) = 0.03
     * growToLot(-0.02, 0.01) = -0.03
     * growToLot(0.04, 0.01) = 0.04
     * growToLot(0.02, 0.01) = 0.03
     * grow_to_lot(0.03-1e-34, 0.01)
     * @param   _fAmountBC   64.64 fixed point number, amount to be traded
     * @param   _fLotSizeBC  64.64 fixed point number, lot size
     * @return  rounded amount
     */
    function _growToLot(int128 _fAmountBC, int128 _fLotSizeBC) internal pure returns (int128) {
        // see a;sp test_liquidations.py : grow_to_lot
        // posGrown = int(np.abs(position)/lot+1)*lot
        int128 rounded = _fAmountBC.abs().div(_fLotSizeBC).add(ONE_64x64) >> 64;
        rounded = (rounded << 64).mul(_fLotSizeBC);
        return _fAmountBC < 0 ? rounded.neg() : rounded;
    }

    /**
     * Calculate the amount that needs liquidation (base currency).
     * Positive for long position, negative for short positions.
     * Derivation see whitepaper. Tau is set to the marginrate-cap parameter.
     * @param _perpetual    The perpetual object
     * @param _traderAddr   The address of the trader
     * @return The position amount to be liquidated so that the position is initial margin safe
     */
    function _getPositionAmountToLiquidate(PerpetualData storage _perpetual, address _traderAddr) internal view returns (int128) {
        int128 b0 = _getMarginViewLogic().getMarginBalance(_perpetual.id, _traderAddr);
        int128 fTraderPos = marginAccounts[_perpetual.id][_traderAddr].fPositionBC;
        int128 fS2 = _getBaseToQuoteConversionMultiplier(_perpetual, false);
        int128 fSm = _getBaseToQuoteConversionMultiplier(_perpetual, true);
        int128 fS3 = _getCollateralToQuoteConversionMultiplier(_perpetual);
        int128 m = _perpetual.fInitialMarginRateCap;
        if (b0.mul(fS3) > fTraderPos.abs().mul(m).mul(fSm) || fTraderPos == 0) {
            // trader is already initial margin safe or has no position
            return 0;
        }
        int128 fTotalFeeRate = _perpetual.fLiquidationPenaltyRate.add(_perpetual.fTreasuryFeeRate).add(_perpetual.fPnLPartRate);

        if (b0.mul(fS3) <= fTraderPos.abs().mul(fTotalFeeRate).mul(fS2)) {
            // liquidate total position
            return fTraderPos;
        }
        int128 delta_bc = fTraderPos.abs().mul(m).mul(fSm).sub(b0.mul(fS3)).div(m.mul(fSm).sub(fTotalFeeRate.mul(fS2)));
        if (fTraderPos < 0) {
            delta_bc = delta_bc.neg();
        }
        // deal with lot size
        int128 lot = _perpetual.fLotSizeBC;
        delta_bc = _growToLot(delta_bc, lot);
        if (fTraderPos.abs().sub(delta_bc.abs()) < MIN_NUM_LOTS_PER_POSITION.mul(lot)) {
            return fTraderPos;
        }
        return delta_bc.abs() > fTraderPos.abs() ? fTraderPos : delta_bc;
    }

    /*
     * Conversion from base currency to quote currency.
     * @param   _perpetual           The reference of perpetual storage.
     * @param   _isMarkPriceRequest  If true, get the conversion for the mark-price. If false for spot.
     * The int128 fixed point number, conversion factor
     */
    function _getBaseToQuoteConversionMultiplier(PerpetualData storage _perpetual, bool _isMarkPriceRequest) internal view returns (int128) {
        if (_isMarkPriceRequest) {
            return _getPerpetualMarkPrice(_perpetual);
        } else {
            return _perpetual.state != PerpetualState.NORMAL ? _perpetual.fSettlementS2PriceData : oraclePriceData[_perpetual.oracleS2Addr].fPrice;
        }
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualLiquidator");
        bytes4[] memory functionList = new bytes4[](1);
        functionList[0] = this.liquidateByAMM.selector;
        return (functionList, moduleName);
    }
}
