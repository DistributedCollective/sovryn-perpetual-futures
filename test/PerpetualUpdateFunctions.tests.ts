// @ts-nocheck
import { expect } from "chai";
const { ethers } = require("hardhat");
import { getAccounts, createContract, toBytes32 } from "../scripts/utils/utils";
import { createLiquidityPool, createPerpetual, createPerpetualManager } from "./TestFactory";
import {
    equalForPrecision,
    equalForPrecisionFloat,
    add64x64,
    sub64x64,
    mul64x64,
    div64x64,
    abs64x64,
    calcKStar,
    floatToABK64x64,
    ABK64x64ToFloat,
    fractionToABDK64x64,
    toDec18,
    calculateFundingRate,
    PerpetualStateNORMAL,
    calculateAMMTargetSize,
    getDFTargetSize,
    COLLATERAL_CURRENCY_BASE,
    COLLATERAL_CURRENCY_QUOTE,
    COLLATERAL_CURRENCY_QUANTO,
    PerpetualStateEMERGENCY,
} from "../scripts/utils/perpMath";
import {getBTCBaseParams, createOracle} from "./TestFactory"
import { stat } from "fs";
const BN = ethers.BigNumber;

/*
  [x] _updateOraclePricesForPool
  [x] _increaseDefaultFundCash
  No direct unit-tests:
    _updateSpotPrice
    _updateOraclePriceData
*/
let accounts, perpetual, poolData, owner, manager, perpetualId, poolId;
let baseParamsBTC: BigNumber[];
let S2, S3;

async function setPerpData(_perpetualId, premiumRate, S2, S3, AMMCash, clamp) {
    manager.setGenericPriceData(_perpetualId, "indexS2PriceData", floatToABK64x64(S2));
    manager.setGenericPriceData(_perpetualId, "indexS3PriceData", floatToABK64x64(S3));
    manager.setGenericPriceData(_perpetualId, "currentMarkPremiumRate", floatToABK64x64(premiumRate));
    manager.setPerpetualState(_perpetualId, PerpetualStateNORMAL);
    manager.setGenericPerpInt128(_perpetualId, "fAMMFundCashCC", floatToABK64x64(AMMCash));
    manager.setGenericPerpInt128(_perpetualId, "fFundingRateClamp", floatToABK64x64(clamp));
    perpetual = await manager.getPerpetual(_perpetualId);
}

async function setMarginAccount(L: number, pos: number, cash: number) {
    // set margin account of AMM
    let lockedInValueQC = floatToABK64x64(L);
    let posBC = floatToABK64x64(pos);
    let cashCC = floatToABK64x64(cash);
    await manager.setMarginAccount(perpetualId, manager.address, lockedInValueQC, cashCC, posBC);
}

async function setupOracle(s2 : number) : Object[] {
    const BTC = toBytes32("BTC");
    const USD = toBytes32("USD");
    const ETH = toBytes32("ETH");
    
    
    let S2Oracle = s2
    let prices = [];
    for(var k = 0; k<20; k++) {
        prices.push(floatToABK64x64(S2Oracle));
    }
    let oracleBTCUSD = await createContract("MockPriceScenarioOracle", [BTC, USD, prices]);
    let oracles = [oracleBTCUSD.address, await createOracle(ETH, USD)];
    return oracles;
}

describe("PerpetualUpdateFunctions", () => {
    before(async () => {
        accounts = await getAccounts();
        owner = accounts[0].address;
        S2 = 47200;
        S3 = 3600;

       

        manager = await createPerpetualManager();
        baseParamsBTC = getBTCBaseParams();
        poolData = await createLiquidityPool(manager, owner);
        poolId = poolData.id;
        let oracles = await setupOracle(S2);
        perpetualId = await createPerpetual(manager, poolId, null, null, null, COLLATERAL_CURRENCY_BASE, oracles);
       
    });

    it("increaseDefaultFundCash", async () => {
        let pool = await manager.getLiquidityPool(poolId);
        let DFbefore = pool.fDefaultFundCashCC;
        await manager.increaseDefaultFundCash(poolId, floatToABK64x64(2));
        pool = await manager.getLiquidityPool(poolId);
        let DFafter = pool.fDefaultFundCashCC;
        expect(DFafter.sub(DFbefore)).to.be.equal(floatToABK64x64(2));
    });


    it("updateFundingRate", async () => {
        const AMMCash = 0.5;
        const clamp = 0.0005;
        console.log("init");
        let L = -47000;
        let pos = -1;
        let cash = 0.8;
        const baseRate = 0.0001
        setMarginAccount(L, pos, cash);

        let premium_rates = [-0.016, -0.01, -clamp / 2, clamp / 2, clamp, 0.01, 0.016];

        for (var j = 0; j < premium_rates.length; j++) {
            await setPerpData(perpetualId, premium_rates[j], S2, S3, AMMCash, clamp);
            await manager.updateKStar(perpetualId);
            perpetual = await manager.getPerpetual(perpetualId);
            let kStar = ABK64x64ToFloat(perpetual.fkStarSide);
            let fundingRateExp = calculateFundingRate(premium_rates[j], S2, clamp, -pos, AMMCash, COLLATERAL_CURRENCY_BASE);
            await manager.updateFundingRate(perpetualId);
            perpetual = await manager.getPerpetual(perpetualId);
            let fundingRateAfter = perpetual.fCurrentFundingRate;
            let isEqual = equalForPrecisionFloat(fundingRateExp, ABK64x64ToFloat(fundingRateAfter), 15);
            if (!isEqual) {
                console.log("Test failed:");
                console.log("Kstar =", kStar);
                console.log("Value=", ABK64x64ToFloat(fundingRateAfter));
                console.log("Expected=", fundingRateExp);
            }
            expect(isEqual).to.be.true;
        }
        // try run
        manager.updateFundingRatesInPerp(perpetual.id);
    });

    it("updateAMMTargetFundSize", async () => {
        // see also: PricingBenchmarks.py
        let fAMMTargetDD = [-2.5828074520, -2.053748910631823];
        let fAMMMinSizeCC = 0.001;
        let sigma2 = 0.05;
        let sigma3 = 0.07;
        let rho23 = 0.5;
        const S2 = 36000;
        const S3 = 2000;
        const M = 1;
        let traderEMA = 0.9;

        manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(S2));
        manager.setGenericPriceData(perpetualId, "indexS3PriceData", floatToABK64x64(S3));

        manager.setGenericPerpInt128(perpetualId, "fAMMMinSizeCC", floatToABK64x64(fAMMMinSizeCC));
        manager.setGenericPairData(perpetualId, "fAMMTargetDD", floatToABK64x64(fAMMTargetDD[0]), floatToABK64x64(fAMMTargetDD[1]));
        manager.setGenericPerpInt128(perpetualId, "fSigma2", floatToABK64x64(sigma2));
        manager.setGenericPerpInt128(perpetualId, "fSigma3", floatToABK64x64(sigma3));
        manager.setGenericPerpInt128(perpetualId, "fRho23", floatToABK64x64(rho23));
        manager.setGenericPerpInt128(perpetualId, "fCurrentTraderExposureEMA", floatToABK64x64(traderEMA));
        manager.setGenericPerpInt128(perpetualId, "fAMMFundCashCC", floatToABK64x64(M));
        let collateralCCYVec = [COLLATERAL_CURRENCY_BASE, COLLATERAL_CURRENCY_QUOTE, COLLATERAL_CURRENCY_QUANTO];
        for (var idxCC = 0; idxCC < collateralCCYVec.length; idxCC++) {
            let collateralCCY = collateralCCYVec[idxCC];
            manager.setCollateralCurrency(perpetualId, collateralCCY);
            let K_vec = [-2, -1, 0, 1, 2];
            for (var j = 0; j < K_vec.length; j++) {
                let L_vec = [2, 1, 0, -1, -2];
                for (var jj = 0; jj < L_vec.length; jj++) {
                    let K2 = K_vec[j];
                    let L1 = L_vec[jj] * 47100;
                    let cash = 0.8;
                    setMarginAccount(-L1, -K2, cash);

                    perpetual = await manager.getPerpetual(perpetualId);
                    
                    /* check all variables:
                    
                    console.log(ABK64x64ToFloat(perpetual.fAMMTargetDD));
                    console.log(ABK64x64ToFloat(perpetual.fAMMMinSizeCC));
                    console.log(ABK64x64ToFloat(perpetual.fSigma2));
                    console.log(ABK64x64ToFloat(perpetual.fSigma3));
                    console.log(ABK64x64ToFloat(perpetual.fRho23));
                    console.log(ABK64x64ToFloat(perpetual.indexS2PriceData.fPrice));
                    console.log(ABK64x64ToFloat(perpetual.indexS3PriceData.fPrice));
                    let marginAccount = await manager.getMarginAccount(perpetualId, manager.address);
                    console.log("L=",ABK64x64ToFloat(marginAccount.fLockedInValueQC));
                    console.log("K=",ABK64x64ToFloat(marginAccount.fPositionBC));
                    */
                    let M1, M2, M3;
                    M1 = 0;
                    M2 = 0;
                    M3 = 0;
                    if (collateralCCY==COLLATERAL_CURRENCY_BASE) {
                        M2 = M;
                    } else if (collateralCCY==COLLATERAL_CURRENCY_QUOTE) {
                        M1 = M;
                    } else {
                        M3 = M;
                    }
                    let kStar = calcKStar(K2, L1, S2, S3, M1, M2, M3, rho23, sigma2, sigma3);
                    let kStarSide = kStar < 0 ? -1 : 1;
                    await manager.setGenericPerpInt128(perpetualId, "fkStar", floatToABK64x64(kStar));
                    await manager.setGenericPerpInt128(perpetualId, "fkStarSide", floatToABK64x64(kStarSide));
                    let L1plus, K2plus;
                    if (kStar<0) {
                        L1plus=L1 + traderEMA*S2;
                        K2plus = K2 + traderEMA;
                    } else {
                        L1plus=L1 - traderEMA*S2
                        K2plus = K2 - traderEMA;
                    }
                    let Mexpected = calculateAMMTargetSize(fAMMTargetDD[1], fAMMMinSizeCC, sigma2, sigma3, rho23, S2, S3, K2plus, L1plus, collateralCCY);
                    const isBaselineFundSize = false;
                    let Mrec = await manager.mockGetUpdatedTargetAMMFundSize(perpetualId, isBaselineFundSize);
                    
                    // set it
                    await manager.mockUpdateAMMTargetFundSize(perpetualId, Mrec);
                    perpetual = await manager.getPerpetual(perpetualId);
                    let Mrec2 = perpetual.fTargetAMMFundSize;
                    /* log:
                    console.log("M2received=", ABK64x64ToFloat(M2rec));
                    console.log("M2expected=", M2expected);
                    */
                    let isEqual = equalForPrecisionFloat(Mexpected, ABK64x64ToFloat(Mrec), 10);
                    if (!isEqual) {
                        console.log("Test failed: ccy=", idxCC);
                        console.log("Value Received=", ABK64x64ToFloat(Mrec));
                        console.log("Value Expected=", Mexpected);
                        console.log("kStar expected=", kStar);
                        console.log("kStar contract=", ABK64x64ToFloat(perpetual.fkStar));
                        console.log("kStar sign expected=", kStarSide);
                        console.log("kStar sign contract=", ABK64x64ToFloat(perpetual.fkStarSide));
                        console.log("traderEMA expected=", traderEMA);
                        console.log("traderEMA contract=", ABK64x64ToFloat(perpetual.fCurrentTraderExposureEMA))
                    }
                    expect(isEqual).to.be.true;
                    expect(Mrec).to.be.equal(Mrec2);
                } //L
            } //K
        } //collateral currency
    });

    it("updateDefaultFundTargetSize", async () => {
        // see also: PricingBenchmarks.py test_insurance_fund_size()

        perpetual = await manager.getPerpetual(perpetualId);
        let collateralCCYVec = [COLLATERAL_CURRENCY_BASE, COLLATERAL_CURRENCY_QUOTE, COLLATERAL_CURRENCY_QUANTO];
        let K2pair = [-0.7, 0.8];
        let k2Trader = 0.15;
        let coverNrate = 0.04;
        let r2pair = [-0.3, 0.2];
        let r3pair = [-0.32, 0.18];
        let S2 = 2000;
        let S3 = 31000;
        let minAMMExposure = 0.1;
        let minTraderExposure = 0.001;
        manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(S2));
        manager.setGenericPriceData(perpetualId, "indexS3PriceData", floatToABK64x64(S3));
        manager.setGenericPairData(perpetualId, "fCurrentAMMExposureEMA", floatToABK64x64(K2pair[0]), floatToABK64x64(K2pair[1]));
        manager.setGenericPerpInt128(perpetualId, "fCurrentTraderExposureEMA", floatToABK64x64(k2Trader));
        manager.setGenericPerpInt128(perpetualId, "fMinimalTraderExposureEMA", floatToABK64x64(k2Trader/2));
        manager.setGenericPerpInt128(perpetualId, "fMinimalAMMExposureEMA", floatToABK64x64(minAMMExposure));
        manager.setGenericPairData(perpetualId, "fStressReturnS2", floatToABK64x64(r2pair[0]), floatToABK64x64(r2pair[1]));
        manager.setGenericPairData(perpetualId, "fStressReturnS3", floatToABK64x64(r3pair[0]), floatToABK64x64(r3pair[1]));
        manager.setGenericPerpInt128(perpetualId, "fDFCoverNRate", floatToABK64x64(coverNrate));
        for (var idxCC = 0; idxCC < collateralCCYVec.length; idxCC++) {
            let collateralCCY = collateralCCYVec[idxCC];
            perpetual = await manager.getPerpetual(perpetualId);
            await manager.setCollateralCurrency(perpetualId, collateralCCY);
            let num_traders = await manager.getActivePerpAccounts(perpetualId);
            let coverN = Math.max(num_traders*coverNrate, 5)
            let k2TraderFloored = Math.max(k2Trader, minTraderExposure);
            let K2pairFloored = [Math.min(K2pair[0], -minTraderExposure), Math.max(K2pair[1], minTraderExposure)];
            let DFexpected = getDFTargetSize(K2pairFloored, k2TraderFloored, r2pair, r3pair, coverN, S2, S3, collateralCCY);
            //perpetual = await manager.getPerpetual(perpetualId);
            await manager.mockUpdateDefaultFundTargetSizeRandom(poolData.id, true);
            perpetual = await manager.getPerpetual(perpetualId);
            let dfTargetSize = perpetual.fTargetDFSize;
            let isEqual = equalForPrecisionFloat(DFexpected, ABK64x64ToFloat(dfTargetSize), 13);
            if (!isEqual) {
                console.log("Test failed: ccy idx=", idxCC);
                console.log("Value=", ABK64x64ToFloat(dfTargetSize));
                console.log("Expected=", DFexpected);
            }
            expect(isEqual).to.be.true;
        }
    });

    it("accumulateFunding", async () => {
        const fundingPeriod = 8 * 60 * 60; //8h
        //let timestamp = Date.now()/1000;
        let fundingRate = 0.0001;
        let collateralCCYVec = [COLLATERAL_CURRENCY_BASE, COLLATERAL_CURRENCY_QUOTE, COLLATERAL_CURRENCY_QUANTO];
        let S2 = 31000;
        let S3 = 2000;
        await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(S2));
        await manager.setGenericPriceData(perpetualId, "indexS3PriceData", floatToABK64x64(S3));
        await manager.setGenericPerpInt128(perpetualId, "fCurrentFundingRate", floatToABK64x64(fundingRate));
        let timeElapsed = 60 * 60 * 4; //4h
        let conversion = 1;
        for (var idxCC = 0; idxCC < collateralCCYVec.length; idxCC++) {
            manager.setGenericPerpInt128(perpetualId, "fUnitAccumulatedFunding", floatToABK64x64(0));
            let collateralCCY = collateralCCYVec[idxCC];
            await manager.setCollateralCurrency(perpetualId, collateralCCY);
            await manager.accumulateFundingInPerp(perpetualId, timeElapsed);
            perpetual = await manager.getPerpetual(perpetualId);
            let accRec = ABK64x64ToFloat(perpetual.fUnitAccumulatedFunding);

            if (collateralCCY == COLLATERAL_CURRENCY_QUANTO) {
                conversion = S2 / S3;
            } else if (collateralCCY == COLLATERAL_CURRENCY_BASE) {
                conversion = 1;
            } else {
                conversion = S2;
            }
            let accExpected = (conversion * fundingRate * timeElapsed) / fundingPeriod;

            let isEqual = equalForPrecisionFloat(accExpected, accRec, 13);
            if (!isEqual) {
                console.log("Test failed: ccy=", idxCC);
                console.log("Value=", accRec);
                console.log("Expected=", accExpected);
            }
            expect(isEqual).to.be.true;
        }
        // try run
        manager.accumulateFundingInPerp(perpetual.id, 0);
    });

    it("updateOraclePricesForPool: dont update price if too recent", async () => {
        // we check this by checking that iPriceUpdateTimeSec is not
        // updated
        const timestamp = Math.round(new Date() / 1000) + 10000;

        await manager.setPerpPriceUpdateTime(perpetualId, timestamp);
        let perp = await manager.getPerpetual(perpetualId);
        let timestampBefore = perp.iPriceUpdateTimeSec;

        await manager.updateOraclePricesForPool(poolId);

        perp = await manager.getPerpetual(perpetualId);
        let timestampAfter = perp.iPriceUpdateTimeSec;
        expect(timestampBefore).to.be.equal(timestampAfter);

    });
    it("updateOraclePricesForPool: should rebalance when significant price change", async () => {
        // rebalance happens if price change significant
        await manager.setGenericPerpInt128(perpetualId, "fAMMFundCashCC", floatToABK64x64(3));
        await manager.updateMarkPrice(perpetualId);
        let perpetual = await manager.getPerpetual(perpetualId);
        let priceData = await manager.getOraclePriceData(perpetual.oracleS2Addr);
        let updateTimeBefore = perpetual.currentMarkPremiumRate.time;
        await hre.ethers.provider.send('evm_increaseTime', [1500]); // Increasing block.timestamp
        
        let isSignificant = !priceData.isInSignificant;
        await manager.setPerpPriceUpdateTime(perpetual.id, 0);
        await manager.updateOraclePricesForPool(poolId);

        perpetual = await manager.getPerpetual(perpetualId);
        let updateTimeAfter = perpetual.currentMarkPremiumRate.time;
        
        await hre.ethers.provider.send('evm_increaseTime', [-1500]); // undo increase

        let isCorrect = isSignificant && updateTimeBefore!=updateTimeAfter
        if (!isCorrect) {
            console.log("isSignificant = ", isSignificant)
            console.log("updateTimeBefore = ", updateTimeBefore)
            console.log("updateTimeAfter = ", updateTimeAfter)
        }
        expect(isCorrect).to.be.true;

    });
    it("updateOraclePricesForPool: set emergency if market closed S2", async () => {
        let poolData = await createLiquidityPool(manager, owner);
        let poolId = poolData.id;
        let perpetualId = await createPerpetual(manager, poolId);
        let perpetual = await manager.getPerpetual(perpetualId);
        await manager.runLiquidityPool(poolId);
        let stateBefore = perpetual.state;

        let oracle = await ethers.getContractAt("ISpotOracle", perpetual.oracleS2Addr);

        await oracle.setTerminated(true);
        await manager.updateOraclePricesForPool(poolId);

        perpetual = await manager.getPerpetual(perpetualId);
        let stateAfter = perpetual.state;
        //console.log(stateAfter);
        //console.log(stateBefore);
        expect(stateAfter).to.be.equal(PerpetualStateEMERGENCY);
        expect(stateAfter).not.to.be.equal(stateBefore);
      
    });
    it("updateOraclePricesForPool: set emergency if market closed S3", async () => {
        let poolData = await createLiquidityPool(manager, owner);
        let poolId = poolData.id;
        let perpetualId = await createPerpetual(manager, poolId);
        let perpetual = await manager.getPerpetual(perpetualId);
        await manager.runLiquidityPool(poolId);
        let stateBefore = perpetual.state;

        let oracle = await ethers.getContractAt("ISpotOracle", perpetual.oracleS3Addr);

        await oracle.setTerminated(true);
        await manager.updateOraclePricesForPool(poolId);

        perpetual = await manager.getPerpetual(perpetualId);
        let stateAfter = perpetual.state;
        //console.log(stateAfter);
        //console.log(stateBefore);
        expect(stateAfter).to.be.equal(PerpetualStateEMERGENCY);
        expect(stateAfter).not.to.be.equal(stateBefore);
      
    });

});
