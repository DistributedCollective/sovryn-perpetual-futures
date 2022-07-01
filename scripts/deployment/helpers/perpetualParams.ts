import {BigNumber} from "@ethersproject/bignumber";
import {floatToABK64x64} from "../../utils/perpMath";

export const PERPETUAL_BASE_PARAMS: BigNumber[] = [
    0.06, // perpetual.fInitialMarginRateAlpha = _baseParams[0];
    0.1, // perpetual.fMarginRateBeta = _baseParams[1];
    0.04, // perpetual.fMaintenanceMarginRateAlpha = _baseParams[2];
    0.1, // perpetual.fInitialMarginRateCap = _baseParams[3];
    0.0003, // perpetual.fTreasuryFeeRate = _baseParams[4];
    0.0003, // perpetual.fPnLPartRate = _baseParams[5];
    0.0001, // perpetual.fReferralRebateCC = _baseParams[6];
    0.002, // perpetual.fLiquidationPenaltyRate = _baseParams[7];
    0.0005, // perpetual.fMinimalSpread = _baseParams[8];
    0.001, // perpetual.fMinimalSpreadInStress = _baseParams[9];
    0.0001, // perpetual.fLotSizeBC = _baseParams[10];
].map(floatToABK64x64);

export const PERPETUAL_UNDERLYING_RISKS_PARAMS: BigNumber[] = [
    0.0005, // perpetual.fFundingRateClamp = _underlyingRiskParams[0];
    0.7, // perpetual.fMarkPriceEMALambda = _underlyingRiskParams[1];
    0.05, // perpetual.fSigma2 = _underlyingRiskParams[2];
    0.1, // perpetual.fSigma3 = _underlyingRiskParams[3];
    0.1, // perpetual.fRho23 = _underlyingRiskParams[4];
].map(floatToABK64x64);

export const PERPETUAL_DEFAULT_FUND_RISK_PARAMS: BigNumber[] = [
    -0.5, // perpetual.fStressReturnS2[0] = _defaultFundRiskParams[0];
    0.2, // perpetual.fStressReturnS2[1] = _defaultFundRiskParams[1];
    -0.1, // perpetual.fStressReturnS3[0] = _defaultFundRiskParams[2];
    0.1, // perpetual.fStressReturnS3[1] = _defaultFundRiskParams[3];
    0.04, // perpetual.fDFCoverN = _defaultFundRiskParams[4];
    0.999, // perpetual.fDFLambda[0] = _defaultFundRiskParams[5];
    0.25, // perpetual.fDFLambda[1] = _defaultFundRiskParams[6];
    -2.5828074520, // perpetual.fAMMTargetDD[0] = _defaultFundRiskParams[7];
    -2.053748910631823, // perpetual.fAMMTargetDD[1] = _defaultFundRiskParams[8];
    0.25, // perpetual.fAMMMinSizeCC = _defaultFundRiskParams[9];
    0.01, // perpetual.fMinimalTraderExposureEMA = _defaultFundRiskParams[10];
    1, //fMinimalAMMExposureEMA = _defaultFundRiskParams[11];
    1.25 //perpetual.fMaximalTradeSizeBumpUp= _defaultFundRiskParams[12];
].map(floatToABK64x64);
