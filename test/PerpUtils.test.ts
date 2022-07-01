import { expect, use, util } from "chai";
const { ethers } = require("hardhat");
import { BigNumber } from "ethers";
import {
    ABK64x64ToFloat,
    equalForPrecision,
    floatToABK64x64,
    fractionToABDK64x64,
    fromDec18,
    toDec18,
    mul64x64,
    div64x64,
    add64x64,
    probDefNoQuanto,
    probDefQuanto,
    equalForPrecisionFloat,
    calcPerpPrice,
    calculateAMMTargetSize,
    calculateLiquidationPriceCollateralQuanto,
    calculateLiquidationPriceCollateralBase,
    COLLATERAL_CURRENCY_BASE,
    COLLATERAL_CURRENCY_QUANTO,
    COLLATERAL_CURRENCY_QUOTE,
    calculateMarginBalance,
} from "../scripts/utils/perpMath";
import { createOracle, createLiquidityPool, createPerpetual, createPerpetualManager, getBTCBaseParams } from "./TestFactory";
import {
    AMMState,
    PerpParameters,
    TraderState,
    getPrice,
    getSignedMaxAbsPositionForTrader,
    calculateSlippagePrice,
    getRequiredMarginCollateral,
    getEstimatedMarginCollateralForLimitOrder,
    getMaxInitialLeverage,
    getMaintenanceMarginRate,
    getTradingFee,
    getMaximalTradeSizeInPerpetual,
    getTraderPnL,
    getTraderPnLInCC,
    getFundingFee,
    getMidPrice,
    getDepthMatrix,
    LiqPoolState,
    calculateSlippagePriceFromMidPrice,
    isTraderMaintenanceMarginSafe,
    calculateApproxLiquidationPrice,
    getMarkPrice,
    getMaximalMarginToWithdraw,
    isTraderInitialMarginSafe,
    getMaximalTradeSizeInPerpetualWithCurrentMargin,
    getIndexPrice,
    calculateLeverage,
    getAverageEntryPrice,
    calculateResultingPositionLeverage,
    getMarginBalanceAtClosing,
} from "../scripts/utils/perpUtils";
import { queryAMMState, queryPerpParameters, queryTraderState, queryLiqPoolStateFromPerpetualId } from "../scripts/utils/perpQueries";
const BN = ethers.BigNumber;

const ONE_DEC18 = BN.from(10).pow(BN.from(18));
const DOT_ONE_DEC18 = BN.from(10).pow(BN.from(17));
const DOT_ONE_18_DEC18 = BN.from(1);

const ONE_64x64 = BN.from("0x010000000000000000");
const DOT_ONE_64x64 = ONE_64x64.div(10);
const DOT_ONE_DEC18_64x64 = BN.from("0x0000000000000001");
const DOT_ZERO_ONE_64x64 = ONE_64x64.div(100);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

let s2: number, s3: number, premium: number;
let baseParamsBTC: BigNumber[];
let accounts, owner, trader;
let manager;
let perpetualId, perpetual, poolData, poolId, marginToken;
let perpetualIdQuanto;

async function initPerp(_perpetualId, poolId) {
    s2 = 47200;
    s3 = 3600;
    premium = 5;
    const PerpetualStateNORMAL = 2;
    manager.setGenericPriceData(_perpetualId, "indexS2PriceData", floatToABK64x64(s2));
    manager.setGenericPriceData(_perpetualId, "indexS3PriceData", floatToABK64x64(s3));
    manager.setGenericPriceData(_perpetualId, "indexS2PriceDataOracle", floatToABK64x64(s2));
    manager.setGenericPriceData(_perpetualId, "indexS3PriceDataOracle", floatToABK64x64(s3));
    manager.setGenericPriceData(_perpetualId, "currentMarkPremiumRate", floatToABK64x64(premium/s2));
    manager.setGenericPriceData(_perpetualId, "currentPremiumRate", floatToABK64x64(premium/s2));
    manager.setPerpetualState(_perpetualId, PerpetualStateNORMAL);
    manager.setTargetDFSize(poolId, ONE_64x64);
    manager.setDefaultFundCashCC(poolId, ONE_64x64);

    perpetual = await manager.getPerpetual(_perpetualId);
}

const initialize = async () => {
    accounts = await ethers.getSigners();
    owner = accounts[0].address;
    trader = accounts[1].address;

    manager = await createPerpetualManager();
    baseParamsBTC = getBTCBaseParams();
    poolData = await createLiquidityPool(manager, owner);
    poolId = poolData.id;
    marginToken = poolData.marginToken;
    await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));
    perpetualId = await createPerpetual(manager, poolData.id, baseParamsBTC, null, null);
    perpetualIdQuanto = await createPerpetual(manager, poolData.id, baseParamsBTC, null, null, COLLATERAL_CURRENCY_QUANTO);
    await initPerp(perpetualId, poolId);
    await initPerp(perpetualIdQuanto, poolId);
};

describe("PerpUtils", () => {
    before(async () => {
        await initialize();
    });

    describe("Utils support functions", () => {
        it("quanto liq price", async () => {
            let L = 4000;
            let pos = 1;
            let cash_cc = 0.1;
            let maintenance_margin_ratio = 0.4;
            let rho23 = 0.7;
            let sigma2 = 0.08;
            let sigma3 = 0.05;
            let S2ETHUSD = 4100;
            let S3BTCUSD = 50000;
            let S2Liq = calculateLiquidationPriceCollateralQuanto(L, pos, cash_cc, maintenance_margin_ratio, S3BTCUSD, S2ETHUSD);
            console.log("S2Liq =", S2Liq);
        });
    });
    describe("Limit/Stop orders", () => {
        it("query getters", async () => {
            let S2 = 48000;
            let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualId);
            let ammState: AMMState = await queryAMMState(manager, perpetualId);
            // modify data
            ammState.indexS2PriceDataOracle = S2;
            let leverage = 2;
            let tradeSize = 1;
            let m2 = getEstimatedMarginCollateralForLimitOrder(perpParams, ammState, leverage, tradeSize, 46000, 45000);
            console.log("margin collateral limit = ", m2)

        });
    });

    describe("TestGetters", () => {
        it("query getters", async () => {
            let traderAcc = accounts[1];
            let ammState: AMMState = await queryAMMState(manager, perpetualId);
            let cash = 0.001;
            let pos = -0.5;
            let L = pos * ammState.indexS2PriceData;
            await manager.setMarginAccount(perpetualId, traderAcc.address, floatToABK64x64(L), floatToABK64x64(cash), floatToABK64x64(pos));
            
            ammState.indexS2PriceDataOracle = ammState.indexS2PriceData;
            ammState.indexS3PriceData = ammState.indexS2PriceData;
            ammState.indexS3PriceDataOracle = ammState.indexS2PriceData;
            ammState.fCurrentTraderExposureEMA = 1;
            // ammState.M2 = 10;
            let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualId);
            let traderState: TraderState = await queryTraderState(manager, perpetualId, traderAcc.address);
            let poolState: LiqPoolState = await queryLiqPoolStateFromPerpetualId(manager, perpetualId);
            let ammTrader: TraderState = await queryTraderState(manager, perpetualId, accounts[0].address);
            // console.log("ammTrader=", ammTrader);
            // in a position-reducing direction, lots of cash -> expect AMM size to dominate
            let dir = 1;
            let availableWalletBalance = 1;
            let mxPos = getSignedMaxAbsPositionForTrader(dir, availableWalletBalance, perpParams, traderState, ammState, poolState);
            let mxTrade0 = getMaximalTradeSizeInPerpetualWithCurrentMargin(dir, perpParams, traderState, ammState, poolState);
            let mxTrade = getMaximalTradeSizeInPerpetual(traderState.marginAccountPositionBC, dir, ammState, poolState, perpParams);
            let isMaxTraderTradeBelowMaxAMMTrade = Math.abs(mxPos - traderState.marginAccountPositionBC) == Math.abs(mxTrade); // equal
            let isMaxTraderTradeBetterWithMoreCash =  Math.abs(mxPos - traderState.marginAccountPositionBC) >= Math.abs(mxTrade0);
            if (!(isMaxTraderTradeBelowMaxAMMTrade && isMaxTraderTradeBetterWithMoreCash)) {
                console.log("perpParams=", perpParams);
                console.log("ammState=", ammState);
                console.log("traderState=", traderState);
                console.log("Max position = ", mxPos, "=", traderState.marginAccountPositionBC, "+(", dir, ")*", mxPos - traderState.marginAccountPositionBC);
                console.log("Max AMM trade size = ", mxTrade);
            }
            expect(isMaxTraderTradeBelowMaxAMMTrade).to.be.true;
            // in a position-increasing direction -> expect trader's margin restriction to dominate
            dir = -1;
            availableWalletBalance = 0.0001;
            mxPos = getSignedMaxAbsPositionForTrader(dir, availableWalletBalance, perpParams, traderState, ammState, poolState);
            mxTrade0 = getMaximalTradeSizeInPerpetualWithCurrentMargin(dir, perpParams, traderState, ammState, poolState);
            mxTrade = getMaximalTradeSizeInPerpetual(traderState.marginAccountPositionBC, dir, ammState, poolState, perpParams);
            isMaxTraderTradeBelowMaxAMMTrade = Math.abs(mxPos - traderState.marginAccountPositionBC) < Math.abs(mxTrade); // strict
            isMaxTraderTradeBetterWithMoreCash =  Math.abs(mxPos - traderState.marginAccountPositionBC) >= Math.abs(mxTrade0);
            if (!(isMaxTraderTradeBelowMaxAMMTrade && isMaxTraderTradeBetterWithMoreCash)) {
                console.log("perpParams=", perpParams);
                console.log("ammState=", ammState);
                console.log("traderState=", traderState);
                console.log("Max position = ", mxPos, "=", traderState.marginAccountPositionBC, "+(", dir, ")*", mxPos - traderState.marginAccountPositionBC);
                console.log("Max AMM trade size = ", mxTrade);
            }
            expect(isMaxTraderTradeBelowMaxAMMTrade).to.be.true;

            let px = calculateSlippagePrice(46000, 2, dir);
            console.log("px = ", px);
            let leverage = 10;
            let targetPos = 2;
            let m = getRequiredMarginCollateral(leverage, targetPos, perpParams, ammState, traderState);
            console.log("margin collateral = ", m);
            let maxLvg = getMaxInitialLeverage(3, perpParams);
            console.log("maxLvg = ", maxLvg);
            let mmrate = getMaintenanceMarginRate(3, perpParams);
            console.log("mmrate = ", mmrate);
            console.log("trading fee = ", getTradingFee(3, perpParams, ammState));
             mxTrade = getMaximalTradeSizeInPerpetual(traderState.marginAccountPositionBC, dir, ammState, poolState, perpParams);
            console.log("mxTrade = ", mxTrade);
            console.log("mxTrade0 = ", mxTrade0);

            let pxMid = await getMidPrice(perpParams, ammState);
            console.log("Px Mid = ", pxMid);
        });

        it("maxleverage", async () => {
            let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualId);
            let pos = [0.0002, 2, 5, 10];
            
            for(var j = 0; j<pos.length; j++) {
                let maxLvg = getMaxInitialLeverage(pos[j], perpParams);
                console.log("pos = ", pos[j]);
                console.log("maxLvg = ", maxLvg);
            }
        });

        it("getRequiredMarginCollateral", async () => {
            let ammState: AMMState = await queryAMMState(manager, perpetualId);
            let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualId);
            let traderState: TraderState = await queryTraderState(manager, perpetualId, owner);
            let poolState: LiqPoolState = await queryLiqPoolStateFromPerpetualId(manager, perpetualId);
            let leverage = 1;
            let targetPos = 1;
            traderState.marginAccountLockedInValueQC = 0;
            traderState.marginAccountPositionBC = 0;
            traderState.availableCashCC = 0;
            let m = getRequiredMarginCollateral(leverage, targetPos, perpParams, ammState, traderState);
            let fees = perpParams.fTreasuryFeeRate+perpParams.fPnLPartRate;
            let tradeAmount = targetPos - traderState.marginAccountPositionBC;
            let mExpected = tradeAmount * (1 + fees) + tradeAmount * (getPrice(tradeAmount, perpParams, ammState) - getIndexPrice(ammState));
            let isEqual = equalForPrecisionFloat(mExpected, m, 4);
            if (!isEqual) {
                console.log("fees=", fees);
                console.log("m =", m);
                console.log("mExpected =", mExpected);
                console.log("index price=", getIndexPrice(ammState));
                console.log("mark price=", getMarkPrice(ammState));
                console.log("mid price=", getMidPrice(perpParams, ammState));
            }
            expect(isEqual).to.be.true;
            let m2 = getRequiredMarginCollateral(leverage, targetPos, perpParams, ammState, traderState, 0, false);
            let isEqualWithoutAccounting = equalForPrecisionFloat(mExpected, Math.max(0, m2 - traderState.availableCashCC), 4);
            if (!isEqualWithoutAccounting) {
                console.log("m =", m);
                console.log("m without accounting for margin=", m2);
                console.log("mExpected =", mExpected);
            }
            expect(isEqualWithoutAccounting).to.be.true;
        });


        it("calculateLeverage", async () => {
            let ammState: AMMState = await queryAMMState(manager, perpetualId);
            let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualId);
            let traderState: TraderState = await queryTraderState(manager, perpetualId, owner);
            let poolState: LiqPoolState = await queryLiqPoolStateFromPerpetualId(manager, perpetualId);
            let targetMargin = 0.2;
            let targetPos = 1;
            let slippagePct = 0.01;
            traderState.marginAccountLockedInValueQC = 0;
            traderState.marginAccountPositionBC = 0;
            traderState.availableCashCC = 0;
            // get leverage from desired position and margin
            let leverage = calculateLeverage(targetPos, targetMargin, traderState, ammState, perpParams, slippagePct);
            // now see what margin we need to this position and leverage
            let margin = getRequiredMarginCollateral(leverage, targetPos, perpParams, ammState, traderState, slippagePct);
            let isEqual = equalForPrecisionFloat(margin, targetMargin, 4);
            if (!isEqual) {
                console.log("target margin =", targetMargin);
                console.log("leverage =", leverage);
                console.log("calculated margin=", margin);
                console.log("index price=", getIndexPrice(ammState));
                console.log("mark price=", getMarkPrice(ammState));
                console.log("mid price=", getMidPrice(perpParams, ammState));
            }
            expect(isEqual).to.be.true;
        });

        it("calculateResultingPositionLeverage", async () => {
            let ammState: AMMState = await queryAMMState(manager, perpetualId);
            let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualId);
            let traderState: TraderState = await queryTraderState(manager, perpetualId, owner);
            let targetPos = 1;
            let slippagePct = 0.01;
            let tradeLeverage = 10;
            let orderSize = 0.5;
            ammState.K2 = 0.001;
            ammState.M2 = 5;
            ammState.indexS2PriceDataOracle = 40500;
            let Sm = ammState.indexS2PriceDataOracle * (1 + ammState.currentMarkPremiumRate)
            let S3 = ammState.indexS2PriceDataOracle;
            traderState.marginAccountPositionBC = targetPos - orderSize;
            traderState.marginAccountLockedInValueQC = 40000 * (targetPos - orderSize);
            traderState.availableCashCC = 0.5;
            let b = calculateMarginBalance(traderState.marginAccountPositionBC, Sm, traderState.marginAccountLockedInValueQC, 
                S3, traderState.availableCashCC);
            let leverage_now = Math.abs(traderState.marginAccountPositionBC)*Sm/S3/b;
            let leverage = calculateResultingPositionLeverage(traderState,
                                ammState,
                                perpParams,
                                orderSize,
                                tradeLeverage,
                                slippagePct);
            let margin_coll_for_target_pos = getRequiredMarginCollateral(leverage, targetPos, perpParams, ammState, traderState, slippagePct, true, true);
            let margin_coll_trade = getRequiredMarginCollateral(tradeLeverage, orderSize, perpParams, ammState, traderState, slippagePct, false, false);
            let isEqual = equalForPrecisionFloat(margin_coll_for_target_pos, margin_coll_trade, 4);
            if (!isEqual) {
                console.log("collateral position realised =", margin_coll_for_target_pos);
                console.log("collateral position expected =", margin_coll_trade);
                console.log("leverage =", leverage);
                console.log("pre-trade leverage =", leverage_now);
                console.log("index price=", getIndexPrice(ammState));
                console.log("mark price=", getMarkPrice(ammState));
                console.log("mid price=", getMidPrice(perpParams, ammState));
            }
            expect(isEqual).to.be.true;

             
        });
        
    });

    describe("Liquidation price", () => {
        it("isTraderMaintenanceMarginSafe Long", async () => {
            let ammData: AMMState = await queryAMMState(manager, perpetualId);
            let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualId);
            let traderState: TraderState = await queryTraderState(manager, perpetualId, owner);
            let SLockedIn = 48888.59;
            let tradeSize = 0;
            let traderCashAddedCC = 0;
            traderState.marginAccountPositionBC = 0.016;
            traderState.availableCashCC = 0.001;
            traderState.marginAccountLockedInValueQC = traderState.marginAccountPositionBC*SLockedIn;
            let liqPx = calculateApproxLiquidationPrice(traderState,  ammData, perpParams, tradeSize, traderCashAddedCC); 
            let isLarger = SLockedIn > liqPx;
            if (!isLarger) {
                console.log("Long");
                console.log("Liquidation price = ", liqPx);
                console.log("Locked-In price = ", SLockedIn);
            }
            expect(isLarger).to.be.true;
        });
        it("isTraderMaintenanceMarginSafe Short", async () => {
            let ammData: AMMState = await queryAMMState(manager, perpetualId);
            let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualId);
            let traderState: TraderState = await queryTraderState(manager, perpetualId, owner);
            let SLockedIn = 48888.59;
            let tradeSize = 0;
            let traderCashAddedCC = 0;
            traderState.marginAccountPositionBC = -0.016;
            traderState.availableCashCC = 0.001;
            traderState.marginAccountLockedInValueQC = traderState.marginAccountPositionBC*SLockedIn;
            let liqPx = calculateApproxLiquidationPrice(traderState,  ammData, perpParams, tradeSize, traderCashAddedCC); 
            let isLarger =  liqPx > SLockedIn;
            if (!isLarger) {
                console.log("Short");
                console.log("Liquidation price = ", liqPx);
                console.log("Locked-In price = ", SLockedIn);
            }
            
            expect(isLarger).to.be.true;
        });
        it("isTraderMaintenanceMarginSafe no Leverage", async () => {
            let ammData: AMMState = await queryAMMState(manager, perpetualId);
            let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualId);
            let traderState: TraderState = await queryTraderState(manager, perpetualId, owner);
            let SLockedIn = 48888.59;
            let tradeSize = 0;
            let traderCashAddedCC = 0;
            let pos = -1
            let cash = 1
            let L = pos*SLockedIn
            traderState.marginAccountPositionBC = pos;
            traderState.availableCashCC = cash;
            traderState.marginAccountLockedInValueQC = L;
            let liqPx = calculateApproxLiquidationPrice(traderState,  ammData, perpParams, tradeSize, traderCashAddedCC); 
            let marginrate = getMaintenanceMarginRate(pos, perpParams);
            let liqPxMth = calculateLiquidationPriceCollateralBase(L, pos, cash, marginrate);
            let isLarger =  liqPx > SLockedIn;
            if (!isLarger) {
                console.log("No Leverage");
                console.log("marginrate = ", marginrate);
                console.log("Liquidation price perpMath = ", liqPxMth);
                console.log("Liquidation price perpUtils= ", liqPx);
                console.log("Locked-In price = ", SLockedIn);
            }
            expect(isLarger).to.be.true;
        });
    });

    describe("Margin Functions", () => {
        it("isTraderMaintenanceMarginSafe", async () => {
            
            let posvec = [1, -1];
            let cashvec = [0.001, 0.2];
            
            for(var k = 0; k < posvec.length; k++) {
                let pos = posvec[k];
                let L = s2*pos;
                for(var j = 0; j < cashvec.length; j++) {
                    let cash = cashvec[j];
                    await manager.setMarginAccount(perpetualId, owner, floatToABK64x64(L), floatToABK64x64(cash), floatToABK64x64(pos));
                    let isSafeContract = await manager.isTraderMaintenanceMarginSafe(perpetualId, owner);
                    let ammState: AMMState = await queryAMMState(manager, perpetualId);
                    let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualId);
                    let traderState: TraderState = await queryTraderState(manager, perpetualId, owner);
                    // cheat because oracle is not set
                    ammState.indexS2PriceDataOracle = ammState.indexS2PriceData;
                    ammState.indexS3PriceDataOracle = ammState.indexS3PriceData;
                    
                    let isSafeTS = isTraderMaintenanceMarginSafe(traderState, perpParams, ammState);
                    let isSafeInitialMargin = isTraderInitialMarginSafe(traderState, 0, 0, perpParams, ammState);  
                    let marginBuffer = getMaximalMarginToWithdraw(traderState, perpParams, ammState);
                    let isSafeAfterWidthrawal = true;
                    if (isSafeInitialMargin) {
                        traderState.availableCashCC -= marginBuffer;
                        // console.log("buffer=", marginBuffer);
                        isSafeAfterWidthrawal = isTraderInitialMarginSafe(traderState, 0, 0, perpParams, ammState); 
                    } else {
                        isSafeAfterWidthrawal = marginBuffer==0;
                    }
                    let isEqual = isSafeTS == isSafeContract && isSafeAfterWidthrawal;
                    if (!isEqual) {
                        console.log("isSafeAfterWidthrawal =", isSafeAfterWidthrawal);
                        console.log("isSafeContract =", isSafeContract);
                        console.log("isSafeTS =", isSafeTS);
                    }
                    expect(isEqual).to.be.true;
                }
            }
            
            
        });

        it("getMaximalMarginToWithdraw quanto", async () => {
            let pos = 3;
            let L = s2*pos;
            let cash = 0.1;
            await manager.setMarginAccount(perpetualIdQuanto, owner, floatToABK64x64(L), floatToABK64x64(cash), floatToABK64x64(pos));
            let ammState: AMMState = await queryAMMState(manager, perpetualIdQuanto);
            ammState.indexS3PriceDataOracle = 40179.77
            ammState.indexS2PriceDataOracle = 412.99
            ammState.fCurrentTraderExposureEMA = 12.47;

            let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualIdQuanto);
            let traderState: TraderState = await queryTraderState(manager, perpetualIdQuanto, owner);
            traderState.marginBalanceCC= 0.05136102532342727;
            traderState.availableMarginCC=0.0462418976009723;
            traderState.availableCashCC=0.05119286151133825;
            traderState.marginAccountCashCC=0.05119266740731264;
            traderState.marginAccountPositionBC=5;
            traderState.marginAccountLockedInValueQC=2064.88547595;
            traderState.fUnitAccumulatedFundingStart=-0.000001179967514485;

            let marginBuffer = getMaximalMarginToWithdraw(traderState, perpParams, ammState);
            //console.log(marginBuffer);
            expect(marginBuffer).to.be.greaterThan(0);
        });

        it("isTraderMaintenanceMarginSafe - new position", async () => {
            let tradeVec = [0, 1, -1, -1.2, -2];
            let ShouldBe = [true, false, true, true, false];
            let pos = 1;
            for(var k = 0; k < tradeVec.length; k++) {
                let dPos = tradeVec[k];
                let L = s2*pos;
                let cash = 0.1;
                await manager.setMarginAccount(perpetualId, owner, floatToABK64x64(L), floatToABK64x64(cash), floatToABK64x64(pos));
                let ammState: AMMState = await queryAMMState(manager, perpetualId);
                let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualId);
                let traderState: TraderState = await queryTraderState(manager, perpetualId, owner);
                // cheat because oracle is not set
                ammState.indexS2PriceDataOracle = ammState.indexS2PriceData;
                ammState.indexS3PriceDataOracle = ammState.indexS3PriceData;
                
                let isSafeInitialMargin = isTraderInitialMarginSafe(traderState, 0, dPos, perpParams, ammState);
                if (ShouldBe[k]!=isSafeInitialMargin) {
                    console.log("Failed: IsSafe = ", isSafeInitialMargin);
                }
                expect(ShouldBe[k]).to.be.equal(isSafeInitialMargin);
            }
        });
    });   

    describe("TestPNL", () => {
        it("unrealized pnl and funding", async () => {
            let traderAcc = accounts[0];
            let L = -48000;
            let cash = 0.1;
            let pos = -0.5;
            await manager.setMarginAccount(perpetualId, traderAcc.address, floatToABK64x64(L), floatToABK64x64(cash), floatToABK64x64(pos));
            let ammState: AMMState = await queryAMMState(manager, perpetualId);
            // cheat oracle
            ammState.indexS2PriceDataOracle = ammState.indexS2PriceData;
            let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualId);
            let traderState: TraderState = await queryTraderState(manager, perpetualId, owner);
            

            let fPnLQC = getTraderPnL(traderState, ammState, perpParams);
            let fPnLCC = getTraderPnLInCC(traderState, ammState, perpParams);
            let fFundingFee = getFundingFee(traderState, perpParams);
            let isFundingInRightDirection = ammState.currentMarkPremiumRate * traderState.marginAccountPositionBC > 0? fFundingFee >= 0 : fFundingFee <= 0;
            if (!isFundingInRightDirection) {
                console.log("PNL(QC)=", fPnLQC);
                console.log("PNL(CC)=", fPnLCC);
                console.log("Funding fee(CC)=", fFundingFee);
                console.log("Mark premium=", ammState.currentMarkPremiumRate);
                console.log(perpParams);
                console.log(ammState);
                console.log(traderState);
            }
            expect(isFundingInRightDirection).to.be.true;
        });

        it("pnl for a given limit price", async () => {
            let traderAcc = accounts[0];
            let L = -48000;
            let cash = 0.1;
            let pos = -0.5;
            await manager.setMarginAccount(perpetualId, traderAcc.address, floatToABK64x64(L), floatToABK64x64(cash), floatToABK64x64(pos));
            let ammState: AMMState = await queryAMMState(manager, perpetualId);
            // cheat oracle
            ammState.indexS2PriceDataOracle = ammState.indexS2PriceData;
            let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualId);
            let traderState: TraderState = await queryTraderState(manager, perpetualId, owner);
            
            let markPrice = getMarkPrice(ammState);
            let midPrice = getMidPrice(perpParams, ammState);

            let limitPrices = [40000, markPrice, midPrice, 60000];

            for(let i = 0; i < limitPrices.length; i++) {
                let price = limitPrices[i];
                let fPnLLimit = getTraderPnL(traderState, ammState, perpParams, price);
                let fPnLMark = getTraderPnL(traderState, ammState, perpParams);
            
                // limit > mark and trader is long or limit < mark and trader is short -> PnL is better at limit price
                let isPnLInRightDirection = (price - getMarkPrice(ammState)) * traderState.marginAccountPositionBC > 0? fPnLLimit > fPnLMark : fPnLLimit <= fPnLMark;
                if (!isPnLInRightDirection) {
                    console.log(perpParams);
                    console.log(ammState);
                    console.log(traderState);
                    console.log("Oracle price=", ammState.indexS2PriceDataOracle);
                    console.log("Mark price=", getMarkPrice(ammState));
                    console.log("Limit price=", price);
                    console.log("Trader position=", traderState.marginAccountPositionBC);
                    console.log("PnL (limit price)=", fPnLLimit);
                    console.log("PnL (at mark)=", fPnLMark);
                }
            expect(isPnLInRightDirection).to.be.true;
            }
            
        });
    });

    describe("Test depth matrix", () => {
        it("compare matrix to getMidPrice", async () => {
            let traderAcc = accounts[0];
            let L = -48000;
            let cash = 0.1;
            let pos = -0.5;
            await manager.setMarginAccount(perpetualId, traderAcc.address, floatToABK64x64(L), floatToABK64x64(cash), floatToABK64x64(pos));
            let ammState: AMMState = await queryAMMState(manager, perpetualId);
            let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualId);
            let mat = getDepthMatrix(perpParams, ammState);
            const lot = perpParams.fLotSizeBC;
            let pUp = getPrice(lot, perpParams, ammState);
            let pDn = getPrice(-lot, perpParams, ammState);
            let pMid = 0.5 * (pUp + pDn);
            for (let i = 0; i < mat[0].length; i++) {
                let isComparableToDirectMidPriceDeviation = Math.abs(mat[0][i] / pMid - 1 - mat[1][i]/100) < 0.0001;
                if(!isComparableToDirectMidPriceDeviation) {
                    console.log("price", mat[0][i], "% from mid-price", mat[1][i], "trade amount", mat[2][i]);
                }
                expect(isComparableToDirectMidPriceDeviation).to.be.true;
            }
        });
    });
    describe("Test Slippage Price", () => {
        it("short/long", async () => {
            let directions = [-1,1];
            let slippagePercent = 0.01;
            let ammState: AMMState = await queryAMMState(manager, perpetualId);
            let perpParams: PerpParameters = await queryPerpParameters(manager, perpetualId);
            for(var j = 0; j<directions.length; j++) {
                let direction = directions[j];
                let p = await calculateSlippagePriceFromMidPrice(perpParams, ammState, slippagePercent, direction);
                const lot = perpParams.fLotSizeBC;
                let pUp = getPrice(lot, perpParams, ammState);
                let pDn = getPrice(-lot, perpParams, ammState);
                let pMid = getPrice(0.0, perpParams, ammState);
                let pExpected = (pUp + pDn)/2 * (1+direction*slippagePercent);
                let isEqual = p == pExpected;
                if (!isEqual) {
                    console.log("slippage price received", p);
                    console.log("slippage price expected", pExpected);
                    console.log("Mid Price", pMid);
                    console.log("Avg Mid Price", (pUp + pDn)/2);
                }
            }
        });
    });
    describe("Test average entry price", () => {

        it("should return NaN for empty position", async () => {
            let traderAcc = accounts[0];
            let L = -48000;
            let cash = 0.1;
            let pos = 0;
            await manager.setMarginAccount(perpetualId, traderAcc.address, floatToABK64x64(L), floatToABK64x64(cash), floatToABK64x64(pos));
            let traderState = await queryTraderState(manager, perpetualId, owner);
            let entryPrice = getAverageEntryPrice(traderState);
            expect(isNaN(entryPrice)).to.be.true;
        });

        it("should return entry price for single-entry position", async () => {
            let traderAcc = accounts[0];
            let L = -48000;
            let cash = 0.1;
            let pos = -1;
            await manager.setMarginAccount(perpetualId, traderAcc.address, floatToABK64x64(L), floatToABK64x64(cash), floatToABK64x64(pos));
            let traderState = await queryTraderState(manager, perpetualId, owner);
            let entryPrice = getAverageEntryPrice(traderState);
            expect(entryPrice == Math.abs(L / pos)).to.be.true;
        });

    });

    describe("Test margin balance at closing", () => {
        it("should return balance trader would receive if closing the position", async () => {
            let traderAcc = accounts[0];
            let ammState = await queryAMMState(manager, perpetualId);
            let perpParams = await queryPerpParameters(manager, perpetualId);
            ammState.indexS2PriceDataOracle = ammState.indexS2PriceData;
            // short and price drops, long and price increases, long and price decreases, short and price increases, no change in price
            let positions = [-1, 1, 0.5, -0.2, 0];
            let priceChange = [-0.01, 0.02, -0.02, 0.05, 0];
            let s2 = ammState.indexS2PriceData;
            for(var i = 0; i < positions.length; i++) {
                let pos = positions[i];
                let L = pos * s2 / (1 + priceChange[i]);
                let cash = 0.1;
                await manager.setMarginAccount(perpetualId, traderAcc.address, floatToABK64x64(L), floatToABK64x64(cash), floatToABK64x64(pos));
                let traderState = await queryTraderState(manager, perpetualId, owner);
                let closingBalance = getMarginBalanceAtClosing(traderState, ammState, perpParams);
                let nominalPnL = getTraderPnLInCC(traderState, ammState, perpParams);
                let effectivePnl = closingBalance - traderState.marginAccountCashCC;
                let isWorseThanNominal = nominalPnL > effectivePnl || pos == 0;
                if (!isWorseThanNominal) {
                    console.log("margin collateral=", traderState.marginAccountCashCC);
                    console.log("closing balance=", closingBalance);
                    console.log("effective pnl=", effectivePnl);
                    console.log("nominal (@mark, no trading fees) pnl=", nominalPnL);
                }
                expect(isWorseThanNominal).to.be.true;
            }
        });
    });
});
