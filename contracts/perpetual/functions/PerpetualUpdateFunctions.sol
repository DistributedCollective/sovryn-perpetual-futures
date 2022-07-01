// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../../interface/ISpotOracle.sol";
import "./PerpetualRebalanceFunctions.sol";

contract PerpetualUpdateFunctions is PerpetualRebalanceFunctions {
    using ABDKMath64x64 for int128;
    using ConverterDec18 for int128;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
    int128 constant BASE_RATE = 0x068db8bac710cb; //0.0001 or 1 bps

    /**
     * @dev     Update the funding state of the perpetual. Funding payment of 
     *          every account in the perpetual is updated.
     *          Update the fUnitAccumulatedFunding variable in perpetual.
     *          After that, funding payment of every account in the perpetual is updated,
     *
     *          fUnitAccumulatedFunding := fUnitAccumulatedFunding
     *                                    + 'index price' * fundingRate * elapsedTime/fundingInterval
     *                                      * 1/'collateral price'
     * @param   _perpetual   perpetual to be updated
     */
    function _accumulateFundingInPerp(PerpetualData storage _perpetual) internal {
        if (uint64(block.timestamp) <= _perpetual.iLastFundingTime) {
            // already updated
            return;
        }
        uint256 iTimeElapsed = block.timestamp - uint256(_perpetual.iLastFundingTime);
        // block.timestamp > iLastFundingTime, so safe:
        // convert timestamp to ABDK64.64
        int128 fTimeElapsed = ABDKMath64x64.fromUInt(iTimeElapsed);
        if (_perpetual.state != PerpetualState.NORMAL) {
            return;
        }
        // determine payment in collateral currency for 1 unit of base currency \
        // (e.g. USD payment for 1 BTC for BTCUSD)
        int128 fInterestPaymentLong = fTimeElapsed.mul(_perpetual.fCurrentFundingRate).div(FUNDING_INTERVAL_SEC);
        // fInterestPaymentLong will be applied to 'base currency 1' (multiply with position size)
        // Finally, we convert this payment from base currency into collateral currency
        int128 fConversion = _getBaseToCollateralConversionMultiplier(_perpetual, false);
        fInterestPaymentLong = fInterestPaymentLong.mul(fConversion);
        _perpetual.fUnitAccumulatedFunding = _perpetual.fUnitAccumulatedFunding.add(fInterestPaymentLong);
        emit UpdateUnitAccumulatedFunding(_perpetual.id, _perpetual.fUnitAccumulatedFunding);
    }

    /**
     * Get the index price of the perpetual. If the state of the perpetual is not "NORMAL",
     * return the settlement price
     * @param   _perpetual  The reference of perpetual storage.
     * @return  The index price for the given perpetual
     */
    function _getIndexPrice(PerpetualData storage _perpetual) internal view returns (int128) {
        return _perpetual.state == PerpetualState.NORMAL ? oraclePriceData[_perpetual.oracleS2Addr].fPrice : _perpetual.fSettlementS2PriceData;
    }

    /**
     * Get the mark price premium rate. If the state of the perpetual is not "NORMAL",
     * return the settlement price
     * @param   _perpetual   The reference of perpetual storage.
     * @return  The index price for the given perpetual
     */
    function _getMarkPremiumRateEMA(PerpetualData storage _perpetual) internal view returns (int128) {
        return _perpetual.state != PerpetualState.NORMAL ? _perpetual.fSettlementMarkPremiumRate : _perpetual.currentMarkPremiumRate.fPrice;
    }

    /**
     * Update the funding rate of each perpetual that belongs to the given liquidity pool
     * @param   _perpetual   perpetual to be updated
     */
    function _updateFundingRatesInPerp(PerpetualData storage _perpetual) internal {
        if (_perpetual.iLastFundingTime >= uint64(block.timestamp)) {
            // invalid time
            return;
        }
        if (_perpetual.state != PerpetualState.NORMAL) {
            return;
        }
        _updateFundingRate(_perpetual);
        //update iLastFundingTime (we need it in _accumulateFundingInPerp and _updateFundingRatesInPerp)
        _perpetual.iLastFundingTime = uint64(block.timestamp);
    }

    /**
     * Update the funding rate of the perpetual.
     *
     * premium rate = 'EMA of signed insurance premium' / 'spot price'
     * funding rate = max(premium rate, d) + min(premium rate, -d) + sgn(K)*b,
     *      with 'base rate' b = 0.0001, d = 0.0005. See whitepaper.
     * The long pays the funding rate to the short,
     * the short receives. Hence if positive, the short receives,
     * if negative, the short pays.
     *
     * @param  _perpetual   The reference of perpetual storage.
     */
    function _updateFundingRate(PerpetualData storage _perpetual) internal {
        // Get EMA of insurance premium, add to spot price oracle
        // similar to https://www.deribit.com/pages/docs/perpetual
        // and calculate funding rate

        int128 fFundingRate;
        int128 fFundingRateClamp = _perpetual.fFundingRateClamp;
        int128 fPremiumRate = _getMarkPremiumRateEMA(_perpetual);
        // clamp the rate
        if (fPremiumRate > fFundingRateClamp) {
            fFundingRate = fPremiumRate.sub(fFundingRateClamp);
        } else if (fPremiumRate < fFundingRateClamp.neg()) {
            fFundingRate = fPremiumRate.add(fFundingRateClamp);
        }
        MarginAccount memory AMMMarginAcc = marginAccounts[_perpetual.id][address(this)];
        int128 K2 = AMMMarginAcc.fPositionBC.neg();
        int128 fBase = K2 >= 0 ? BASE_RATE : BASE_RATE.neg();
        fFundingRate = fFundingRate.add(fBase);
        // cap: 90% * (initialmargin - maintenance)
        int128 scale = 0xe666666666666800;
        int128 fCap = scale.mul(_perpetual.fInitialMarginRateAlpha.sub(_perpetual.fMaintenanceMarginRateAlpha));
        if (fFundingRate < fCap.neg()) {
            fFundingRate = fCap.neg();
        } else if (fFundingRate > fCap) {
            fFundingRate = fCap;
        }
        _perpetual.fCurrentFundingRate = fFundingRate;
        emit UpdateFundingRate(_perpetual.id, fFundingRate);
    }

    //== Treasury ==========================================================================================================================

    /**
     * Get the locked-in value of the trader positions in the perpetual
     * @param _perpetual The perpetual object
     * @param _traderAddr The address of the trader
     * @return The locked-in value
     */
    function _getLockedInValue(PerpetualData storage _perpetual, address _traderAddr) internal view returns (int128) {
        return marginAccounts[_perpetual.id][_traderAddr].fLockedInValueQC;
    }

    /**
     * Updates the target size for AMM pool.
     * See whitepaper for formulas.
     * @param   _perpetual     Reference to the perpetual that needs an updated target size
     */
    function _updateAMMTargetFundSize(PerpetualData storage _perpetual, int128 _fNewTargetFundSize) internal {
        LiquidityPoolData storage liquidityPool = _getLiquidityPoolFromPerpetual(_perpetual.id);
        int128 fOldTarget = _perpetual.fTargetAMMFundSize;
        _perpetual.fTargetAMMFundSize = _fNewTargetFundSize;
        // update total target sizes in pool data
        liquidityPool.fTargetAMMFundSize = liquidityPool.fTargetAMMFundSize.sub(fOldTarget).add(_perpetual.fTargetAMMFundSize);
        emit UpdateAMMFundTargetSize(
            _perpetual.id,
            liquidityPool.id,
            _perpetual.fAMMFundCashCC,
            _perpetual.fTargetAMMFundSize,
            liquidityPool.fAMMFundCashCC,
            liquidityPool.fTargetAMMFundSize
        );
    }

    /**
     * Updates the target size for default fund for one random perpetual
     * Update is performed only after 'iTargetPoolSizeUpdateTime' seconds after the
     * last update. See whitepaper for formulas.
     * @param   _iPoolIndex     Reference to liquidity pool
     */
    function _updateDefaultFundTargetSizeRandom(uint16 _iPoolIndex) internal {
        require(_iPoolIndex <= iPoolCount, "pool index out of range");
        LiquidityPoolData storage liquidityPool = liquidityPools[_iPoolIndex];
        // update of Default Fund target size for all perpetuals
        uint256 idx = uint16(block.timestamp % uint256(liquidityPool.iPerpetualCount));
        bytes32 id = perpetualIds[liquidityPool.id][idx];
        _updateDefaultFundTargetSize(id);
    }

    /**
     * Updates the target size for default fund a given perpetual
     * Update is performed only after 'iTargetPoolSizeUpdateTime' seconds after the
     * last update. See whitepaper for formulas.
     * @param   _iPerpetualId     Reference to perpetual
     */
    function _updateDefaultFundTargetSize(bytes32 _iPerpetualId) internal {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        LiquidityPoolData storage liquidityPool = _getLiquidityPoolFromPerpetual(_iPerpetualId);
        if (uint64(block.timestamp) - perpetual.iLastTargetPoolSizeTime > liquidityPool.iTargetPoolSizeUpdateTime &&
            perpetual.state == PerpetualState.NORMAL) 
        {
            // update of Default Fund target size for given perpetual
            int128 fDelta = perpetual.fTargetDFSize.neg();
            perpetual.fTargetDFSize = _getDefaultFundTargetSize(perpetual);
            fDelta = fDelta.add(perpetual.fTargetDFSize);
            // update the total value in the liquidity pool
            liquidityPool.fTargetDFSize = liquidityPool.fTargetDFSize.add(fDelta);
            // reset update time
            perpetual.iLastTargetPoolSizeTime = uint64(block.timestamp);
            emit UpdateDefaultFundTargetSize(liquidityPool.id, liquidityPool.fDefaultFundCashCC, liquidityPool.fTargetDFSize);
        }
        
    }

    /**
     * Recalculate the target size for the AMM liquidity pool for the given perpetual using
     * the current 'LockedInValue' and 'AMMExposure' (=K in whitepaper)
     * The AMM target fund size will not go below _perpetual.fAMMMinSizeCC
     *
     * @param   _perpetual      Reference to perpetual
     * @param   _ccy            Currency of collateral enum {QUOTE, BASE, QUANTO}
     * @param   _isBaseline     calculate fund size based on baseline or stress target?
     * @return  Target size in required currency (64.64 fixed point number)
     */
    function _getUpdatedTargetAMMFundSize(
        PerpetualData memory _perpetual,
        AMMPerpLogic.CollateralCurrency _ccy,
        bool _isBaseline
    ) internal view returns (int128) {
        // loop through perpetuals of this pool and update the
        // pool size
        AMMPerpLogic.MarketVariables memory mv;
        mv.fIndexPriceS2 = oraclePriceData[_perpetual.oracleS2Addr].fPrice;
        mv.fSigma2 = _perpetual.fSigma2;
        int128 fMStar;
        int128 fK = marginAccounts[_perpetual.id][address(this)].fPositionBC.neg();
        int128 fLockedIn = marginAccounts[_perpetual.id][address(this)].fLockedInValueQC.neg();
        // adjust current K and L for EMA trade size:
        fK = _perpetual.fkStarSide < 0 ? fK.add(_perpetual.fCurrentTraderExposureEMA) : fK.sub(_perpetual.fCurrentTraderExposureEMA);
        fLockedIn = _perpetual.fkStarSide < 0
            ? fLockedIn.add(_perpetual.fCurrentTraderExposureEMA.mul(mv.fIndexPriceS2))
            : fLockedIn.sub(_perpetual.fCurrentTraderExposureEMA.mul(mv.fIndexPriceS2));
        uint256 index = _isBaseline ? 0 : 1;
        if (_ccy == AMMPerpLogic.CollateralCurrency.BASE) {
            // get target collateral for current AMM exposure
            if (fK == 0 || fLockedIn == 0) {
                fMStar = _perpetual.fAMMMinSizeCC;
            } else {
                fMStar = _getAMMPerpLogic().getTargetCollateralM2(fK, fLockedIn, mv, _perpetual.fAMMTargetDD[index]);
            }
        } else if (_ccy == AMMPerpLogic.CollateralCurrency.QUANTO) {
            if (fK == 0) {
                fMStar = _perpetual.fAMMMinSizeCC;
            } else {
                // additional parameters
                mv.fSigma3 = _perpetual.fSigma3;
                mv.fRho23 = _perpetual.fRho23;
                mv.fIndexPriceS3 = oraclePriceData[_perpetual.oracleS3Addr].fPrice;
                // get target collateral for current AMM exposure
                fMStar = _getAMMPerpLogic().getTargetCollateralM3(fK, fLockedIn, mv, _perpetual.fAMMTargetDD[index]);
            }
        } else {
            assert(_ccy == AMMPerpLogic.CollateralCurrency.QUOTE);
            if (fK == 0) {
                fMStar = _perpetual.fAMMMinSizeCC;
            } else {
                // get target collateral for conservative negative AMM exposure
                fMStar = _getAMMPerpLogic().getTargetCollateralM1(fK, fLockedIn, mv, _perpetual.fAMMTargetDD[index]);
            }
        }
        if (fMStar < _perpetual.fAMMMinSizeCC) {
            fMStar = _perpetual.fAMMMinSizeCC;
        }
        return fMStar;
    }

    /**
     * @param   _perpetual      Reference to perpetual
     */
    function _getDefaultFundTargetSize(PerpetualData storage _perpetual) internal view returns (int128) {
        int128[2] memory fIndexPrices;
        fIndexPrices[0] = oraclePriceData[_perpetual.oracleS2Addr].fPrice;
        fIndexPrices[1] = oraclePriceData[_perpetual.oracleS3Addr].fPrice;
        uint256 len = activeAccounts[_perpetual.id].length();
        int128 fCoverN = _perpetual.fDFCoverNRate.mul(ABDKMath64x64.fromUInt(len));
        // floor for number of traders:
        if (fCoverN < 0x50000000000000000) {
            fCoverN = 0x50000000000000000; // =5
        }

        return
            _getAMMPerpLogic().calculateDefaultFundSize(
                _perpetual.fCurrentAMMExposureEMA,
                _perpetual.fCurrentTraderExposureEMA,
                fCoverN,
                _perpetual.fStressReturnS2,
                _perpetual.fStressReturnS3,
                fIndexPrices,
                _perpetual.eCollateralCurrency
            );
    }

    /**
     * Update the price data, which means the price and the update time
     * @param   _priceData   The price data to update.
     * @param   priceGetter  The function pointer to retrieve current price data.
     */
    function _updateOraclePriceData(OraclePriceData storage _priceData, function() external returns (int128, uint256) priceGetter) internal {
        (int128 fPrice, uint256 time) = priceGetter();
        require(fPrice > 0 && time != 0, "invalid price data");
        if (uint64(time) >= _priceData.time) {
            _priceData.fPrice = fPrice;
            _priceData.time = uint64(time);
        }
    }

    /**
     * Update the oracle price of the perpetual
     * If the relative price change exceeds PRICE_MOVE_THRESHOLD, the flag isInSignificant is set to true,
     * false otherwise.
     * @param   perpetual   The reference of perpetual storage.
     * @param   _iCurrentTimeSec   The current timestamp (block.timestamp)
     */
    function _updateSpotPrice(PerpetualData storage perpetual, uint256 _iCurrentTimeSec) internal {
        ISpotOracle oracle = ISpotOracle(perpetual.oracleS2Addr);
        if (oraclePriceData[perpetual.oracleS2Addr].time != _iCurrentTimeSec) {
            int128 fPriceBefore = oraclePriceData[perpetual.oracleS2Addr].fPrice;
            _updateOraclePriceData(oraclePriceData[perpetual.oracleS2Addr], oracle.getSpotPrice);
            oraclePriceData[perpetual.oracleS2Addr].isInSignificant =
                fPriceBefore != 0 &&
                oraclePriceData[perpetual.oracleS2Addr].fPrice.div(fPriceBefore).sub(ONE_64x64).abs() < PRICE_MOVE_THRESHOLD;
        }
        if (perpetual.oracleS3Addr != address(0)) {
            if (oraclePriceData[perpetual.oracleS3Addr].time != _iCurrentTimeSec) {
                // quanto currency
                int128 fPriceBefore = oraclePriceData[perpetual.oracleS3Addr].fPrice;
                oracle = ISpotOracle(perpetual.oracleS3Addr);
                _updateOraclePriceData(oraclePriceData[perpetual.oracleS3Addr], oracle.getSpotPrice);
                oraclePriceData[perpetual.oracleS3Addr].isInSignificant =
                    fPriceBefore != 0 &&
                    oraclePriceData[perpetual.oracleS3Addr].fPrice.div(fPriceBefore).sub(ONE_64x64).abs() < PRICE_MOVE_THRESHOLD;
            }
        }

        emit UpdatePrice(
            perpetual.id,
            perpetual.oracleS2Addr,
            perpetual.oracleS3Addr,
            oraclePriceData[perpetual.oracleS2Addr].fPrice,
            oraclePriceData[perpetual.oracleS2Addr].time,
            oraclePriceData[perpetual.oracleS3Addr].fPrice,
            oraclePriceData[perpetual.oracleS3Addr].time
        );
    }

    /**
     * @dev     Increase default fund cash
     * @param   _liquidityPool reference to liquidity pool data
     * @param   _fAmount     Signed 64.64-bit fixed point number. The amount of cash(collateral) to increase.
     */
    function _increaseDefaultFundCash(LiquidityPoolData storage _liquidityPool, int128 _fAmount) internal {
        require(_fAmount >= 0, "increase negative pool cash");
        _liquidityPool.fDefaultFundCashCC = _liquidityPool.fDefaultFundCashCC.add(_fAmount);
        emit UpdateDefaultFundCash(_liquidityPool.id, _fAmount, _liquidityPool.fDefaultFundCashCC);
    }

    /**
     * Update the oracle price of each perpetual of the liquidity pool.
     * If oracle is terminated, set market to EMERGENCY.
     * If price change is 'significant', the perpetual is rebalanced
     * (Mark Price is updated after rebalance)
     * @param   _iPoolIndex        The liquidity pool index
     */
    function _updateOraclePricesForPool(uint16 _iPoolIndex) internal {
        require(_iPoolIndex <= iPoolCount, "pool index out of range");
        LiquidityPoolData storage liquidityPool = liquidityPools[_iPoolIndex];
        
        uint256 length = liquidityPool.iPerpetualCount;
        for (uint256 i = 0; i < length; i++) {
            bytes32 perpIdx = perpetualIds[liquidityPool.id][i];
            PerpetualData storage perpetual = perpetuals[liquidityPool.id][perpIdx];
            if (perpetual.iPriceUpdateTimeSec >= uint64(block.timestamp)) {
                continue;
            }
            if (perpetual.state != PerpetualState.NORMAL) {
                continue;
            }
            _updateOraclePricesForPerp(perpetual);
        }
        
    }

    /**
    * Update the oracle price of the perpetual 
    * If price change is 'significant', the perpetual is rebalanced
    * (Mark Price is updated after rebalance)
    * @param _perpetual     reference to perpetual
    */
    function _updateOraclePricesForPerp(PerpetualData storage _perpetual) internal {
        _updateSpotPrice(_perpetual, block.timestamp);

        if (ISpotOracle(_perpetual.oracleS2Addr).isTerminated()) {
            _rebalance(_perpetual);
            _setEmergencyState(_perpetual);
        } else if (_perpetual.oracleS3Addr != address(0) && ISpotOracle(_perpetual.oracleS3Addr).isTerminated()) {
            _rebalance(_perpetual);
            _setEmergencyState(_perpetual);
        } else if (!oraclePriceData[_perpetual.oracleS2Addr].isInSignificant || !oraclePriceData[_perpetual.oracleS3Addr].isInSignificant) {
            // price change is significant since last update, so we rebalance
            _rebalance(_perpetual);
        }
        _perpetual.iPriceUpdateTimeSec = uint64(block.timestamp);
    }

    /**
     * @dev     Set the state of the perpetual to "NORMAL".
     *          The state must be "INITIALIZING" or "INVALID" before
     * @param   _perpetual   The reference of perpetual storage.
     */
    function _setNormalState(PerpetualData storage _perpetual) internal {
        require(
            _perpetual.state == PerpetualState.INITIALIZING || _perpetual.state == PerpetualState.INVALID,
            "perpetual should be in initializing or invalid state"
        );
        _perpetual.state = PerpetualState.NORMAL;
        emit SetNormalState(_perpetual.id);
    }
}
