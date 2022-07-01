// @ts-nocheck
import { expect } from "chai";
const { ethers } = require("hardhat");
import { getAccounts, toBytes32,createContract } from "../scripts/utils/utils";
import { createLiquidityPool, createPerpetual, createPerpetualManager,createOracle } from "./TestFactory";
import {
    equalForPrecision,
    equalForPrecisionFloat,
    add64x64,
    sub64x64,
    mul64x64,
    div64x64,
    abs64x64,
    floatToABK64x64,
    ABK64x64ToFloat,
    fractionToABDK64x64,
    dec18ToFloat,
    floatToDec18,
    calculateFundingRate,
    PerpetualStateNORMAL,
    calculateAMMTargetSize,
    getDFTargetSize,
    COLLATERAL_CURRENCY_BASE,
    COLLATERAL_CURRENCY_QUOTE,
    COLLATERAL_CURRENCY_QUANTO,
    fromDec18,
} from "../scripts/utils/perpMath";

import { lsolveDependencies, lup } from "mathjs";
import {getBTCBaseParams} from "./TestFactory";
import { isEvmStep } from "hardhat/internal/hardhat-network/stack-traces/message-trace";

const BN = ethers.BigNumber;
const ONE_DEC18 = BN.from(10).pow(BN.from(18));
let accounts, perpetual, poolData, owner, manager, perpetualId;
let oracles;
let perpetualIds : BigNumber[];
let baseParamsBTC: BigNumber[];
let S2, S3;

const PerpetualStateINVALID = 0;
const PerpetualStateINITIALIZING = 1;
const PerpetualStateNORMAL = 2;
const PerpetualStateEMERGENCY = 3;
const PerpetualStateCLEARED = 4;
const numPerpetuals = 3;
/* Overview
    [x] _prepareRedemption
    [x] settleNextTraderInPool
    [x] _clearNextTraderInPerpetual
    [x] _clearTrader
    [x] _countMargin
    [i] _getNextActiveAccount
    [x] _setRedemptionRate
    [x] settle
    [i] _resetAccount
    [x] _getSettleableMargin
    i : implicitly tested
*/


describe("PerpetualSettlement", () => {
    

    before(async () => {
        accounts = await getAccounts();
        owner = accounts[0].address;

        manager = await createPerpetualManager();
        poolData = await createLiquidityPool(manager, owner);
        S2 = 60000;
        let S2Oracle = S2;
        let prices : BigNumber[] = [];
        for(var k = 0; k<20; k++) {
            prices.push(floatToABK64x64(S2Oracle));
        }
        const BTC = toBytes32("BTC");
        const USD = toBytes32("USD");
        const ETH = toBytes32("ETH");
        let oracleBTCUSD = await createContract("MockPriceScenarioOracle", [BTC, USD, prices]);
        oracles = [oracleBTCUSD.address, await createOracle(ETH, USD)];
       
        perpetualIds = new Array();
        for (let i = 0; i < numPerpetuals; i++) {
            let id = await createPerpetual(manager, poolData.id, getBTCBaseParams(), null, null, COLLATERAL_CURRENCY_BASE, oracles);
            perpetualIds.push(id);
        }
        
        await manager.runLiquidityPool(poolData.id);
        
        for (var j = 0; j<numPerpetuals; j++) {
            await manager.setGenericPriceData(perpetualIds[j], "indexS2PriceData", floatToABK64x64(S2));
            await manager.setGenericPriceData(perpetualIds[j], "settlementS2PriceData", floatToABK64x64(S2));
        }
    });

    describe("getSettleableMargin", async () => {
        it("normal state", async () => {
            let traderAddr = owner;
            await manager.setGenericPriceData(perpetualIds[0], "indexS2PriceData", floatToABK64x64(60000));
            let mgn0 = await manager.getSettleableMargin(perpetualIds[0], traderAddr);
            let mgn0f = ABK64x64ToFloat(mgn0);
            expect(mgn0f==0).to.be.true;
        });
        it("call from manager", async () => {
            await manager.setGenericPriceData(perpetualIds[0], "indexS2PriceData", floatToABK64x64(60000));
            let mgn0 = await manager.getSettleableMargin(perpetualIds[0], manager.address);
            let mgn0f = ABK64x64ToFloat(mgn0);
            expect(mgn0f==0).to.be.true;
        });
        it("call from negative margin", async () => {
            let L = -59000;
            let pos = -1;
            let cash = 0;
            let traderAddr = owner;
            await manager.setMarginAccount(perpetualIds[0], traderAddr,
                    floatToABK64x64(L),
                    floatToABK64x64(cash),
                    floatToABK64x64(pos));
            await manager.setGenericPriceData(perpetualIds[0], "indexS2PriceData", floatToABK64x64(60000));
            let mgn0 = await manager.getSettleableMargin(perpetualIds[0], traderAddr);
            let mgn0f = ABK64x64ToFloat(mgn0);
            expect(mgn0f==0).to.be.true;
        });

        it("cleared state", async () => {
            let traderAcc = accounts[0];
            let L = -48000;
            let cash = 0.1;
            let pos = -0.5;
            let redemptionRate = 0.75;
            /*
                margin = (pos*S2 - L1)*fx + cash - funding
                       = (-05*60000 - (-48000) )/60000 + 0.1 + 0 = 0.3 + 0.1 = 0.4
                       -> margin* redemption --> 0.4*0.75 =0.3
            */
           const marginRedExpected = 0.3;
            for (var j = 0; j<numPerpetuals; j++) {
                await manager.setMarginAccount(perpetualIds[j], traderAcc.address,
                                                floatToABK64x64(L),
                                                floatToABK64x64(cash),
                                                floatToABK64x64(pos));
                await manager.setPerpetualState(perpetualIds[j], PerpetualStateCLEARED);
            }
            await manager.setLiqPoolRedemptionRate(perpetualIds[0], floatToABK64x64(redemptionRate));
            
            for (var j = 0; j<2; j++) {
                let mgn0 = await manager.getSettleableMargin(perpetualIds[0], traderAcc.address);
                let mgn0f = ABK64x64ToFloat(mgn0);
                let isEqual = equalForPrecisionFloat(mgn0f, marginRedExpected, 12);
                if (!isEqual) {
                    console.log("Settleable margin perpetual received=", mgn0f);
                    console.log("Settleable margin perpetual expected=", marginRedExpected);
                }
                expect(isEqual).to.be.true;
            }
        });
    });

    describe("Set Redemption Rate", async () => {
        it("rate correct and state correct", async () => {
            let totalMgnBalance = 1000;
            let totalCapital    = 100;

            let rateExpected = Math.min(totalCapital/totalMgnBalance, 1);
            await manager.setPerpetualState(perpetualIds[0], PerpetualStateEMERGENCY);
            await manager.setPerpetualState(perpetualIds[1], PerpetualStateEMERGENCY);
            for (var j = 2; j<numPerpetuals; j++) {
                await manager.setPerpetualState(perpetualIds[j], PerpetualStateNORMAL);
            }

            await manager.setRedemptionRate(poolData.id,  floatToABK64x64(totalMgnBalance), floatToABK64x64(totalCapital));
            let lp = await manager.getLiquidityPool(poolData.id);
            let redRate = ABK64x64ToFloat(lp.fRedemptionRate );
            let isEqualRate = equalForPrecisionFloat(redRate, rateExpected, 15);
            if (!isEqualRate) {
                console.log("Redemption rate expected = ", rateExpected);
                console.log("Redemption rate received = ", redRate);
            }
            expect(isEqualRate).to.be.true;
            // require cleared state for the first two perpetuals in the pool
            for (var j = 0; j<numPerpetuals; j++) {
                let perp = await manager.getPerpetual(perpetualIds[j]);
                let stateCleared = perp.state == PerpetualStateCLEARED;
                let cond = (stateCleared && j<2) || (!stateCleared && j>=2);
                if (!cond) {
                    console.log("Perpetual ", j, " in state ", perp.state, " after redemption calculation")
                }
                expect(cond).to.be.true;
            }
            

        });
    });

    describe("settle", async () => {

        it("pre/post token balance add up", async () => {
            let traderAcc = accounts[0];//owner
            let redemptionRate = 0.75;
            let AMMFundCash = 1;
            let governanceAccount = accounts[2];
            let L = -48000;
            let cash = 0.1;
            let pos = -0.5;

            await manager.setMarginAccount(perpetualIds[0], traderAcc.address,
                floatToABK64x64(L),
                floatToABK64x64(cash),
                floatToABK64x64(pos));
            
            await manager.setLiqPoolRedemptionRate(perpetualIds[0], floatToABK64x64(redemptionRate));
            await manager.setPerpetualState(perpetualIds[0], PerpetualStateCLEARED);
            
            // transfer 'some' tokens to governance
            await poolData.marginToken.mint(governanceAccount.address, ONE_DEC18.mul(100));
            //let balance = await poolData.marginToken.balanceOf(governanceAccount.address);
            await poolData.marginToken.connect(governanceAccount).approve(manager.address, ONE_DEC18.mul(1000));
            // deposit amm-cash from governance to AMM vault
            await manager.addAmmGovernanceAddress(governanceAccount.address);
            await manager.connect(governanceAccount).addAMMLiquidityToPerpetual(perpetualIds[0], floatToABK64x64(AMMFundCash));
                        
            // register balance before
            let traderBalanceBefore = await poolData.marginToken.balanceOf(traderAcc.address);
            let vaultBalanceBefore = await poolData.marginToken.balanceOf(manager.address);
            let fMarginBalanceBefore = await manager.getMarginBalance(perpetualIds[0], manager.address);

            let traderMargin = (pos*S2-L)/S2+cash
            let fTraderMarginActual = await manager.getMarginBalance(perpetualIds[0], traderAcc.address);
            let traderMarginActual = ABK64x64ToFloat(fTraderMarginActual);
            
            
            let traderSettlement = ABK64x64ToFloat(mul64x64(fTraderMarginActual, floatToABK64x64(redemptionRate)));
            
            // finally we can call settle
            await manager.connect(traderAcc).settle(perpetualIds[0], traderAcc.address);

            let traderBalanceAfter = await poolData.marginToken.balanceOf(traderAcc.address);
            let vaultBalanceAfter = await poolData.marginToken.balanceOf(manager.address);

            let traderPaymentRec =  dec18ToFloat(traderBalanceAfter.sub(traderBalanceBefore));
            let isEqual = equalForPrecisionFloat(traderPaymentRec, traderSettlement, 14);
            let deltaVaultBalance = vaultBalanceAfter.sub(vaultBalanceBefore);
            let moneyCreated = dec18ToFloat(traderBalanceAfter.sub(traderBalanceBefore).add(deltaVaultBalance));
            if (!isEqual || moneyCreated!=0) {
                console.log("actual margin=",traderMarginActual)
                console.log("expected margin=",traderMargin)
                console.log("Trader payment done     = ", traderPaymentRec);
                console.log("Trader payment expected = ", traderSettlement);
                console.log("Trader Pre-balance  = ", dec18ToFloat(traderBalanceBefore));
                console.log("Trader Post-balance = ", dec18ToFloat(traderBalanceAfter));
                console.log("Vault Pre-balance  = ", dec18ToFloat(vaultBalanceBefore));
                console.log("Vault Post-balance = ", dec18ToFloat(vaultBalanceAfter));
            }
            expect(isEqual).to.be.true;
            expect(moneyCreated==0).to.be.true;

        });
    });

    describe("clear trader functions", async () => {

        it("countMargin", async () => {
            //let Lvec = [-48000, 49000, 49000, 0];
            //let posvec = [-0.5, 0.2, 0.2, 0];
            //let cashvec = [0.1, 0.2, 0.7, 0.3];
            let Lvec = [-62000, 50000, -48000];
            let posvec = [-1,    1,     -0.2];
            let cashvec = [2, 2, 2];
            let marginCount = 0;
            for(var j=0; j<posvec.length; j++) {
                await manager.setMarginAccount(perpetualIds[0], accounts[2+j].address,
                    floatToABK64x64(Lvec[j]),
                    floatToABK64x64(cashvec[j]),
                    floatToABK64x64(posvec[j]));
                await manager.countMargin(perpetualIds[0], accounts[2+j].address);
                let pure_margin =  ((posvec[j]*S2-Lvec[j])/S2+cashvec[j])
                let traderMargin = Math.max(0, pure_margin) * (posvec[j]!=0);
                //console.log("trader ", j, " pure margin=",pure_margin, " margin = ", traderMargin);
                marginCount = marginCount + traderMargin;
            }
            let perp = await manager.getPerpetual(perpetualIds[0]);
            let marginCountRec = ABK64x64ToFloat(perp.fTotalMarginBalance);
            let isEqual = equalForPrecisionFloat(marginCount, marginCountRec, 14);
            if (!isEqual) {
                console.log("countMargin");
                console.log("Margin Count expected = ", marginCount);
                console.log("Margin Count received = ", marginCountRec);
            }
            expect(isEqual).to.be.true;
        });

        it("countMargin negative", async () => {
            await manager.setGenericPerpInt128(perpetualIds[0], "fTotalMarginBalance", floatToABK64x64(0));
            let Lvec = [-59000, 50000, -48000];
            let posvec = [-1,    1,     -0.2];
            let cashvec = [0, 2, 2];
            let marginCount = 0;
            for(var j=0; j<posvec.length; j++) {
                await manager.setMarginAccount(perpetualIds[0], accounts[2+j].address,
                    floatToABK64x64(Lvec[j]),
                    floatToABK64x64(cashvec[j]),
                    floatToABK64x64(posvec[j]));
                await manager.countMargin(perpetualIds[0], accounts[2+j].address);
                let pure_margin =  ((posvec[j]*S2-Lvec[j])/S2+cashvec[j])
                let traderMargin = Math.max(0, pure_margin) * (posvec[j]!=0);
                //console.log("trader ", j, " pure margin=",pure_margin, " margin = ", traderMargin);
                marginCount = marginCount + traderMargin;
            }
            let perp = await manager.getPerpetual(perpetualIds[0]);
            let marginCountRec = ABK64x64ToFloat(perp.fTotalMarginBalance);
            let isEqual = equalForPrecisionFloat(marginCount, marginCountRec, 14);
            if (!isEqual) {
                console.log("countMargin");
                console.log("Margin Count expected = ", marginCount);
                console.log("Margin Count received = ", marginCountRec);
            }
            expect(isEqual).to.be.true;
        });

        it("clearTrader", async () => {
            let traderAcc = accounts[5];
            let depositAmount = 2;
            let L = -62000;
            let pos = -1;
            let cash = depositAmount;
            let premiumRate = 0.10;
            
            // deposit to have trader account in active accounts
            await poolData.marginToken.connect(traderAcc).approve(manager.address, ONE_DEC18.mul(1000));
            await poolData.marginToken.mint(traderAcc.address, ONE_DEC18.mul(100));
            await manager.setPerpetualState(perpetualIds[0], PerpetualStateNORMAL);
            await manager.connect(traderAcc).deposit(perpetualIds[0], floatToABK64x64(depositAmount));

            await manager.setGenericPriceData(perpetualIds[0], "currentMarkPremiumRate", floatToABK64x64(premiumRate));
            // set margin
            await manager.setMarginAccount(perpetualIds[0], traderAcc.address,
                floatToABK64x64(L),
                floatToABK64x64(cash),
                floatToABK64x64(pos));
            // margin before
            let perp = await manager.getPerpetual(perpetualIds[0]);
            let marginCountRec0 = ABK64x64ToFloat(perp.fTotalMarginBalance);
            // clear
            await manager.clearTrader(perpetualIds[0], traderAcc.address);
            await expect(
                manager.clearTrader(perpetualIds[0], traderAcc.address)
            ).to.be.revertedWith("no account to clear");

            // margin after
            perp = await manager.getPerpetual(perpetualIds[0]);
            let marginCountRec1 = ABK64x64ToFloat(perp.fTotalMarginBalance);
            let marginCounted = marginCountRec1-marginCountRec0;
            let pure_margin =  ((pos*S2*(1+premiumRate)-L)/S2+cash)
            let marginExpected = Math.max(0, pure_margin) * (pos!=0);
            let isEqual = equalForPrecisionFloat(marginExpected, marginCounted, 9);
            if (!isEqual) {
                console.log("clear trader");
                console.log("Margin count expected =", marginExpected);
                console.log("Margin count received =", marginCounted);
            }
            expect(isEqual).to.be.true;
        });

        it("clearNextTraderInPerpetual", async () => {
            let depositAmount = 2;
            let Lvec = [-62000, 50000, -48000];
            let posvec = [-1,    1,     -0.2];
            let cashvec = [depositAmount, depositAmount, depositAmount];

            let marginExpectedVec:number[] = new Array();

            for(var j=0; j<Lvec.length; j++) {
                let idxAccount = 5+j;
                // deposit to have trader account in active accounts
                await poolData.marginToken.connect(accounts[idxAccount]).approve(manager.address, ONE_DEC18.mul(1000));
                await poolData.marginToken.mint(accounts[idxAccount].address, ONE_DEC18.mul(100));
                await manager.setPerpetualState(perpetualIds[0], PerpetualStateNORMAL);
                await manager.connect(accounts[idxAccount]).deposit(perpetualIds[0], floatToABK64x64(depositAmount));
                await manager.setPerpetualState(perpetualIds[0], PerpetualStateEMERGENCY);
                // set margin
                let perp = await manager.getPerpetual(perpetualIds[0]);
                await manager.setMarginAccount(perpetualIds[0], accounts[idxAccount].address,
                    floatToABK64x64(Lvec[j]),
                    floatToABK64x64(cashvec[j]),
                    floatToABK64x64(posvec[j]));
                let pure_margin =  ((posvec[j]*S2-Lvec[j])/S2+cashvec[j])
                let marginCounted= Math.max(0, pure_margin) * (posvec[j]!=0);
                //console.log("pure_margin=", pure_margin, " margin counted=", marginCounted);
                marginExpectedVec.push(marginCounted);
            }
            
            await manager.setGenericPerpInt128(perpetualIds[0], "fTotalMarginBalance", 0);
            let perp = await manager.getPerpetual(perpetualIds[0]);
            let marginRec:number[] = new Array();
            // clear traders. The order is not the same as the one we used to add the traders
            // hence sort at the end.
            let marginSum = ABK64x64ToFloat(perp.fTotalMarginBalance);
            for(var j=0; j<Lvec.length; j++) {
                await manager.setGenericPerpInt128(perpetualIds[0], "fUnitAccumulatedFunding", floatToABK64x64(0));
                await manager.clearNextTraderInPerpetual(perpetualIds[0]);
                perp = await manager.getPerpetual(perpetualIds[0]);
                let newMarginSum = ABK64x64ToFloat(perp.fTotalMarginBalance);
                marginRec.push(newMarginSum-marginSum);
                marginSum = newMarginSum;
                /* Debug output:
                let marginAccount = await manager.getMarginAccount(perpetualIds[0], accounts[5+j].address);
                let cash = ABK64x64ToFloat(marginAccount.fCashCC);
                let L = ABK64x64ToFloat(marginAccount.fLockedInValueQC);
                let pos = ABK64x64ToFloat(marginAccount.fPositionBC);
                console.log("margin account cash =", cash);
                console.log("margin account L =", L);
                console.log("margin account pos =", pos);
                console.log("margin =", ((pos*S2-L)/S2+cash));
                */
            }
            marginExpectedVec.sort();
            marginRec.sort();
            for(var j=0; j<Lvec.length; j++) {
                let isEqual = equalForPrecisionFloat(marginExpectedVec[j], marginRec[j], 12);
                if (!isEqual) {
                    console.log("clearNextTraderInPerpetual");
                    console.log("marginSum expected = ", marginExpectedVec);
                    console.log("marginSum received = ", marginRec);
                }
                expect(isEqual).to.be.true;
            }
        });   
    });

    describe("settleNextTraderInPool", async () => {
        async function getNumClearedPerpetuals() {
            await manager.settleNextTraderInPool(poolData.id);
            let lp = await manager.getLiquidityPool(poolData.id);
            let perpCount = lp.iPerpetualCount;
            let numCleared = 0;
            for(var j=0; j<perpCount; j++) {
                let perp = await manager.getPerpetual(perpetualIds[j]);
                numCleared = numCleared + 1*(perp.state == PerpetualStateCLEARED);
            }
            return numCleared;
        }
        async function calculateLPCapital(doLog : boolean) {
            let lp = await manager.getLiquidityPool(poolData.id);
            let perpCount = lp.iPerpetualCount;
            let ammMargin = 0
            let AMMFundCash = 0;
            for(var j=0; j<perpCount; j++) {
                let perp = await manager.getPerpetual(perpetualIds[j]);
                if (perp.state == PerpetualStateEMERGENCY) {
                    let mgn = await manager.getMarginBalance(perpetualIds[j], manager.address);
                    ammMargin = ammMargin + ABK64x64ToFloat(mgn);
                    let cash = ABK64x64ToFloat(perp.fAMMFundCashCC);
                    AMMFundCash = AMMFundCash + cash;
                }
            }
            // trader margin
            let traderMargin = 0;
            for(var j=0; j<perpCount; j++) {
                let accounts = await manager.getActivePerpAccounts(perpetualIds[j]);
                for(var k = 0; k < accounts.length; k++) {
                    let fMgn = await manager.getMarginBalance(perpetualIds[j], accounts[k]);
                    let mgn = ABK64x64ToFloat(fMgn);
                    //log: console.log("trader ",k," margin=", mgn);
                    traderMargin = traderMargin + (mgn);
                }
            }
            if(doLog) {
                console.log("lp.fPnLparticipantsCashCC", ABK64x64ToFloat(lp.fPnLparticipantsCashCC));
                console.log("lp.fDefaultFundCashCC", ABK64x64ToFloat(lp.fDefaultFundCashCC));
                console.log("ammMargin", ammMargin);
                console.log("AMMFundCash", AMMFundCash);
                console.log("traderMargin", traderMargin);
            }   
            
            let totalCapitalCC = ABK64x64ToFloat(add64x64(lp.fPnLparticipantsCashCC, lp.fDefaultFundCashCC));
            totalCapitalCC = totalCapitalCC + ammMargin + AMMFundCash + traderMargin;
            return [totalCapitalCC, traderMargin];
        }

        before(async () => {
            // initialize 3 perpetuals in the liq pool
            let depositAmount = 2;
            let Lvec = [-62000, 50000, -48000];
            let posvec = [-1,    1,     -0.2];
            let cashvec = [depositAmount, depositAmount, depositAmount];
            let AMMCash = 0.25;
            let DFCash = 1.25;
            await manager.setDefaultFundCashCC(poolData.id, floatToABK64x64(DFCash));
            
            for(var perpIdx = 0; perpIdx < 3; perpIdx ++) { 
                // set AMM margin
                await manager.setMarginAccount(perpetualIds[perpIdx], manager.address,
                    floatToABK64x64(-Lvec.reduce((a,b)=>a+b)),
                    floatToABK64x64(depositAmount*5),
                    floatToABK64x64(-posvec.reduce((a,b)=>a+b)));
                // set AMM cash
                await manager.setGenericPerpInt128(perpetualIds[perpIdx], "fAMMFundCashCC", floatToABK64x64(AMMCash));
                for(var j=0; j<Lvec.length; j++) {
                    let idxAccount = 5+j;
                    // deposit to have trader account in active accounts
                    await poolData.marginToken.connect(accounts[idxAccount]).approve(manager.address, ONE_DEC18.mul(1000));
                    await poolData.marginToken.mint(accounts[idxAccount].address, ONE_DEC18.mul(100));
                    await manager.setPerpetualState(perpetualIds[perpIdx], PerpetualStateNORMAL);
                    await manager.connect(accounts[idxAccount]).deposit(perpetualIds[perpIdx], floatToABK64x64(depositAmount));
                    await manager.setPerpetualState(perpetualIds[perpIdx], PerpetualStateEMERGENCY);
                    // set margin
                    await manager.setMarginAccount(perpetualIds[perpIdx], accounts[idxAccount].address,
                        floatToABK64x64(Lvec[j]),
                        floatToABK64x64(cashvec[j]),
                        floatToABK64x64(posvec[j]));
                }
            }
            await manager.setAMMFundCashCC(poolData.id, floatToABK64x64(AMMCash * 3));
        });   
        
        it("one call settleNextTraderInPool", async () => {
            await manager.settleNextTraderInPool(poolData.id);
            let numCleared = await getNumClearedPerpetuals();
            if (numCleared!=0) {
                console.log("settleNextTraderInPool failed");
                console.log("numCleared = ", numCleared);
            }
            expect(numCleared==0).to.be.true;
        });

        it("loop to clear all", async () => {
            let lp = await manager.getLiquidityPool(poolData.id);
            let perpCount = lp.iPerpetualCount;
            for(var j=0; j<perpCount; j++) {
                await manager.setGenericPerpInt128(perpetualIds[j], "fTotalMarginBalance", 0);
            }
            let doLogFunds = false;
            let totalCapitalBefore, totalTraderMgnBefore;
            [totalCapitalBefore, totalTraderMgnBefore] = await calculateLPCapital(doLogFunds);
            let isRunning = lp.isRunning;
            expect(isRunning).to.be.true;
            let count = 1;
            let totalMarginBalance=[0,0,0];
            while (count > 0) {
                await manager.settleNextTraderInPool(poolData.id);
                count = 0;
                for(var j=0; j<perpCount; j++) {
                    let num = await manager.countActivePerpAccounts(perpetualIds[j]);
                    count = count + num.toNumber();
                    let perp = await manager.getPerpetual(perpetualIds[j]);
                    totalMarginBalance[j] = ABK64x64ToFloat(perp.fTotalMarginBalance);
                }
                // count: console.log("count =", count.toString());
            }
            let numCleared = await getNumClearedPerpetuals();
            if (numCleared != 3) {
                console.log("numCleared received = ", numCleared);
                console.log("numCleared expected = ", 3);
            }
            expect(numCleared==3).to.be.true;
            lp = await manager.getLiquidityPool(poolData.id);
            let totalCapitalAfter = ABK64x64ToFloat(
                add64x64(add64x64(lp.fPnLparticipantsCashCC, lp.fDefaultFundCashCC), lp.fAMMFundCashCC));
            let totalCapitalAfter2 = await calculateLPCapital(doLogFunds);
            // expect the pool to be set to not running because all perpetuals were settled
            isRunning = lp.isRunning;
            expect(isRunning).to.be.false;
            let isEqual = equalForPrecisionFloat(totalCapitalAfter+totalTraderMgnBefore, totalCapitalBefore, 14);
            if(!isEqual) {
                console.log("redemption rate = ", ABK64x64ToFloat(lp.fRedemptionRate));
                console.log("Total capital before = ", totalCapitalBefore);
                console.log("Total capital after = ", totalCapitalAfter);
                console.log("Total capital after + trader mgn = ", totalCapitalAfter+totalTraderMgnBefore);
            }
            expect(isEqual).to.be.true;
        });
        
    });  
    
});

