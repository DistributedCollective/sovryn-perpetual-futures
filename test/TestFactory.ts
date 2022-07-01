// @ts-nocheck
import { fromBytes32, toBytes32, createContract, getAccounts } from "../scripts/utils/utils";
import { deployMockContract } from "ethereum-waffle";
import * as fs from "fs";
import { BytesLike } from "@ethersproject/bytes";
import { BigNumberish, BigNumber } from "ethers";
import { ABK64x64ToFloat, floatToABK64x64 } from "../scripts/utils/perpMath";
import { any } from "hardhat/internal/core/params/argumentTypes";
import { deployPerpetualManager } from "../scripts/deployment/deploymentUtil";
import { ITParameters } from "./test_scenarios/TestScenarioReader";
import { deployContract } from "../scripts/deployment/helpers/contracts";
const { ethers } = require("hardhat");

const BN = ethers.BigNumber;

const ONE_DEC18 = BN.from(10).pow(BN.from(18));
const ONE_64x64 = BN.from("0x010000000000000000");
const DOT_ONE_64x64 = floatToABK64x64(0.1);

const COLLATERAL_CURRENCY_QUOTE = 0;
const COLLATERAL_CURRENCY_BASE = 1;
const COLLATERAL_CURRENCY_QUANTO = 2;

const BTC = toBytes32("BTC");
const USD = toBytes32("USD");
const ETH = toBytes32("ETH");

export async function createOracle(baseCurrency, quoteCurrency) {
    let oracleFactory = await createContract("OracleFactory");

    let fileName = "artifacts/contracts/interface/IPriceFeedsExt.sol/IPriceFeedsExt.json";
    const file = fs.readFileSync(fileName, "utf8");
    let IPriceFeedsExt = JSON.parse(file);

    let accounts = await getAccounts();
    let mockPriceFeedsExt = await deployMockContract(accounts[0], IPriceFeedsExt.abi);
    await mockPriceFeedsExt.mock.latestAnswer.returns(ONE_DEC18);

    await oracleFactory.createOracle(baseCurrency, quoteCurrency, [mockPriceFeedsExt.address], [false]);
    let route = await oracleFactory.getRoute(baseCurrency, quoteCurrency);
    return route[0].oracle;
}

export async function createOracleForIT(baseCurrency, quoteCurrency) {
    return (await deployContract("MockSpotOracle", [baseCurrency, quoteCurrency])).address;
}

export async function createLiquidityPool(manager, owner, params: ITParameters[] = null) {
    let treasuryAddress = owner;

    let marginToken = await createContract("MockToken");
    await marginToken.mint(owner, ONE_DEC18.mul(1000000));
    let marginTokenAddress = marginToken.address;

    let iTargetPoolSizeUpdateTime = 10800;
    let iPnLparticipantWithdrawalPeriod = 86400 / 3;
    let fPnLparticipantWithdrawalPercentageLimit = floatToABK64x64(0.1);
    let fPnLparticipantWithdrawalMinAmountLimit = ONE_64x64.mul(5);
    let fMaxTotalTraderFunds = ONE_64x64.mul(-1);

    if (params != null) {
        for (let param of params) {
            if (param.parameter_name == "target_pool_size_update_time") {
                iTargetPoolSizeUpdateTime = param.value1;
            }
        }
    }

    await manager.createLiquidityPool(
        treasuryAddress,
        marginTokenAddress,
        iTargetPoolSizeUpdateTime,
        iPnLparticipantWithdrawalPeriod,
        fPnLparticipantWithdrawalPercentageLimit,
        fPnLparticipantWithdrawalMinAmountLimit,
        fMaxTotalTraderFunds
    );

    let id = await manager.getPoolCount();
    return { id, marginToken };
}

export function getBTCBaseParams() {
    let baseParams = [
        0.06, //fInitialMarginRateAlpha
        0.1, //perpetual.fMarginRateBeta = _baseParams[1];
        0.04, //perpetual.fMaintenanceMarginRateAlpha = _baseParams[2];
        0.1, //perpetual.fInitialMarginRateCap = _baseParams[3];
        0.0003, //perpetual.fTreasuryFeeRate = _baseParams[4];
        0.0003, //perpetual.fPnLPartRate = _baseParams[5];
        0.0001, //perpetual.fReferralRebateCC = _baseParams[6];
        0.002, //perpetual.fLiquidationPenaltyRate = _baseParams[7];
        0.00001, //perpetual.fMinimalSpread = _baseParams[8];
        0.00002, //perpetual.fMinimalSpreadInStress = _baseParams[9];
        0.0001, //perpetual.fLotSizeBC = _baseParams[10];
    ];
    // convert to ABDK format
    let baseParamsABDK = [];
    for (var j = 0; j < baseParams.length; j++) {
        baseParamsABDK[j] = floatToABK64x64(baseParams[j]);
    }
    return baseParamsABDK;
}

export function getBTCRiskParams() {
    let riskParams = [
        0.0005, //fFundingRateClamp = _underlyingRiskParams[0];
        0.999, //fMarkPriceEMALambda = _underlyingRiskParams[1];
        0.07, //fSigma2 = _underlyingRiskParams[2];
        0.05, //fSigma3 = _underlyingRiskParams[3];
        0.4, //fRho23 = _underlyingRiskParams[4];
    ];
    // convert to ABDK format
    let riskParamsABDK = [];
    for (var j = 0; j < riskParams.length; j++) {
        riskParamsABDK[j] = floatToABK64x64(riskParams[j]);
    }
    return riskParamsABDK;
}

export function getBTCFundRiskParams() {
    let riskParams = [
        -0.5, //perpetual.fStressReturnS2[0] = _defaultFundRiskParams[0];
        0.2, //perpetual.fStressReturnS2[1] = _defaultFundRiskParams[1];
        -0.2, //perpetual.fStressReturnS3[0] = _defaultFundRiskParams[2];
        0.1, //perpetual.fStressReturnS3[1] = _defaultFundRiskParams[3];
        0.05, //perpetual.fDFCoverNRate = _defaultFundRiskParams[4];
        0.999, //perpetual.fDFLambda[0] = _defaultFundRiskParams[5];
        0.25, //perpetual.fDFLambda[1] = _defaultFundRiskParams[6];
        -2.59, //perpetual.fAMMTargetDD = _defaultFundRiskParams[7];
        -2.053, //perpetual.fAMMTargetDD = _defaultFundRiskParams[8];
        0.25, //perpetual.fAMMMinSizeCC = _defaultFundRiskParams[9];
        0.01, //perpetual.fMinimalTraderExposureEMA= _defaultFundRiskParams[10];
        1, //perpetual.fMinimalAMMExposureEMA= _defaultFundRiskParams[11];
        1.25, //perpetual.fMaximalTradeSizeBumpUp= _defaultFundRiskParams[12];
    ];
    // convert to ABDK format
    let riskParamsABDK = [];
    for (var j = 0; j < riskParams.length; j++) {
        riskParamsABDK[j] = floatToABK64x64(riskParams[j]);
    }
    return riskParamsABDK;
}

async function _createPerpetualByManager(
    manager,
    poolId,
    oracles: any[],
    baseParams: BigNumber[],
    underlyingRiskParams,
    defaultFundRiskParams,
    _collCurrency = COLLATERAL_CURRENCY_BASE
) {
    await manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, _collCurrency);

    let poolCount = await manager.getPoolCount();
    let pool = await manager.getLiquidityPool(poolCount);
    let perpetualCount = pool.iPerpetualCount;
    return await manager.getPerpetualId(poolId, perpetualCount - 1);
}

export async function createPerpetual(
    manager,
    poolId,
    _baseParams: BigNumber[] = null,
    _riskParams = null,
    _defaultFundParams = null,
    _collCurrency = COLLATERAL_CURRENCY_BASE,
    oracles = null
) {
    if (oracles == null) {
        oracles = [await createOracle(BTC, USD), await createOracle(ETH, USD)];
    }

    let baseParams = _baseParams;
    if (_baseParams == null) {
        baseParams = getBTCBaseParams();
    }
    let underlyingRiskParams = _riskParams;
    if (underlyingRiskParams == null) {
        underlyingRiskParams = getBTCRiskParams();
    }
    let defaultFundRiskParams = _defaultFundParams;
    if (defaultFundRiskParams == null) {
        defaultFundRiskParams = getBTCFundRiskParams();
    }
    return await _createPerpetualByManager(manager, poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, _collCurrency);
}

export async function createPerpetualWithOracles(
    manager,
    poolId,
    oracles,
    _baseParams: BigNumber[] = null,
    _riskParams = null,
    _defaultFundParams = null,
    _collCurrency = COLLATERAL_CURRENCY_BASE
) {
    let baseParams = _baseParams;
    if (_baseParams == null) {
        baseParams = getBTCBaseParams();
    }
    let underlyingRiskParams = _riskParams;
    if (underlyingRiskParams == null) {
        underlyingRiskParams = getBTCRiskParams();
    }
    let defaultFundRiskParams = _defaultFundParams;
    if (defaultFundRiskParams == null) {
        defaultFundRiskParams = getBTCFundRiskParams();
    }
    return await _createPerpetualByManager(manager, poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, _collCurrency);
}

export async function createPerpetualForIT(manager, poolId, oracles, params: ITParameters[], _collCurrency = COLLATERAL_CURRENCY_BASE) {
    let baseParams: BigNumber[] = [
        0.06, // perpetual.fInitialMarginRateAlpha = _baseParams[0];
        0.1, // perpetual.fMarginRateBeta = _baseParams[1];
        0.04, // perpetual.fMaintenanceMarginRateAlpha = _baseParams[2];
        0.1, // perpetual.fInitialMarginRateCap = _baseParams[3];
        0.0003, // perpetual.fTreasuryFeeRate = _baseParams[4];
        0.0003, // perpetual.fPnLPartRate = _baseParams[5];
        0.0001, // perpetual.fReferralRebateCC = _baseParams[6];
        0.002, // perpetual.fLiquidationPenaltyRate = _baseParams[7];
        0.00001, // perpetual.fMinimalSpread = _baseParams[8];
        0.00002, // perpetual.fMinimalSpreadInStress = _baseParams[9];
        0.0001, // perpetual.fLotSizeBC = _baseParams[10];
    ].map(floatToABK64x64);

    let underlyingRisksParams: BigNumber[] = [
        0.0005, // perpetual.fFundingRateClamp = _underlyingRiskParams[0];
        0.7, // perpetual.fMarkPriceEMALambda = _underlyingRiskParams[1];
        0.05, // perpetual.fSigma2 = _underlyingRiskParams[2];
        0.1, // perpetual.fSigma3 = _underlyingRiskParams[3];
        0.1, // perpetual.fRho23 = _underlyingRiskParams[4];
    ].map(floatToABK64x64);

    let defaultFundRiskParams: BigNumber[] = [
        -0.5, // perpetual.fStressReturnS2[0] = _defaultFundRiskParams[0];
        0.2, // perpetual.fStressReturnS2[1] = _defaultFundRiskParams[1];
        -0.1, // perpetual.fStressReturnS3[0] = _defaultFundRiskParams[2];
        0.1, // perpetual.fStressReturnS3[1] = _defaultFundRiskParams[3];
        0.05, // perpetual.fDFCoverNRate = _defaultFundRiskParams[4];
        0.999, // perpetual.fDFLambda[0] = _defaultFundRiskParams[5];
        0.25, // perpetual.fDFLambda[1] = _defaultFundRiskParams[6];
        -2.582807452, // perpetual.fAMMTargetDD = _defaultFundRiskParams[7];
        -2.053748910631823, // perpetual.fAMMTargetDD = _defaultFundRiskParams[8];
        0.25, // perpetual.fAMMMinSizeCC = _defaultFundRiskParams[9];
        0.01, // perpetual.fMinimalTraderExposureEMA = _defaultFundRiskParams[10];
        1, // perpetual.fMinimalAMMExposureEMA = _defaultFundRiskParams[11];
        1.25, //perpetual.fMaximalTradeSizeBumpUp= _defaultFundRiskParams[12];
    ].map(floatToABK64x64);

    for (let param of params) {
        //baseParams
        if (param.parameter_name == "fInitialMarginRateAlpha") {
            baseParams[0] = param.value1;
        } else if (param.parameter_name == "fMarginRateBeta") {
            baseParams[1] = param.value1;
        } else if (param.parameter_name == "fMaintenanceMarginRateAlpha") {
            baseParams[2] = param.value1;
        } else if (param.parameter_name == "fInitialMarginRateCap") {
            baseParams[3] = param.value1;
        } else if (param.parameter_name == "protocol_fee_rate") {
            baseParams[4] = param.value1;
        } else if (param.parameter_name == "LP_fee_rate") {
            baseParams[5] = param.value1;
        } else if (param.parameter_name == "fReferralRebateCC") {
            baseParams[6] = param.value1;
        } else if (param.parameter_name == "liquidation_penalty_rate") {
            baseParams[7] = param.value1;
        } else if (param.parameter_name == "fMinimalSpread") {
            baseParams[8] = param.value1;
        } else if (param.parameter_name == "fMinimalSpreadInStress") {
            baseParams[9] = param.value1;
        } else if (param.parameter_name == "fLotSizeBC") {
            baseParams[10] = param.value1;
            //underlyingRisksParams
        } else if (param.parameter_name == "funding_rate_clamp") {
            underlyingRisksParams[0] = param.value1;
        } else if (param.parameter_name == "mark_price_ema_lambda") {
            underlyingRisksParams[1] = param.value1;
        } else if (param.parameter_name == "sig2") {
            underlyingRisksParams[2] = param.value1;
        } else if (param.parameter_name == "sig3") {
            underlyingRisksParams[3] = param.value1;
        } else if (param.parameter_name == "rho23") {
            underlyingRisksParams[4] = param.value1;

            //defaultFundRiskParams
        } else if (param.parameter_name == "stress_return_S2") {
            defaultFundRiskParams[0] = param.value1;
            defaultFundRiskParams[1] = param.value2;
        } else if (param.parameter_name == "stress_return_S3") {
            defaultFundRiskParams[2] = param.value1;
            defaultFundRiskParams[3] = param.value2;
        } else if (param.parameter_name == "cover_N") {
            defaultFundRiskParams[4] = param.value1;
        } else if (param.parameter_name == "DF_lambda") {
            defaultFundRiskParams[5] = param.value1;
            defaultFundRiskParams[6] = param.value2;
        } else if (param.parameter_name == "amm_baseline_target_dd") {
            defaultFundRiskParams[7] = param.value1;
        } else if (param.parameter_name == "amm_stress_target_dd") {
            defaultFundRiskParams[8] = param.value1;
        } else if (param.parameter_name == "amm_min_size") {
            defaultFundRiskParams[9] = param.value1;
        } else if (param.parameter_name == "fMinimalTraderExposureEMA") {
            defaultFundRiskParams[10] = param.value1;
        } else if (param.parameter_name == "fMinimalAMMExposureEMA") {
            defaultFundRiskParams[11] = param.value1;
        } else if (param.parameter_name == "tradeSizeBumpUp") {
            defaultFundRiskParams[12] = param.value1;
        } else {
            console.log("Parameter ", param.parameter_name, " not assigned.")
        }
    }

    // console.log("baseParams:", baseParams);
    // console.log("underlyingRisksParams:", underlyingRisksParams);
    // console.log("defaultFundRiskParams:", defaultFundRiskParams);

    baseParams = baseParams.map(floatToABK64x64);
    underlyingRisksParams = underlyingRisksParams.map(floatToABK64x64);
    defaultFundRiskParams = defaultFundRiskParams.map(floatToABK64x64);

    return await _createPerpetualByManager(manager, poolId, oracles, baseParams, underlyingRisksParams, defaultFundRiskParams, _collCurrency);
}

async function _createPerpetualManager(contracts, isMockAMMPerpModule: boolean, replaceOtherModulesFunctions: boolean = true) {
    let manager = await deployPerpetualManager(contracts, replaceOtherModulesFunctions);

    let AMMPerpLogic;
    if (isMockAMMPerpModule) {
        AMMPerpLogic = await createContract("MockAMMPerpLogic");
    } else {
        AMMPerpLogic = await createContract("AMMPerpLogic");
    }
    await manager.setAMMPerpLogic(AMMPerpLogic.address);

    return manager;
}

export async function createPerpetualManager(isMockAMMPerpModule = false, mockContracts: string[] = [], replaceOtherModulesFunctions = true) {
    const CONTRACTS = [
        { name: "PerpetualDepositManager" },
        { name: "MockPerpetualFactory" },
        { name: "PerpetualPoolFactory" },
        { name: "PerpetualGetter" },
        { name: "MockPerpetualLiquidator" },
        { name: "PerpetualSettlement" },
        { name: "PerpetualTradeLogic" },
        { name: "MockPerpetualTradeLogic" },
        { name: "PerpetualTradeManager" },
        { name: "PerpetualLimitTradeManager" },
        { name: "PerpetualOrderManager" },
        { name: "MockPerpetualTradeManager" },
        { name: "MockPerpetualTreasury" },
        { name: "PerpetualWithdrawManager" },
        { name: "PerpetualWithdrawAllManager" },
        { name: "PerpetualTradeLimits" },
        { name: "PerpetualRelayRecipient" },
        { name: "MockPerpetualSetter" },
        { name: "MockPerpetualBaseFunctions" },
        { name: "PerpetualUpdateLogic" },
        { name: "PerpetualRebalanceLogic" },
        { name: "PerpetualMarginLogic" },
        { name: "PerpetualMarginViewLogic" },
        { name: "MockPerpetualUpdateFunctions" },
        { name: "MockPerpetualRebalanceFunctions" },
        { name: "MockPerpetualSettlement" },
    ];
    mockContracts.forEach((mockContract) => CONTRACTS.push({ name: mockContract }));
    return await _createPerpetualManager(CONTRACTS, isMockAMMPerpModule);
}

export async function createPerpetualManagerForIT() {
    const CONTRACTS = [
        { name: "PerpetualDepositManager" },
        { name: "PerpetualFactory" },
        { name: "PerpetualGetter" },
        { name: "PerpetualLiquidator" },
        { name: "PerpetualPoolFactory" },
        { name: "PerpetualSettlement" },
        { name: "PerpetualTradeLogic" },
        { name: "PerpetualTradeManager" },
        { name: "PerpetualLimitTradeManager" },
        { name: "PerpetualOrderManager" },
        { name: "PerpetualTreasury" },
        { name: "PerpetualUpdateLogic" },
        { name: "PerpetualRebalanceLogic" },
        { name: "PerpetualMarginLogic" },
        { name: "PerpetualMarginViewLogic" },
        { name: "PerpetualWithdrawManager" },
        { name: "PerpetualWithdrawAllManager" },
        { name: "PerpetualTradeLimits" },
        { name: "PerpetualRelayRecipient" },
        { name: "MockPerpetualSetter" },
    ];
    return await _createPerpetualManager(CONTRACTS, false);
}

// don't use it unless you know what you're doing
export function createMockPerpetual(dummyAddress) {
    type PerpData = {
        id: BytesLike;
        poolId: BigNumberish;
        oracleS2Addr: string;
        oracleS3Addr: string;
        indexS2PriceData: { fPrice: BigNumberish; time: BigNumberish };
        indexS3PriceData: { fPrice: BigNumberish; time: BigNumberish };
        currentPremium: { fPrice: BigNumberish; time: BigNumberish };
        currentPremiumEMA: { fPrice: BigNumberish; time: BigNumberish };
        settlementPremiumEMA: { fPrice: BigNumberish; time: BigNumberish };
        settlementS2PriceData: { fPrice: BigNumberish; time: BigNumberish };
        settlementS3PriceData: { fPrice: BigNumberish; time: BigNumberish };
        fCurrentFundingRate: BigNumberish;
        fUnitAccumulatedFunding: BigNumberish;
        state: BigNumberish;
        fOpenInterest: BigNumberish;
        fAMMFundCashCC: BigNumberish;
        fInitialMarginRateAlpha: BigNumberish;
        fMarginRateBeta: BigNumberish;
        fInitialMarginRateCap: BigNumberish;
        fMaintenanceMarginRateAlpha: BigNumberish;
        fTreasuryFeeRate: BigNumberish;
        fPnLPartRate: BigNumberish;
        fReferralRebateCC: BigNumberish;
        fLiquidationPenaltyRate: BigNumberish;
        fMinimalSpread: BigNumberish;
        fMinimalSpreadInStress: BigNumberish;
        fLotSizeBC: BigNumberish;
        fFundingRateClamp: BigNumberish;
        fMarkPriceEMALambda: BigNumberish;
        fSigma2: BigNumberish;
        fSigma3: BigNumberish;
        fRho23: BigNumberish;
        eCollateralCurrency: BigNumberish;
        fStressReturnS2: [BigNumberish, BigNumberish];
        fStressReturnS3: [BigNumberish, BigNumberish];
        fDFCoverNRate: BigNumberish;
        fDFLambda: [BigNumberish, BigNumberish];
        fAMMTargetDD: [BigNumberish, BigNumberish];
        fAMMMinSizeCC: BigNumberish;
        fTargetAMMFundSize: BigNumberish;
        fTargetDFSize: BigNumberish;
        fCurrentAMMExposureEMA: [BigNumberish, BigNumberish];
        fCurrentTraderExposureEMA: [BigNumberish];
        fTotalMarginBalance: BigNumberish;
        keeper: string;
    };

    let emptyPrice = { fPrice: 0, time: 0 };
    let emptyArray: [BigNumberish, BigNumberish] = [0, 0];

    let perpetual: PerpData = {
        id: "0x0000000000000000000000000000000000000000000000000000000000000000",
        poolId: 0,
        oracleS2Addr: dummyAddress,
        oracleS3Addr: dummyAddress,
        indexS2PriceData: emptyPrice,
        indexS3PriceData: emptyPrice,
        currentPremium: emptyPrice,
        currentPremiumEMA: emptyPrice,
        settlementPremiumEMA: emptyPrice,
        settlementS2PriceData: { fPrice: ONE_DEC18.mul(2), time: 0 },
        settlementS3PriceData: emptyPrice,
        fCurrentFundingRate: 0,
        fUnitAccumulatedFunding: 0,
        state: 0,
        fOpenInterest: 0,
        fAMMFundCashCC: 0,
        fInitialMarginRateAlpha: 0,
        fMarginRateBeta: 0,
        fInitialMarginRateCap: 0,
        fMaintenanceMarginRateAlpha: 0,
        fTreasuryFeeRate: 0,
        fPnLPartRate: 0,
        fReferralRebateCC: 0,
        fLiquidationPenaltyRate: 0,
        fMinimalSpread: 0,
        fMinimalSpreadInStress: 0,
        fLotSizeBC: 0.0001,
        fFundingRateClamp: 0,
        fMarkPriceEMALambda: 0,
        fSigma2: 0,
        fSigma3: 0,
        fRho23: 0,
        eCollateralCurrency: 1,
        fStressReturnS2: emptyArray,
        fStressReturnS3: emptyArray,
        fDFCoverNRate: 0,
        fDFLambda: emptyArray,
        fAMMTargetDD: emptyArray,
        fAMMMinSizeCC: 0,
        fTargetAMMFundSize: 0,
        fTargetDFSize: ONE_DEC18,
        fCurrentAMMExposureEMA: emptyArray,
        fCurrentTraderExposureEMA: 0,
        fTotalMarginBalance: 0,
        keeper: dummyAddress,
    };
    return perpetual;
}
