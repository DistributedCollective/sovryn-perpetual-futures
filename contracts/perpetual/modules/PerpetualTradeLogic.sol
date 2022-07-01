// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../../libraries/OrderFlags.sol";
import "./../functions/PerpetualUpdateFunctions.sol";
import "./../interfaces/IFunctionList.sol";
import "./../interfaces/IPerpetualTradeLogic.sol";
import "../../libraries/Utils.sol";

contract PerpetualTradeLogic is PerpetualUpdateFunctions, IFunctionList, IPerpetualTradeLogic {
    using ABDKMath64x64 for int128;
    using ConverterDec18 for int128;
    using OrderFlags for uint32;

    function executeTrade(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _fTraderPos,
        int128 _fTradeAmount,
        int128 _fPrice,
        bool _isClose
    ) external virtual override onlyThis returns (int128) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _executeTrade(perpetual, _traderAddr, _fTraderPos, _fTradeAmount, _fPrice, _isClose);
    }

    function preTrade(
        bytes32 _iPerpetualId,
        IPerpetualOrder.Order memory _order
    ) external virtual override onlyThis returns (int128, int128) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        int128 fPrice;
        int128 fAmount = _order.fAmount;
        int128 fLimitPrice = _order.fLimitPrice;
        address traderAddr = _order.traderAddr;

        (fPrice, fAmount) = _preTrade(perpetual, traderAddr, fAmount, fLimitPrice, _order.flags);
        return (fPrice, fAmount);
    }

    /*
    function distributeFees(
        bytes32 _iPerpetualId,
        address _traderAddr,
        address _referrerAddr,
        int128 _fDeltaPositionBC,
        bool _hasOpened
    ) external virtual override onlyThis returns (int128) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _distributeFees(perpetual, _traderAddr, _referrerAddr, _fDeltaPositionBC, _hasOpened);
    }*/

    function distributeFees(
        IPerpetualOrder.Order memory _order,
        bool _hasOpened
    ) external virtual override onlyThis returns (int128) {
        PerpetualData storage perpetual = _getPerpetual(_order.iPerpetualId);
        return _distributeFees(perpetual, _order.traderAddr, _order.referrerAddr, _order.fAmount, _hasOpened);
    }

    function distributeFeesNoRef(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _fDeltaPositionBC,
        bool _hasOpened
    ) external virtual override onlyThis returns (int128) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _distributeFees(perpetual, _traderAddr, address(0), _fDeltaPositionBC, _hasOpened);
    }

    /**
     * @param   _perpetual          The reference of perpetual storage.
     * @param   _traderAddr         Trader address
     * @param   _fTraderPos         Current trader position (pre-trdae, base currency)
     * @param   _fTradeAmount       Amount to be traded (base currency)
     * @param   _fPrice             price (base-quote)
     * @param   _isClose            true if trade (partially) closes position
     * @return  realized profit (delta cash) in collateral currency
     */
    function _executeTrade(
        PerpetualData storage _perpetual,
        address _traderAddr,
        int128 _fTraderPos,
        int128 _fTradeAmount,
        int128 _fPrice,
        bool _isClose
    ) internal returns (int128) {
        int128 fIndexS2 = oraclePriceData[_perpetual.oracleS2Addr].fPrice;
        int128 fPremium = _fTradeAmount.mul(_fPrice.sub(fIndexS2));
        int128 fQ2C = ONE_64x64.div(_getCollateralToQuoteConversionMultiplier(_perpetual));
        int128 fDeltaCashCC = fPremium.neg().mul(fQ2C);
        int128 fDeltaLockedValue = _fTradeAmount.mul(fIndexS2);
        // if we're opening a position, L <- L + delta position * price, and no change in cash account
        // otherwise, we will have a PnL from closing:
        if (_isClose) {
            require(_getLockedInValue(_perpetual, _traderAddr) != 0, "cannot be closing if no exposure");
            require(_fTraderPos != 0, "cannot be closing if already closed");
            int128 fAvgPrice = _getLockedInValue(_perpetual, _traderAddr).div(_fTraderPos);
            fAvgPrice = fAvgPrice.abs();
            // PnL = new price*pos - locked-in-price*pos
            //     = avgprice*delta_pos - new_price*delta_pos
            //     = avgprice*delta_pos - _fDeltaLockedValue
            int128 fPnL = fAvgPrice.mul(_fTradeAmount).sub(fDeltaLockedValue);
            // The locked-in-value should change proportionally to the amount that is closed:
            // delta LockedIn = delta position * avg price
            // delta LockedIn = delta position * price + PnL
            // Since we have delta LockedIn = delta position * price up to this point,
            // it suffices to add the PnL from above:
            fDeltaLockedValue = fDeltaLockedValue.add(fPnL);
            // equivalently, L <- L * new position / old position,
            // i.e. if we are selling 10%, then the new locked in value is the 90% remaining
            fDeltaCashCC = fDeltaCashCC.add(fPnL.mul(fQ2C));
        }

        // execute trade: update margin, position, and open interest:
        _updateMargin(_perpetual, address(this), _fTradeAmount.neg(), fDeltaCashCC.neg(), fDeltaLockedValue.neg());
        _updateMargin(_perpetual, _traderAddr, _fTradeAmount, fDeltaCashCC, fDeltaLockedValue);
        if (!_isClose) {
            // update the average position size for AMM Pool and Default Fund target size.
            // We only account for 'opening trades'
            _updateAverageTradeExposures(_perpetual, _fTradeAmount.add(_fTraderPos));
        }
        return fDeltaCashCC;
    }

    /**
     * Rounds _fAmountBC (0.5 rounded symmetrically)
     * @param   _fAmountBC    64.64 fixed point number, amount to be traded
     * @param   fLotSizeBC    64.64 fixed point number, lot size
     * @return  rounded amount
     */
    function _roundToLot(int128 _fAmountBC, int128 fLotSizeBC) internal pure returns (int128) {
        int128 rounded = _fAmountBC.div(fLotSizeBC).add(0x8000000000000000) >> 64;
        return (rounded << 64).mul(fLotSizeBC);
    }

    /**
     * @param   _perpetual    The reference of perpetual storage.
     * @param   _traderAddr   Trader address
     * @param   _fAmount      Amount to be traded (base currency) (negative if trader goes short)
     * @param   _fLimitPrice  Limit price
     * @param   _flags        Order flagisCloseOnly()
     * @return  change in locked-in value (quote currency) and potentially reduced trade amount
     */
    function _preTrade(
        PerpetualData storage _perpetual,
        address _traderAddr,
        int128 _fAmount,
        int128 _fLimitPrice,
        uint32 _flags
    ) internal view returns (int128, int128) {
        // round the trade amount to the next lot size
        _fAmount = _roundToLot(_fAmount, _perpetual.fLotSizeBC);
        require(_fAmount.abs() > 0, "trade amount too small for lot-size");

        int128 fTraderPos = marginAccounts[_perpetual.id][_traderAddr].fPositionBC;
        int128 fNewPosSizeInLots = fTraderPos.add(_fAmount).abs().div(_perpetual.fLotSizeBC);
        // don't leave dust. If the resulting position is smaller than a lot-size,
        // we close the position
        bool closePos = !_hasTheSameSign(fTraderPos, _fAmount) && fNewPosSizeInLots < ONE_64x64;
        if (closePos) {
            // increase the amount by one lot size, so in _shrinkToMaxPositionToClose
            // the position size is adjusted to a full close.
            _fAmount = _fAmount < 0 ? _fAmount.sub(_perpetual.fLotSizeBC) : _fAmount.add(_perpetual.fLotSizeBC);
        } else {
            // resulting position should be larger than minimum position size, 
            // regardless of opening or partial closing (full close is handled above)
            require(fNewPosSizeInLots >= MIN_NUM_LOTS_PER_POSITION, "position too small");
        }
        // handle close only flag or dust
        if (_flags.isCloseOnly() || closePos) {
            _fAmount = _shrinkToMaxPositionToClose(fTraderPos, _fAmount);
            require(_fAmount != 0, "no amount to close");
        }
        // query price from AMM
        int128 fPrice = _queryPriceFromAMM(_perpetual, _fAmount);
        _validatePrice(_fAmount >= 0, fPrice, _fLimitPrice);

        return (fPrice, _fAmount);
    }

    /**
     * Maximal position size calculation. The maximal position size per trader is set to the trader EMA times a
     * scaling factor (e.g, times 1.25).
     * We always allow trades of size k*. k* is the trade that brings the AMM risk to its minimum,
     * which is handled elsewhere.
     * @param _perpetual   Reference to perpetual
     * @param isLong       True if trader trades into a long position (new pos after trade is long)
     * @return The maximal position size that is currently allowed for this trader (positive if isLong, negative otherwise)
     */
    function _getMaxSignedPositionSize(PerpetualData storage _perpetual, bool isLong) internal view returns (int128) {
        require(_perpetual.fCurrentTraderExposureEMA > 0, "precondition: fCurrentTraderExposureEMA must be positive");
        int128 scale = _perpetual.fMaximalTradeSizeBumpUp;
        int128 fkStar = _perpetual.fkStar;
        if ((isLong && fkStar < 0) || (!isLong && fkStar > 0)) {
            // trade in adverse direction: what is the maximal position?
            LiquidityPoolData memory liqPool = _getLiquidityPoolFromPerpetual(_perpetual.id);
            int128 fundingRatio = liqPool.fDefaultFundCashCC.div(liqPool.fTargetDFSize);
            if (fundingRatio > ONE_64x64) {
                fundingRatio = ONE_64x64;
            }
            // if default fund < target: scale = fundingratio * BumpUp
            // if default fund > target: scale = BumpUp
            scale = scale.mul(fundingRatio);
        }
        // maxAbs = emwaTraderK*bumpUp or reduced bumpUp
        return isLong ? _perpetual.fCurrentTraderExposureEMA.mul(scale) : _perpetual.fCurrentTraderExposureEMA.mul(scale).neg();
    }

    /**
     * Maximal trade size depends on current position and k*
     * k* is the trade that brings the AMM risk to its minimum.
     * This function is called only for OPEN trades (increase absolute value of position).
     * We always allow trades of size k*, regardless of the max position allowed.
     * Requires updated k*
     * @param _fCurrentTraderPos     The trader's current position k
     * perpetual.fkStar                Trade that brings AMM risk to minimum
     * perpetual.fTraderExposureEMA    Current trader exposure EMA (perpetual.fCurrentAMMExposureEMA)
     * perpetual.fBumpUp               How much do we allow to increase the trade size above the current
     *                               fCurrentAMMExposureEMA? (e.g. 0.25)
     * @return signed maximal trade size (negative if resulting position is short, positive otherwise)
     */
    function getMaxSignedTradeSizeForPos(
        bytes32 _perpetualId,
        int128 _fCurrentTraderPos,
        int128 fTradeAmountBC
    ) external view virtual override returns (int128) {
        PerpetualData storage perpetual = _getPerpetual(_perpetualId);
        int128 fNewPos = fTradeAmountBC.add(_fCurrentTraderPos);
        int128 fMaxPos = _getMaxSignedPositionSize(perpetual, fNewPos > 0);
        // having the maximal (signed) position size, we can determine the maximal trade amount
        int128 maxSignedTradeAmount = fMaxPos.sub(_fCurrentTraderPos);

        // we allow for 2 k-star, even if this means the max position is exceeded
        int128 fkStar = perpetual.fkStar.add(perpetual.fkStar);
        if (maxSignedTradeAmount > 0 && fkStar > maxSignedTradeAmount) {
            maxSignedTradeAmount = fkStar;
        } else if (maxSignedTradeAmount < 0 && fkStar < maxSignedTradeAmount) {
            maxSignedTradeAmount = fkStar;
        }
        // global restriction of position size?
        if (perpetual.fMaxPositionBC > 0) {
            fNewPos = _fCurrentTraderPos.add(maxSignedTradeAmount);
            if (fNewPos.abs() > perpetual.fMaxPositionBC) {
                fMaxPos = fNewPos > 0 ? perpetual.fMaxPositionBC : perpetual.fMaxPositionBC.neg();
                maxSignedTradeAmount = fMaxPos.sub(_fCurrentTraderPos);
            }
        }
        return maxSignedTradeAmount;
    }

    /**
     * Update the trader's account in the perpetual
     * @param _perpetual  The perpetual object
     * @param _fTraderPos The position size that the trader just initiated
     */
    function _updateAverageTradeExposures(PerpetualData storage _perpetual, int128 _fTraderPos) internal {
        // (neg) AMM exposure (aggregated trader exposure)
        {
            int128 fCurrentObs = marginAccounts[_perpetual.id][address(this)].fPositionBC.neg();
            uint256 iIndex = fCurrentObs > 0 ? 1 : 0;
            int128 fLambda = fCurrentObs.abs() > _perpetual.fCurrentAMMExposureEMA[iIndex].abs() ? _perpetual.fDFLambda[1] : _perpetual.fDFLambda[0];
            if (fCurrentObs.abs() < _perpetual.fMinimalAMMExposureEMA) {
                fCurrentObs = iIndex == 0 ? _perpetual.fMinimalAMMExposureEMA.neg() : _perpetual.fMinimalAMMExposureEMA;
            }
            int128 tmp = _getAMMPerpLogic().ema(_perpetual.fCurrentAMMExposureEMA[iIndex], fCurrentObs, fLambda);
            //            int128 tmp = _perpetual.fCurrentAMMExposureEMA[iIndex].mul(fLambda).add(ONE_64x64.sub(fLambda).mul(fCurrentObs));
            //console.log("result");
            //console.logInt(tmp.toDec18());
            _perpetual.fCurrentAMMExposureEMA[iIndex] = tmp;
            /*
            console.log("fCurrentAMMExposureEMA");
            console.logInt(_perpetual.fCurrentAMMExposureEMA[0].toDec18());
            console.logInt(_perpetual.fCurrentAMMExposureEMA[1].toDec18());
            console.log("</PerpetualTradeLogic>");*/
        }

        // trader exposure
        {
            int128 fCurrentObs = _fTraderPos.abs();
            int128 fLambda = fCurrentObs > _perpetual.fCurrentTraderExposureEMA.abs() ? _perpetual.fDFLambda[1] : _perpetual.fDFLambda[0];
            if (fCurrentObs < _perpetual.fMinimalTraderExposureEMA) {
                fCurrentObs = _perpetual.fMinimalTraderExposureEMA;
            }
            _perpetual.fCurrentTraderExposureEMA = _getAMMPerpLogic().ema(_perpetual.fCurrentTraderExposureEMA, fCurrentObs, fLambda);
        }
        emit UpdateReprTradeSizes(
            _perpetual.id,
            _perpetual.fCurrentTraderExposureEMA,
            _perpetual.fCurrentAMMExposureEMA[0],
            _perpetual.fCurrentAMMExposureEMA[1]
        );
    }

    /**
     * Update the trader's account in the perpetual
     * @param _perpetual The perpetual object
     * @param _traderAddr The address of the trader
     * @param _fDeltaPosition The update position of the trader's account in the perpetual
     * @param _fDeltaCashCC The update cash(collateral currency) of the trader's account in the perpetual
     * @param _fDeltaLockedInValueQC The update of the locked-in value in quote currency
     */
    function _updateMargin(
        PerpetualData storage _perpetual,
        address _traderAddr,
        int128 _fDeltaPosition,
        int128 _fDeltaCashCC,
        int128 _fDeltaLockedInValueQC
    ) internal {
        MarginAccount storage account = marginAccounts[_perpetual.id][_traderAddr];
        int128 fOldPosition = account.fPositionBC;
        int128 fFundingPayment;
        if (fOldPosition != 0) {
            fFundingPayment = _perpetual.fUnitAccumulatedFunding.sub(account.fUnitAccumulatedFundingStart).mul(fOldPosition);
        }
        //position
        account.fPositionBC = account.fPositionBC.add(_fDeltaPosition);
        //cash
        {
            int128 fNewCashCC = account.fCashCC.add(_fDeltaCashCC).sub(fFundingPayment);
            if (_traderAddr != address(this) && fNewCashCC < 0) {
                /* if liquidation happens too late, the trader cash becomes negative (margin used up).
                In this case, we cannot add the full amount to the AMM margin and leave the
                trader margin negative (trader will never pay). Hence we subtract the amount
                the trader cannot pay from the AMM margin (it is added previously to the AMM margin).
                */
                int128 fAmountOwed = fNewCashCC.neg();
                fNewCashCC = 0;
                MarginAccount storage accountAMM = marginAccounts[_perpetual.id][address(this)];
                accountAMM.fCashCC = accountAMM.fCashCC.sub(fAmountOwed);
            }
            account.fCashCC = fNewCashCC;
        }
        // update funding start for potential next funding payment
        account.fUnitAccumulatedFundingStart = _perpetual.fUnitAccumulatedFunding;
        //locked-in value in quote currency
        account.fLockedInValueQC = account.fLockedInValueQC.add(_fDeltaLockedInValueQC);

        // adjust open interest
        {
            int128 fDeltaOpenInterest;
            if (fOldPosition > 0) {
                fDeltaOpenInterest = fOldPosition.neg();
            }
            if (account.fPositionBC > 0) {
                fDeltaOpenInterest = fDeltaOpenInterest.add(account.fPositionBC);
            }
            _perpetual.fOpenInterest = _perpetual.fOpenInterest.add(fDeltaOpenInterest);
        }

        emit UpdateMarginAccount(
            _perpetual.id,
            _traderAddr,
            marginAccounts[_perpetual.id][_traderAddr].positionId,
            account.fPositionBC,
            account.fCashCC,
            account.fLockedInValueQC,
            fFundingPayment,
            _perpetual.fOpenInterest
        );
    }

    /**
     * transfer the specified fee amounts to the stakeholders
     * @param   _liqPool                    Reference to liquidity pool
     * @param   _perpetual                  Reference of pereptual storage.
     * @param   _traderAddr                 The address of trader.
     * @param   _referrerAddr               The address of referrer who will get rebate from the deal.
     * @param   _fPnLparticipantFee         amount to be sent to PnL participants
     * @param   _fReferralRebate            amount to be sent to referrer
     * @param   _fDefaultFundContribution   signed amount to be sent or withdrawn from default fund.
     * @param   _fAMMCashContribution       signed amount to be sent or withdrawn from AMM.
     */
    function _transferFee(
        LiquidityPoolData storage _liqPool,
        PerpetualData storage _perpetual,
        address _traderAddr,
        address _referrerAddr,
        int128 _fPnLparticipantFee,
        int128 _fReferralRebate,
        int128 _fDefaultFundContribution,
        int128 _fAMMCashContribution
    ) internal {
        require(_fPnLparticipantFee >= 0, "PnL participant should earn fee");
        require(_fReferralRebate >= 0, "referrer should earn fee");
        //update PnL participant balance, AMM Cash balance, default fund balance
        if (_liqPool.fPnLparticipantsCashCC != 0) {
            _liqPool.fPnLparticipantsCashCC = _liqPool.fPnLparticipantsCashCC.add(_fPnLparticipantFee);
            emit UpdateParticipationFundCash(_liqPool.id, _fPnLparticipantFee, _liqPool.fPnLparticipantsCashCC);
        } else {
            // currently no pnl participant funds, hence add the fee to the AMM fee
            _fAMMCashContribution = _fAMMCashContribution.add(_fPnLparticipantFee);
        }

        _liqPool.fDefaultFundCashCC = _liqPool.fDefaultFundCashCC.add(_fDefaultFundContribution);
        emit UpdateDefaultFundCash(_liqPool.id, _fDefaultFundContribution, _liqPool.fDefaultFundCashCC);

        // contribution to AMM pool is recorded in perpetual and the aggregated amount in the liq-pool
        _liqPool.fAMMFundCashCC = _liqPool.fAMMFundCashCC.add(_fAMMCashContribution);
        _perpetual.fAMMFundCashCC = _perpetual.fAMMFundCashCC.add(_fAMMCashContribution);
        emit UpdateAMMFundCash(_perpetual.id, _perpetual.fAMMFundCashCC, _liqPool.fAMMFundCashCC);

        address mgnTokenAddr = _liqPool.marginTokenAddress;
        _transferFromVaultToUser(mgnTokenAddr, _referrerAddr, _fReferralRebate);
        emit TransferFeeToReferrer(_perpetual.id, _traderAddr, _referrerAddr, _fReferralRebate);
    }

    /**
     * Prepare data for pricing functions in AMMPerpModule and get the price from the module
     * @param   _perpetual     The reference of perpetual storage.
     * @param   _fTradeAmount  Amount to be traded (negative if trader goes short)
     * @return  the price for the queried amount
     */
    function _queryPriceFromAMM(PerpetualData storage _perpetual, int128 _fTradeAmount) internal view returns (int128) {
        require(_fTradeAmount != 0, "trading amount is zero");
        require(_perpetual.fCurrentTraderExposureEMA > 0, "trade size EMA is non-positive");

        AMMPerpLogic.AMMVariables memory ammState;
        AMMPerpLogic.MarketVariables memory marketState;
        (ammState, marketState) = _prepareAMMAndMarketData(_perpetual);
        // funding status
        LiquidityPoolData memory lp = _getLiquidityPoolFromPerpetual(_perpetual.id);
        int128 fMinSpread = lp.fDefaultFundCashCC > lp.fTargetDFSize ? _perpetual.fMinimalSpread : _perpetual.fMinimalSpreadInStress;

        return _getAMMPerpLogic().calculatePerpetualPrice(ammState, marketState, _fTradeAmount, fMinSpread);
    }

    /**
     * Check if the price is better than the limit price.
     * @param   _isLong      True if the side is long.
     * @param   _fPrice       The price to be validate.
     * @param   _fPriceLimit  The limit price.
     */
    function _validatePrice(
        bool _isLong,
        int128 _fPrice,
        int128 _fPriceLimit
    ) internal pure {
        require(_fPrice > 0, "price must be positive");
        bool isPriceSatisfied = _isLong ? _fPrice <= _fPriceLimit : _fPrice >= _fPriceLimit;
        require(isPriceSatisfied, "price exceeds limit");
    }

    /**
     * Check if the mark price meets condition for stop order
     * Stop buy : buy if mark price >= trigger
     * Stop sell: sell if mark price <= trigger
     * @param   _isLong         True if the side is long.
     * @param   _fMarkPrice     Mark-price
     * @param   _fTriggerPrice  The trigger price.
     */
    function validateStopPrice(
        bool _isLong,
        int128 _fMarkPrice,
        int128 _fTriggerPrice
    ) external pure override {
        if (_fTriggerPrice == 0) {
            return;
        }
        // if stop order, mark price must meet trigger price condition
        bool isTriggerSatisfied = _isLong ? _fMarkPrice >= _fTriggerPrice : _fMarkPrice <= _fTriggerPrice;
        require(isTriggerSatisfied, "mark price does not meet stop order trigger condition");
    }

    /**
     * Get the max position amount of trader will be closed in the trade.
     * @param   _fPosition            Current position of trader.
     * @param   _fAmount              The trading amount of position.
     * @return  maxPositionToClose    The max position amount of trader will be closed in the trade.
     */
    function _shrinkToMaxPositionToClose(int128 _fPosition, int128 _fAmount) internal pure returns (int128) {
        require(_fPosition != 0, "trader has no position to close");
        require(!_hasTheSameSign(_fPosition, _fAmount), "trade is close only");
        return _fAmount.abs() > _fPosition.abs() ? _fPosition.neg() : _fAmount;
    }

    /**
     * If the trader has opened position in the trade, his account should be
     * initial margin safe after the trade. If not, his account should be margin safe
     * @param   _perpetual          reference perpetual.
     * @param   _traderAddr         The address of trader.
     * @param   _referrerAddr       The address of referrer who will get rebate from the deal.
     * @param   _fDeltaPositionBC   The signed trade size(in base currency).
     * @param   _hasOpened          Does the trader open a position or close?
     * @return  fee      The total fee collected from the trader after the trade
     */
    function _distributeFees(
        PerpetualData storage _perpetual,
        address _traderAddr,
        address _referrerAddr,
        int128 _fDeltaPositionBC,
        bool _hasOpened
    ) internal returns (int128) {
        // fees
        int128 fTreasuryFee;
        int128 fPnLparticipantFee;
        int128 fReferralRebate;

        LiquidityPoolData storage liqPool = _getLiquidityPoolFromPerpetual(_perpetual.id);
        {
            (fPnLparticipantFee, fTreasuryFee, fReferralRebate) = _calculateFees(_perpetual, _traderAddr, _referrerAddr, _fDeltaPositionBC.abs(), _hasOpened);
        }
        int128 fTotalFee = fPnLparticipantFee.add(fTreasuryFee).add(fReferralRebate);
        _updateTraderMargin(_perpetual, _traderAddr, fTotalFee.neg());

        int128 fAMMFundContribution;
        int128 fDefaultFundContribution;
        (fAMMFundContribution, fDefaultFundContribution) = _calculateContributions(liqPool, fTreasuryFee);

        // send fee
        _transferFee(liqPool, _perpetual, _traderAddr, _referrerAddr, fPnLparticipantFee, fReferralRebate, fDefaultFundContribution, fAMMFundContribution);
        emit DistributeFees(liqPool.id, _perpetual.id, _traderAddr, fTreasuryFee, fPnLparticipantFee);
        return fTotalFee;
    }

    /**
     * @dev AMM fund receives the treasury fee
     *      If the resulting AMM fund size exceeds target, the fee is sent to the default fund
     *      If the resulting AMM fund is below target,
     *      the amount above Default Fund target is used to refill the AMM fund.
     *
     * @param   _pool          Liquidity pool reference
     * @param   _fTreasuryFee  Fee to be added from user to AMM/Default Fund
     * @return  AMM fund withdrawal/deposit, Default Fund withdrawal/deposit
     */
    function _calculateContributions(LiquidityPoolData storage _pool, int128 _fTreasuryFee) internal view returns (int128, int128) {
        int128 fAMMFundCashOld = _pool.fAMMFundCashCC;
        int128 fAMMFundCashNew = fAMMFundCashOld.add(_fTreasuryFee);
        if (fAMMFundCashNew > _pool.fTargetAMMFundSize) {
            // AMM fund exceeds target after adding fee.
            // We add to AMM fund
            return (_fTreasuryFee, 0);
        } else {
            // AMM fund below target after adding fee
            int128 fDefaultFundGap = _pool.fTargetDFSize.sub(_pool.fDefaultFundCashCC);
            if (fDefaultFundGap > 0) {
                // default fund underfunded, add fee to AMM and leave default fund unchanged
                return (_fTreasuryFee, 0);
            } else {
                fDefaultFundGap = fDefaultFundGap.neg();
                // default fund exceeds target, we can withdraw from DF to pay AMM gap
                int128 fAMMFundGap = _pool.fTargetAMMFundSize.sub(fAMMFundCashNew);
                int128 fDefaultFundContribution = fAMMFundGap > fDefaultFundGap ? fDefaultFundGap : fAMMFundGap;
                int128 fAMMFundContribution = _fTreasuryFee.add(fDefaultFundContribution);
                return (fAMMFundContribution, fDefaultFundContribution.neg());
            }
        }
    }

    /**
     * @dev     Get the fees of the trade. If the margin of the trader is not enough for fee:
     *            1. If trader open position, the trade will be reverted.
     *            2. If trader close position, the fee will be decreasing in proportion according to
     *               the margin left in the trader's account
     *          The rebate of referral will only calculate the lpFee and treasuryFee.
     *          The vault fee will not be counted in.
     *
     * @param   _perpetual          The reference of pereptual storage.
     * @param   _traderAddr         The address of trader.
     * @param   _referrerAddr       The address of referrer who will get rebate from the deal.
     * @param   _fDeltaPos          The (abs) trade size in base currency.
     * @return  PnL participant fee earning, treasury fee earning, refferral fee earning.
     */
    function _calculateFees(
        PerpetualData storage _perpetual,
        address _traderAddr,
        address _referrerAddr,
        int128 _fDeltaPos,
        bool _hasOpened
    )
        internal
        view
        returns (
            int128,
            int128,
            int128
        )
    {
        require(_fDeltaPos >= 0, "absolute trade value required");
        // convert to collateral currency
        _fDeltaPos = _fDeltaPos.mul(_getBaseToCollateralConversionMultiplier(_perpetual, false));

        int128 fTreasuryFee;
        int128 fPnLparticipantFee;
        int128 fReferralRebate;
        (fTreasuryFee, fPnLparticipantFee, fReferralRebate) = _getAMMPerpLogic().getTradeFees(
                _fDeltaPos,
                _perpetual.fTreasuryFeeRate,
                _perpetual.fPnLPartRate,
                _perpetual.fReferralRebateCC,
                _referrerAddr);
        // if the trader opens the position, 'available margin' is the margin balance - initial margin
        // requirement. If the trader closes, 'available margin' is the remaining margin balance
        if (!_hasOpened) {
            int128 fAvailableMargin = _getMarginViewLogic().getMarginBalance(_perpetual.id, _traderAddr);
            if (fAvailableMargin <= 0) {
                fPnLparticipantFee = 0;
                fTreasuryFee = 0;
                fReferralRebate = 0;
            } else if (fPnLparticipantFee.add(fTreasuryFee).add(fReferralRebate) > fAvailableMargin) {
                // make sure the sum of fees = available margin
                int128 fRate = fAvailableMargin.div(fPnLparticipantFee.add(fTreasuryFee).add(fReferralRebate));
                fTreasuryFee = fTreasuryFee.mul(fRate);
                fReferralRebate = fReferralRebate.mul(fRate);
                fPnLparticipantFee = fAvailableMargin.sub(fTreasuryFee).sub(fReferralRebate);
            }
        } else {
            //_hasOpened, get initial margin balance and ensure fees smaller
            int128 fAvailableMargin = _getMarginViewLogic().getAvailableMargin(_perpetual.id, _traderAddr, true);
            // If the margin of the trader is not enough for fee: If trader open position, the trade will be reverted.
            require(fPnLparticipantFee.add(fTreasuryFee).add(fReferralRebate) <= fAvailableMargin, "margin not enough");
        }
        
        return (fPnLparticipantFee, fTreasuryFee, fReferralRebate);
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualTradeLogic");
        bytes4[] memory functionList = new bytes4[](6);
        functionList[0] = this.executeTrade.selector;
        functionList[1] = this.preTrade.selector;
        functionList[2] = this.distributeFees.selector;
        functionList[3] = this.getMaxSignedTradeSizeForPos.selector;
        functionList[4] = this.validateStopPrice.selector;
        functionList[5] = this.distributeFeesNoRef.selector;
        return (functionList, moduleName);
    }
}
