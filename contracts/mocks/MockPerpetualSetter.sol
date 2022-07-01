// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "./IMockPerpetualSetter.sol";
import "../perpetual/interfaces/IFunctionList.sol";
import "../perpetual/functions/PerpetualBaseFunctions.sol";
import "../libraries/Utils.sol";

contract MockPerpetualSetter is PerpetualBaseFunctions, IMockPerpetualSetter, IFunctionList {
    using ABDKMath64x64 for int128;

    function setPerpetualState(bytes32 _iPerpetualId, uint256 _state) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        perpetual.state = PerpetualState(_state);
    }

    function setPnLparticipantsCashCC(uint16 _poolId, int128 _fPnLparticipantsCashCC) external override {
        require(_fPnLparticipantsCashCC >= 0, "cannot have negative PnL participants cash");
        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        pool.fPnLparticipantsCashCC = _fPnLparticipantsCashCC;
    }

    function setTraderPosition(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _value
    ) external override {
        marginAccounts[_iPerpetualId][_traderAddr].fPositionBC = _value;
    }

    function setTraderFCashCC(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _fCashCC
    ) external override {
        marginAccounts[_iPerpetualId][_traderAddr].fCashCC = _fCashCC;
    }

    function setMarginAccount(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _fLockedInValueQC,
        int128 _fCashCC,
        int128 _fPositionBC
    ) external override {
        require(_fCashCC >= 0, "cannot have negative cash in setter");
        /* set negative value for fLockedInValueQC and fPositionBC, e.g., 
           if AMM position is =1, set _fPositionBC=-1
           this is by definition since K=-AMM Pos, and L=-AMM locked in value
           - locked in value and amm pos (=K) are an aggregate from
           trades.*/
        marginAccounts[_iPerpetualId][_traderAddr].fLockedInValueQC = _fLockedInValueQC;
        marginAccounts[_iPerpetualId][_traderAddr].fCashCC = _fCashCC;
        marginAccounts[_iPerpetualId][_traderAddr].fPositionBC = _fPositionBC;
    }

    function setPerpetualFees(
        bytes32 _iPerpetualId,
        int128 _fTreasuryFeeRate,
        int128 _fPnLPartRate,
        int128 _fReferralRebateCC
    ) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        perpetual.fTreasuryFeeRate = _fTreasuryFeeRate;
        perpetual.fPnLPartRate = _fPnLPartRate;
        perpetual.fReferralRebateCC = _fReferralRebateCC;
    }

    function setTargetAMMFundSize(uint16 _poolId, int128 _value) external override {
        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        pool.fTargetAMMFundSize = _value;
        // need to update perpetual too
    }

    function setTargetDFSize(uint16 _poolId, int128 _value) external override {
        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        pool.fTargetDFSize = _value;
        // need to update perpetual too
    }

    function setAMMFundCashCC(uint16 _poolId, int128 _value) external override {
        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        pool.fAMMFundCashCC = _value;
        // need to update perpetual too
    }

    function setDefaultFundCashCC(uint16 _poolId, int128 _value) external override {
        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        pool.fDefaultFundCashCC = _value;
    }

    function setUnitAccumulatedFunding(bytes32 _iPerpetualId, int128 _value) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        perpetual.fUnitAccumulatedFunding = _value;
    }

    function setCurrentAMMExposureEMAs(
        bytes32 _iPerpetualId,
        int128 _fema0,
        int128 _fema1
    ) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        perpetual.fCurrentAMMExposureEMA[0] = _fema0;
        perpetual.fCurrentAMMExposureEMA[1] = _fema1;
    }

    function setCurrentTraderExposureEMA(bytes32 _iPerpetualId, int128 ema) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        perpetual.fCurrentTraderExposureEMA = ema.abs();
    }

    function setDFLambda(
        bytes32 _iPerpetualId,
        int128 lambda0,
        int128 lambda1
    ) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        perpetual.fDFLambda[0] = lambda0;
        perpetual.fDFLambda[1] = lambda1;
    }

    function setGenericPriceData(
        bytes32 _iPerpetualId,
        string memory _varName,
        int128 _fPX
    ) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        if (this.isStringEqual(_varName, "indexS2PriceData")) {
            oraclePriceData[perpetual.oracleS2Addr].fPrice = _fPX;
            oraclePriceData[perpetual.oracleS2Addr].time = uint64(block.timestamp);
        } else if (this.isStringEqual(_varName, "indexS3PriceData")) {
            oraclePriceData[perpetual.oracleS3Addr].fPrice = _fPX;
            oraclePriceData[perpetual.oracleS3Addr].time = uint64(block.timestamp);
        } else if (this.isStringEqual(_varName, "settlementS2PriceData")) {
            perpetual.fSettlementS2PriceData = _fPX;
        } else if (this.isStringEqual(_varName, "settlementS3PriceData")) {
            perpetual.fSettlementS3PriceData = _fPX;
        } else if (this.isStringEqual(_varName, "currentPremiumRate")) {
            perpetual.fCurrentPremiumRate = _fPX;
        } else if (this.isStringEqual(_varName, "currentMarkPremiumRate")) {
            perpetual.premiumRatesEMA = _fPX;
            perpetual.currentMarkPremiumRate.fPrice = _fPX;
            perpetual.currentMarkPremiumRate.time = uint64(block.timestamp);
        } else {}
    }

    function setGenericPerpInt128(
        bytes32 _iPerpetualId,
        string memory _varName,
        int128 _value
    ) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        if (this.isStringEqual(_varName, "fCurrentFundingRate")) {
            perpetual.fCurrentFundingRate = _value;
        } else if (this.isStringEqual(_varName, "fUnitAccumulatedFunding")) {
            perpetual.fUnitAccumulatedFunding = _value;
        } else if (this.isStringEqual(_varName, "fOpenInterest")) {
            perpetual.fOpenInterest = _value;
        } else if (this.isStringEqual(_varName, "fTargetDFSize")) {
            // update liq pool cash too
            PerpStorage.LiquidityPoolData storage pool = liquidityPools[perpetual.poolId];
            if (pool.isRunning && perpetual.state == PerpetualState.NORMAL) {
                // subtract current value in pool
                pool.fTargetDFSize = pool.fTargetDFSize.sub(perpetual.fTargetDFSize);
                // update pool value
                pool.fTargetDFSize = pool.fTargetDFSize.add(_value);
            }
            // update perp-storage
            perpetual.fTargetDFSize = _value;
        } else if (this.isStringEqual(_varName, "fTargetAMMFundSize")) {
            // update liq pool cash too
            PerpStorage.LiquidityPoolData storage pool = liquidityPools[perpetual.poolId];
            if (pool.isRunning && perpetual.state == PerpetualState.NORMAL) {
                // subtract current value in pool
                pool.fTargetAMMFundSize = pool.fTargetAMMFundSize.sub(perpetual.fTargetAMMFundSize);
                // update pool value
                pool.fTargetAMMFundSize = pool.fTargetAMMFundSize.add(_value);
            }
            // update perp-storage
            perpetual.fTargetAMMFundSize = _value;
        } else if (this.isStringEqual(_varName, "fAMMFundCashCC")) {
            // update liq pool cash too
            PerpStorage.LiquidityPoolData storage pool = liquidityPools[perpetual.poolId];
            if (pool.isRunning && perpetual.state == PerpetualState.NORMAL) {
                // subtract current value in pool
                pool.fAMMFundCashCC = pool.fAMMFundCashCC.sub(perpetual.fAMMFundCashCC);
                // update pool value
                pool.fAMMFundCashCC = pool.fAMMFundCashCC.add(_value);
            } /* uncomment for warning:
                else {
                if(!pool.isRunning) { 
                }
                 if(perpetual.state!=PerpetualState.NORMAL) { 
                }
            }*/
            // update perp-storage
            perpetual.fAMMFundCashCC = _value;
        } else if (this.isStringEqual(_varName, "fMaxTotalTraderFunds")) {
            PerpStorage.LiquidityPoolData storage pool = liquidityPools[perpetual.poolId];
            if (pool.isRunning && perpetual.state == PerpetualState.NORMAL) {
                pool.fMaxTotalTraderFunds = _value;
            }
        } else if (this.isStringEqual(_varName, "fInitialMarginRateAlpha")) {
            perpetual.fInitialMarginRateAlpha = _value;
        } else if (this.isStringEqual(_varName, "fMarginRateBeta")) {
            perpetual.fMarginRateBeta = _value;
        } else if (this.isStringEqual(_varName, "fInitialMarginRateCap")) {
            perpetual.fInitialMarginRateCap = _value;
        } else if (this.isStringEqual(_varName, "fMaintenanceMarginRateAlpha")) {
            perpetual.fMaintenanceMarginRateAlpha = _value;
        } else if (this.isStringEqual(_varName, "fTreasuryFeeRate")) {
            perpetual.fTreasuryFeeRate = _value;
        } else if (this.isStringEqual(_varName, "fPnLPartRate")) {
            perpetual.fPnLPartRate = _value;
        } else if (this.isStringEqual(_varName, "fReferralRebateCC")) {
            perpetual.fReferralRebateCC = _value;
        } else if (this.isStringEqual(_varName, "fLiquidationPenaltyRate")) {
            perpetual.fLiquidationPenaltyRate = _value;
        } else if (this.isStringEqual(_varName, "fMinimalSpread")) {
            perpetual.fMinimalSpread = _value;
        } else if (this.isStringEqual(_varName, "fMinimalSpreadInStress")) {
            perpetual.fMinimalSpreadInStress = _value;
        } else if (this.isStringEqual(_varName, "fLotSizeBC")) {
            perpetual.fLotSizeBC = _value;
        } else if (this.isStringEqual(_varName, "fFundingRateClamp")) {
            perpetual.fFundingRateClamp = _value;
        } else if (this.isStringEqual(_varName, "fMarkPriceEMALambda")) {
            perpetual.fMarkPriceEMALambda = _value;
        } else if (this.isStringEqual(_varName, "fSigma2")) {
            perpetual.fSigma2 = _value;
        } else if (this.isStringEqual(_varName, "fSigma3")) {
            perpetual.fSigma3 = _value;
        } else if (this.isStringEqual(_varName, "fRho23")) {
            perpetual.fRho23 = _value;
        } else if (this.isStringEqual(_varName, "fDFCoverNRate")) {
            perpetual.fDFCoverNRate = _value;
        } else if (this.isStringEqual(_varName, "fAMMMinSizeCC")) {
            perpetual.fAMMMinSizeCC = _value;
        } else if (this.isStringEqual(_varName, "fCurrentTraderExposureEMA")) {
            perpetual.fCurrentTraderExposureEMA = _value;
        } else if (this.isStringEqual(_varName, "fMinimalTraderExposureEMA")) {
            perpetual.fMinimalTraderExposureEMA = _value;
        } else if (this.isStringEqual(_varName, "fMinimalAMMExposureEMA")) {
            perpetual.fMinimalAMMExposureEMA = _value;
        } else if (this.isStringEqual(_varName, "fMaximalTradeSizeBumpUp")) {
            perpetual.fMaximalTradeSizeBumpUp = _value;
        } else if (this.isStringEqual(_varName, "fTotalMarginBalance")) {
            perpetual.fTotalMarginBalance = _value;
        } else if (this.isStringEqual(_varName, "fkStar")) {
            perpetual.fkStar = _value;
        } else if (this.isStringEqual(_varName, "fkStarSide")) {
            perpetual.fkStarSide = _value;
        } else {}
    }

    function setGenericPairData(
        bytes32 _iPerpetualId,
        string memory _varName,
        int128 _value1,
        int128 _value2
    ) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        if (this.isStringEqual(_varName, "fStressReturnS2")) {
            perpetual.fStressReturnS2[0] = _value1;
            perpetual.fStressReturnS2[1] = _value2;
        } else if (this.isStringEqual(_varName, "fStressReturnS3")) {
            perpetual.fStressReturnS3[0] = _value1;
            perpetual.fStressReturnS3[1] = _value2;
        } else if (this.isStringEqual(_varName, "fDFLambda")) {
            perpetual.fDFLambda[0] = _value1;
            perpetual.fDFLambda[1] = _value2;
        } else if (this.isStringEqual(_varName, "fCurrentAMMExposureEMA")) {
            perpetual.fCurrentAMMExposureEMA[0] = _value1;
            perpetual.fCurrentAMMExposureEMA[1] = _value2;
        } else if (this.isStringEqual(_varName, "fAMMTargetDD")) {
            perpetual.fAMMTargetDD[0] = _value1;
            perpetual.fAMMTargetDD[1] = _value2;
        } else {}
    }

    function isStringEqual(string memory _a, string memory _b) external pure override returns (bool) {
        return keccak256(bytes(_a)) == keccak256(bytes(_b));
    }

    function setCollateralCurrency(bytes32 _iPerpetualId, int256 _ccyIdx) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        if (_ccyIdx == 0) {
            perpetual.eCollateralCurrency = AMMPerpLogic.CollateralCurrency.QUOTE;
        } else if (_ccyIdx == 1) {
            perpetual.eCollateralCurrency = AMMPerpLogic.CollateralCurrency.BASE;
        } else {
            perpetual.eCollateralCurrency = AMMPerpLogic.CollateralCurrency.QUANTO;
        }
    }

    function setLiqPoolRedemptionRate(bytes32 _iPerpetualId, int128 _fRate) external override {
        LiquidityPoolData storage lp = _getLiquidityPoolFromPerpetual(_iPerpetualId);
        lp.fRedemptionRate = _fRate;
    }

    function setPerpPriceUpdateTime(bytes32 _iPerpetualId, uint64 _iPriceUpdateTimeSec) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        perpetual.iPriceUpdateTimeSec = _iPriceUpdateTimeSec;
    }

    function getFunctionList() external pure override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("MockPerpetualSetter");
        bytes4[] memory functionList = new bytes4[](21);
        functionList[0] = this.setPerpetualState.selector;
        functionList[1] = this.setPnLparticipantsCashCC.selector;
        functionList[2] = this.setTraderPosition.selector;
        functionList[3] = this.setMarginAccount.selector;
        functionList[4] = this.setPerpetualFees.selector;
        functionList[5] = this.setTargetAMMFundSize.selector;
        functionList[6] = this.setTargetDFSize.selector;
        functionList[7] = this.setAMMFundCashCC.selector;
        functionList[8] = this.setDefaultFundCashCC.selector;
        functionList[9] = this.setUnitAccumulatedFunding.selector;
        functionList[10] = this.setCurrentAMMExposureEMAs.selector;
        functionList[11] = this.setTraderFCashCC.selector;
        functionList[12] = this.setCurrentTraderExposureEMA.selector;
        functionList[13] = this.setDFLambda.selector;
        functionList[14] = this.setGenericPriceData.selector;
        functionList[15] = this.setGenericPerpInt128.selector;
        functionList[16] = this.isStringEqual.selector;
        functionList[17] = this.setCollateralCurrency.selector;
        functionList[18] = this.setGenericPairData.selector;
        functionList[19] = this.setLiqPoolRedemptionRate.selector;
        functionList[20] = this.setPerpPriceUpdateTime.selector;

        return (functionList, moduleName);
    }
}
