// @ts-nocheck
import { expect } from "chai";
const { ethers } = require("hardhat");
import { getAccounts } from "../scripts/utils/utils";
import { createLiquidityPool, createPerpetual, createPerpetualManager, createMockPerpetual } from "./TestFactory";
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
    toDec18,
    calcKStar,
    calculateFundingRate,
    PerpetualStateNORMAL,
    calculateAMMTargetSize,
    getDFTargetSize,
    calcKStarSide,
    COLLATERAL_CURRENCY_BASE,
    COLLATERAL_CURRENCY_QUOTE,
    COLLATERAL_CURRENCY_QUANTO,
} from "../scripts/utils/perpMath";
import { lup } from "mathjs";
import {getBTCBaseParams} from "./TestFactory";

const BN = ethers.BigNumber;

let accounts, perpetual, poolData, owner, manager, perpetualId;
let baseParamsBTC: BigNumber[];
let S2, S3;

const PerpetualStateINVALID = 0;
const PerpetualStateINITIALIZING = 1;
const PerpetualStateNORMAL = 2;
const PerpetualStateEMERGENCY = 3;
const PerpetualStateCLEARED = 4;


/* Overview
    [x] _isTraderMarginSafe - covered in perpetualTradeLogic
    [x] _isMarginSafe - covered in perpetualTradeLogic
    [i] _rebalance
    [x] equalizeAMMMargin
    [x] _getRebalanceMargin
    [x] _transferFromAMMMarginToPool
    [x] _transferFromPoolToAMMMargin
    [x] _increaseAMMFundCashForPerpetual
    [x] _decreaseAMMFundCashForPerpetual
    [i] _setLiqPoolEmergencyState
    [i] _setEmergencyState
    [x] _hasOpenedPosition
    [x] _calcKStarSide, updateKStar
    [x] splitAmount
    i : implicitly tested
*/

async function queryMarginGap(inFloat : boolean) {
    let initialMargin = await manager.getInitialMargin(perpetualId,  manager.address);
    let currentMargin = await manager.getMarginBalance(perpetualId, manager.address);   
    if (inFloat) {
        return ABK64x64ToFloat(currentMargin.sub(initialMargin));
    } else {
        return currentMargin.sub(initialMargin);
    }
}

async function queryPoolCash() {
    // get AMM pool cash, PnL participant cash and DF cash
    perpetual = await manager.getPerpetual(perpetualId);
    let lp = await manager.getLiquidityPool(poolData.id);
    let poolCashAfter_rec = ABK64x64ToFloat(perpetual.fAMMFundCashCC) + ABK64x64ToFloat(lp.fPnLparticipantsCashCC) + ABK64x64ToFloat(lp.fDefaultFundCashCC);
    return poolCashAfter_rec;
}

async function queryDefaultFundCash() {
    let lp = await manager.getLiquidityPool(poolData.id);
    return ABK64x64ToFloat(lp.fDefaultFundCashCC);
}

async function queryMarginCash() {
    let marginAccount = await manager.getMarginAccount(perpetualId, manager.address);
    return ABK64x64ToFloat(marginAccount.fCashCC);
}

async function setAMMLPDFCash(AMMFundCash: number, PnLparticipantCash: number, DFCash: number) {
    await manager.setGenericPerpInt128(perpetualId, "fAMMFundCashCC", floatToABK64x64(AMMFundCash));
    await manager.setPnLparticipantsCashCC(poolData.id, floatToABK64x64(PnLparticipantCash));
    await manager.setDefaultFundCashCC(poolData.id, floatToABK64x64(DFCash));
}

describe("PerpetualRebalanceFunctions: kstar", () => {
    before(async () => {
        accounts = await getAccounts();
        owner = accounts[0].address;

        manager = await createPerpetualManager();
        baseParamsBTC = getBTCBaseParams();
    });

    it("updateKStar", async () => {
        let L1vec = [-47000, 10000];
        let K2vec = [-1, 1];
        let S2vec = [50000, 20000];
        let S3 = 4000;
        let M2 = 2;
        let M3 = 20;
        let M1 = 60000;
        let sig2 = 0.05;
        let sig3 = 0.08;
        let rho = 0.4;
        let r = 0;
        let cash = 3;
        let collateralVec = [COLLATERAL_CURRENCY_BASE, COLLATERAL_CURRENCY_QUANTO, COLLATERAL_CURRENCY_QUOTE];
        let sCollVec = ['BASE', "QUANTO", 'QUOTE'];
        let Mvec = [M2, M3, M1];

        async function updateLiqPool(collateral_ccy) {
            poolData = await createLiquidityPool(manager, owner);
            perpetualId = await createPerpetual(manager, poolData.id, baseParamsBTC, null, null, collateral_ccy);
            //await manager.runLiquidityPool(poolData.id);
        }
        

        for(var ccy = 0; ccy < 3; ccy++) {
            await updateLiqPool(collateralVec[ccy]);
            let M = Mvec[ccy];
            for(var j = 0; j<L1vec.length; j++) {
                
                let L1 = L1vec[j];
                let S2 = S2vec[j];
                for(var jj = 0; jj<K2vec.length; jj++) {
                    let K2 = K2vec[jj];
                    
                    await manager.setMarginAccount(perpetualId, manager.address,
                        floatToABK64x64(-L1),
                        floatToABK64x64(cash),
                        floatToABK64x64(-K2));
                    await manager.setGenericPerpInt128(perpetualId, "fAMMFundCashCC", floatToABK64x64(M) );
                    await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(S2) );
                    await manager.setGenericPriceData(perpetualId, "indexS3PriceData", floatToABK64x64(S3) );
                    await manager.setGenericPerpInt128(perpetualId, "fRho23", floatToABK64x64(rho) );
                    await manager.setGenericPerpInt128(perpetualId, "fSigma2", floatToABK64x64(sig2) );
                    await manager.setGenericPerpInt128(perpetualId, "fSigma3", floatToABK64x64(sig3) );
                    await manager.updateKStar(perpetualId);
                    let perp = await manager.getPerpetual(perpetualId);
                    let kStarSide = ABK64x64ToFloat(perp.fkStarSide);
                    let kStarReceived = ABK64x64ToFloat(perp.fkStar);
                    let kStarExp;
                    let M1=0, M2=0, M3=0;
                    if (sCollVec[ccy] == 'BASE') {
                        kStarExp = calcKStar(K2, L1, S2, S3, 0, M, 0, rho, sig2, sig3);
                        M2 = M;
                        //expect(Math.sign(-kStarExp)==Math.sign(kStarSideExpected));
                    } else if (sCollVec[ccy] == 'QUANTO') {
                        kStarExp = calcKStar(K2, L1, S2, S3, 0, 0, M, rho, sig2, sig3);
                        M3 = M;
                        //expect(Math.sign(-kStarExp)==Math.sign(kStarSideExpected));
                    } else if (sCollVec[ccy] == 'QUOTE') {
                        kStarExp = calcKStar(K2, L1, S2, S3, M, 0, 0, rho, sig2, sig3);
                        M1 = M;
                    }
                    let kStarSideExpected = kStarExp>0 ? 1 : -1;
                    let isEqual = equalForPrecisionFloat(kStarExp, kStarReceived, 12);
                    if(!isEqual) {
                        console.log("kStar expected=", kStarExp);
                        console.log("kStar received=", kStarReceived);    
                    }
                    let isEqualSign = Math.sign(kStarSideExpected) == Math.sign(kStarSide);
                    if (!isEqualSign) {
                        console.log("Numerical evaluation of kStarSideExpected failed:");
                        console.log("Collateral ", sCollVec[ccy]);
                        console.log("K2 = ", K2, " L1=", L1, " S2=", S2, " M=", M);
                        console.log("Iteration : ", j);
                        console.log("kStarSide expected=", kStarSideExpected);
                        console.log("kStarSide received=", kStarSide);    
                    }
                    expect(isEqual).to.be.true;
                    expect(isEqualSign).to.be.true;
                }//jj
            }//j
        }//ccy
    });

});

describe("PerpetualRebalanceFunctions", () => {
    async function createNewPool() {
        baseParamsBTC = getBTCBaseParams();
        poolData = await createLiquidityPool(manager, owner);
        perpetualId = await createPerpetual(manager, poolData.id, baseParamsBTC, null, null, COLLATERAL_CURRENCY_BASE);
        await manager.runLiquidityPool(poolData.id);
    }

    before(async () => {
        accounts = await getAccounts();
        owner = accounts[0].address;
        manager = await createPerpetualManager();
        await createNewPool();
    });

  
    it("hasTheSameSign", async () => {
        let aVec = [-1, 0, 1];
        let bVec = [-1, 0, 1];
        for (var i = 0; i < aVec.length; i++) {
            for (var j = 0; j < bVec.length; j++) {
                let a = aVec[i];
                let b = bVec[j];
                let hasSameSign = a == 0 || b == 0 || Math.sign(a) == Math.sign(b);
                let hssContract = await manager.hasTheSameSign(floatToABK64x64(a), floatToABK64x64(b));
                expect(hasSameSign == hssContract).to.be.true;
            }
        }
    });

    it("split amount", async () => {
        function splitAmount(amount: number, withdraw: bool, PnLparticipantCash: number, AMMFundCash: number) {
            const ceilPnLShare = 0.75;
            let wPnLparticipants = Math.min(ceilPnLShare, PnLparticipantCash / (PnLparticipantCash + AMMFundCash));
            let amountPnLparticipants = wPnLparticipants * amount;
            let amountAMM = amount - amountPnLparticipants;
            if (withdraw) {
                console.assert(PnLparticipantCash + AMMFundCash > amount); // precondition
                if (amountPnLparticipants > PnLparticipantCash) {
                    let spillover = amountPnLparticipants - PnLparticipantCash;
                    amountAMM = amountAMM + spillover;
                    amountPnLparticipants = amountPnLparticipants - spillover;
                }
                if (amountAMM > AMMFundCash) {
                    let spillover = amountAMM - AMMFundCash;
                    amountAMM = amountAMM - spillover;
                    amountPnLparticipants = amountPnLparticipants + spillover;
                }
            }
            return [amountAMM, amountPnLparticipants];
        }

        const AMMFundCash = 0.5;
        let amount = 0.5;
        let withdraw = false;

        await manager.setGenericPerpInt128(perpetualId, "fAMMFundCashCC", floatToABK64x64(AMMFundCash));

        let PnLparticipantCashArr = [0, 0.5, 1, 5];
        for (var j = 0; j < PnLparticipantCashArr.length; j++) {
            let PnLparticipantCash = PnLparticipantCashArr[j];
            await manager.setPnLparticipantsCashCC(poolData.id, floatToABK64x64(PnLparticipantCash));

            // typescript function
            let resExpected = splitAmount(amount, withdraw, PnLparticipantCash, AMMFundCash);
            let amountAMM = resExpected[0];
            let amountPnLparticipants = resExpected[1];
            // contract
            let amountsReceived = await manager.splitAmount(poolData.id, floatToABK64x64(amount), withdraw);
            let amountPnLparticipantsRec = ABK64x64ToFloat(amountsReceived[0]);
            let amountAMMFundRec = ABK64x64ToFloat(amountsReceived[1]);
            // compare
            let isEqual = equalForPrecisionFloat(amountPnLparticipantsRec, amountPnLparticipants, 16) && equalForPrecisionFloat(amountAMMFundRec, amountAMM, 16);
            if (!isEqual) {
                console.log("split amount failed for PnLparticipantCash=", PnLparticipantCash);
                console.log("expected PnLparticipant=", amountPnLparticipants, "expected AMM fund=", amountAMM);
                console.log("response PnLparticipants=", ABK64x64ToFloat(amountsReceived[0]), "response AMM fund=", ABK64x64ToFloat(amountsReceived[1]));
            }
            expect(isEqual).to.be.true;
        }
    });

    it("transferFromAMMMarginToPool", async () => {
        //    check AMM margin is decreased
        //    change in liqpool + AMM pool + default fund = margin
        const AMMFundCash = 0.5;
        const PnLparticipantCash = 0.5;
        const DFCash = 0.5;

        await setAMMLPDFCash(AMMFundCash, PnLparticipantCash, DFCash);

        let initialCash = 6;
        await manager.setMarginAccount(perpetualId, manager.address, 0, floatToABK64x64(initialCash), 0);

        let amountArr = [0.2, 0.5, 1, 5];
        for (var j = 0; j < amountArr.length; j++) {
            let amount = amountArr[j];

            let poolCashBefore = await queryPoolCash();
            let marginCashBefore = await queryMarginCash();

            await manager.transferFromAMMMarginToPool(perpetualId, floatToABK64x64(amount));

            let poolCashAfter = await queryPoolCash();
            let marginCashAfter = await queryMarginCash();

            // TS functions
            let marginCashAfter_exp = marginCashBefore - amount;

            let isEqual =
                equalForPrecisionFloat(amount, poolCashAfter - poolCashBefore, 15) && equalForPrecisionFloat(marginCashAfter_exp, marginCashAfter, 15);
            if (!isEqual) {
                console.log("PnLparticipant+AMM+default fund Cash delta expected=", amount);
                console.log("PnLparticipant+AMM+default fund Cash delta received=", poolCashAfter - poolCashBefore);
                console.log("Margin Cash expected=", marginCashAfter_exp);
                console.log("Margin Cash received=", marginCashAfter);
            }
            expect(isEqual).to.be.true;
        }
    });

    it("transferFromPoolToAMMMargin: regular", async () => {
        // regular setting
        const AMMFundCash = 0.5;
        let PnLparticipantCash = 0.5;
        let DFCash = 0.5;
        let initialCash = 6;

        let transferAmount = 0.4;

        await setAMMLPDFCash(AMMFundCash, PnLparticipantCash, DFCash);
        await manager.setMarginAccount(perpetualId, manager.address, 0, floatToABK64x64(initialCash), 0);

        // test
        let marginCashBefore = await queryMarginCash();
        let totalPoolCashBefore = await queryPoolCash();
        await manager.transferFromPoolToAMMMargin(perpetualId, floatToABK64x64(transferAmount));
        let marginCashAfter = await queryMarginCash();
        let totalPoolCashAfter = await queryPoolCash();

        let isEqual = equalForPrecisionFloat(transferAmount, totalPoolCashBefore - totalPoolCashAfter, 16);
        if (!isEqual) {
            console.log("transferFromPoolToAMMMargin failed:");
            console.log("Diff total pool cash=", totalPoolCashAfter - totalPoolCashBefore);
            console.log("margin cash before=", marginCashBefore);
            console.log("margin cash after =", marginCashAfter);
            console.log("amount transferred =", transferAmount);
        }
        expect(isEqual).to.be.true;
    });

    it("transferFromPoolToAMMMargin: amount>max amount", async () => {
        for (var j = 0; j < 3; j++) {
            let AMMFundCash;
            let PnLparticipantCash;
            let DFInitialCash;
            let initialMarginCash;
            let transferAmount;
            if (j == 0) {
                //1) default fund sufficient but pool emptied
                AMMFundCash = 0.4;
                PnLparticipantCash = 0.0;
                DFInitialCash = 0.5;
                initialMarginCash = 6;
                transferAmount = 0.6;
            } else if (j == 1) {
                //2) pool cash 0.1, df fund sufficient -> no emergency
                AMMFundCash = 0.1;
                PnLparticipantCash = 0.1;
                DFInitialCash = 0.5;
                initialMarginCash = 6;
                transferAmount = 0.613;
            } else {
                //3) default fund too small -> liq pool emergency
                AMMFundCash = 0.5;
                PnLparticipantCash = 0.0;
                DFInitialCash = 0.5;
                initialMarginCash = 6;
                transferAmount = 1.1;
            }

            await manager.setMarginAccount(perpetualId, manager.address, 0, floatToABK64x64(initialMarginCash), 0);
            await setAMMLPDFCash(AMMFundCash, PnLparticipantCash, DFInitialCash);
            // test
            // before
            let marginCashBefore = await queryMarginCash();
            let totalPoolCashBefore = await queryPoolCash();
            // request
            await manager.transferFromPoolToAMMMargin(perpetualId, floatToABK64x64(transferAmount));
            // after
            let marginCashAfter = await queryMarginCash();
            let totalPoolCashAfter = await queryPoolCash();
            let dfCashRec = await queryDefaultFundCash();

            let dfCashExpected = Math.max(0, DFInitialCash + Math.min(0, 0.95*(AMMFundCash + PnLparticipantCash) - transferAmount));
            let transferAmountExpected = Math.min(transferAmount, 0.95*(AMMFundCash + PnLparticipantCash) + DFInitialCash);
            let isEqual =
                equalForPrecisionFloat(transferAmountExpected, totalPoolCashBefore - totalPoolCashAfter, 10) &&
                equalForPrecisionFloat(dfCashExpected, dfCashRec, 10);
            perpetual = await manager.getPerpetual(perpetualId);
            let AMMFundCashAfter = ABK64x64ToFloat(perpetual.fAMMFundCashCC);
            let shouldBeEmergency = dfCashRec == 0;
            let isStateCorrect = shouldBeEmergency == (perpetual.state == PerpetualStateEMERGENCY);
            if (!isStateCorrect || !isEqual) {
                console.log("transferFromPoolToAMMMargin: amount>max amount failed at iteration ", j);
                console.log("emergency state? ", perpetual.state == PerpetualStateEMERGENCY);
                console.log("          state =", perpetual.state);
                if (shouldBeEmergency) {
                    console.log("          state should be emergency");
                }
                console.log("amount we wish to transfer =", transferAmount);
                console.log("amount expect to be transferred =", transferAmountExpected);
                console.log("Pool cash transferred out=", totalPoolCashBefore - totalPoolCashAfter);
                console.log("AMM pool cash after =", AMMFundCashAfter);
                console.log("margin cash before=", marginCashBefore);
                console.log("margin cash after =", marginCashAfter);

                console.log("DF fund balance expected =", dfCashExpected);
                console.log("DF fund balance received =", dfCashRec);
            }
            expect(isStateCorrect && isEqual).to.be.true;
            await createNewPool();
        } //for j
    });

    it("increaseAMMFundCashForPerpetual", async () => {
        /*
            tests: 
            if funds are added to AMM pool, and target size is reached then funds are redistributed:
            1) if AMM target pool size not reached, funds must be sent to AMM pool
            2) if AMM target pool size reached, funds are sent to default fund
        */

        // cases 1, 1, 2 
        let fAmountIncreaseV = [0.1, 0.2, 0.6];
        let AMMFundCashStartV = [0.2, 0.2, 0.2];
        let targetAMMFundSizeV = [0.5, 0.5, 0.5];
        let targetDFpoolSizeV = [0.2, 0.2, 0.2];
        let DFCashStartV = [0.2, 0.3, 0.2];
        /*
        case 1: amm=0.3, df=0.2 
        case 2: amm=0.4+0.1*.01 = 0.401, df = 0.3-0.1*0.01=0.299
        case 3: amm=0.5, df=0.5
        
        resAMM = [0.3, 0.401, 0.5];
        resDF  = [0.2, 0.299, 0.5];
        */

        function getPoolAmounts(amountAdd: number, currentAMMCash: number, currentDFCash: number, targetAMM: number, targetDF: number) {
            const DF_TO_AMMFund_WITHDRAWAL_SHARE = 0.01;
            //1) excess AMM amount?
            let excessAMM = currentAMMCash + amountAdd - targetAMM;
            if (excessAMM > 0) {
                currentDFCash += excessAMM;
                amountAdd -= excessAMM;
            } // else 
              //2) excessAMM<0 
              // add all amountAdd to AMM fund
              
            currentAMMCash += amountAdd;
            return [currentAMMCash, currentDFCash];
        }

        for (var j = 0; j < fAmountIncreaseV.length; j++) {
            await createNewPool();
            let fAmountIncrease = fAmountIncreaseV[j];
            let AMMFundCashStart = AMMFundCashStartV[j];
            let targetAMMFundSize = targetAMMFundSizeV[j];
            let targetDFpoolSize = targetDFpoolSizeV[j];
            let DFCashStart = DFCashStartV[j];

            await manager.setGenericPerpInt128(perpetualId, "fAMMFundCashCC", floatToABK64x64(AMMFundCashStart));
            await manager.setGenericPerpInt128(perpetualId, "fTargetDFSize", floatToABK64x64(targetDFpoolSize));
            await manager.setGenericPerpInt128(perpetualId, "fTargetAMMFundSize", floatToABK64x64(targetAMMFundSize));
            await manager.setDefaultFundCashCC(poolData.id, floatToABK64x64(DFCashStart));

            perpetual = await manager.getPerpetual(perpetualId);
            let lp = await manager.getLiquidityPool(poolData.id);
            let poolCashBefore = ABK64x64ToFloat(perpetual.fAMMFundCashCC);
            let lpPoolCashBefore = ABK64x64ToFloat(lp.fAMMFundCashCC);
            let isEqual = equalForPrecisionFloat(poolCashBefore, lpPoolCashBefore, 16);
            if (!isEqual) {
                console.log("increaseAMMFundCashForPerpetual failed iteration", j);
                console.log("   pool cash not equal in lp and amm");
                console.log("   pool cash AMM=", poolCashBefore);
                console.log("   pool cash LP =", lpPoolCashBefore);
                console.log("   pool running? ", lp.isRunning);
                console.log("   perpetual.state ", perpetual.state);
            }
            expect(isEqual).to.be.true;

            await manager.increaseAMMFundCashForPerpetual(perpetualId, floatToABK64x64(fAmountIncrease));

            perpetual = await manager.getPerpetual(perpetualId);
            lp = await manager.getLiquidityPool(poolData.id);
            let poolCashAfter = ABK64x64ToFloat(perpetual.fAMMFundCashCC);
            let lpPoolCashAfter = ABK64x64ToFloat(lp.fAMMFundCashCC);
            let DefaultFundAfter = ABK64x64ToFloat(lp.fDefaultFundCashCC);

            let fundAmountExpected = getPoolAmounts(fAmountIncrease, AMMFundCashStart, DFCashStart, targetAMMFundSize, targetDFpoolSize);
            let AMMCashExpected = fundAmountExpected[0];
            let DFCashExpected = fundAmountExpected[1];
            isEqual = equalForPrecisionFloat(poolCashAfter, AMMCashExpected, 16) && equalForPrecisionFloat(DefaultFundAfter, DFCashExpected, 16);
            let isEqualLPandPool = equalForPrecisionFloat(lpPoolCashAfter, poolCashAfter, 16);

            if (!isEqual || !isEqualLPandPool) {
                console.log("increaseAMMFundCashForPerpetual failed iteration", j);
                console.log("   pool cash exp.=", AMMCashExpected);
                console.log("   DF cash after=", DefaultFundAfter);
                console.log("   DF cash exp.=", DFCashExpected);
            }
            if (!isEqualLPandPool) {
                console.log("Difference in AMM/LP pool cash:");
                console.log("   pool cash after=", poolCashAfter);
                console.log("   pool cash in LP after=", lpPoolCashAfter);
            }
            expect(isEqual && isEqualLPandPool).to.be.true;
            let isZeroSum = equalForPrecisionFloat(AMMFundCashStart + DFCashStart + fAmountIncrease, lpPoolCashAfter + DefaultFundAfter, 16);
            expect(isZeroSum).to.be.true;
        }
    });

    it("decreaseAMMFundCashForPerpetual", async () => {
        let amount = 10;

        let lp = await manager.getLiquidityPool(poolData.id);
        let lpPoolCashBefore = ABK64x64ToFloat(lp.fAMMFundCashCC);
        perpetual = await manager.getPerpetual(perpetualId);
        let perpPoolCashBefore = ABK64x64ToFloat(perpetual.fAMMFundCashCC);
        await manager.decreaseAMMFundCashForPerpetual(perpetualId, floatToABK64x64(amount));
        perpetual = await manager.getPerpetual(perpetualId);
        let perpPoolCashAfter = ABK64x64ToFloat(perpetual.fAMMFundCashCC);
        lp = await manager.getLiquidityPool(poolData.id);
        let lpPoolCashAfter = ABK64x64ToFloat(lp.fAMMFundCashCC);

        let diffReceivedPerp = perpPoolCashAfter - perpPoolCashBefore;
        let diffReceivedLP = lpPoolCashAfter - lpPoolCashBefore;
        let isEqual = equalForPrecisionFloat(diffReceivedPerp, diffReceivedLP, 16) && equalForPrecisionFloat(diffReceivedPerp, -amount, 16);
        if (!isEqual) {
            console.log("decreaseAMMFundCashForPerpetual failed:");
            console.log("LP pool cash diff=", diffReceivedPerp);
            console.log("Perp pool cash diff=", diffReceivedLP);
            console.log("Expected diff=", -amount);
        }
        expect(isEqual).to.be.true;
    });

    it("hasOpenedPosition", async () => {
        //2, 1 => true; 2, -1 => false; -2, -3 => true
        let cases = [
            [2, 1],
            [2, -1],
            [-2, -3],
        ];
        let res = [true, false, true];
        for (var j = 0; j < cases.length; j++) {
            let hO = await manager.hasOpenedPosition(cases[j][0], cases[j][1]);
            expect(hO == res[j]).to.be.true;
        }
    });

    it("getRebalanceMargin", async () => {
        let DFCash = 0.25;
        let PnLparticipantCash = 0.1;
        let AMMCash = 0.2;
        let s2 = 40000;
        let premium = 5;
        let lockedInValueQC = -s2;
        let cashCC = 0.01;
        let posBC = -1;

        await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(s2));
        await manager.setGenericPriceData(perpetualId, "currentPremiumEMA", floatToABK64x64(premium));
        await manager.setMarginAccount(perpetualId, manager.address, 
            floatToABK64x64(lockedInValueQC), 
            floatToABK64x64(cashCC), 
            floatToABK64x64(posBC));
        await setAMMLPDFCash(AMMCash, PnLparticipantCash, DFCash);

        let gapExpected = await queryMarginGap(false);
        let gapReceived = await manager.getRebalanceMargin(perpetualId);
        expect(gapExpected.toString()==gapReceived.toString()).to.be.true;
        
    });

    it("equalizeAMMMargin", async () => {
        let DFCash = 0.25;
        let PnLparticipantCash = 0.1;
        let AMMCash = 0.2;
        let s2 = 40000;
        let premium = 5;
        let lockedInValueQC = -s2;
        let cashCC = 0.01;
        let posBC = -1;
        await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(s2));
        await manager.setGenericPriceData(perpetualId, "currentPremiumEMA", floatToABK64x64(premium));
        await manager.setMarginAccount(perpetualId, manager.address, 
            floatToABK64x64(lockedInValueQC), 
            floatToABK64x64(cashCC), 
            floatToABK64x64(posBC));
        await setAMMLPDFCash(AMMCash, PnLparticipantCash, DFCash);

        let gap = await queryMarginGap(false);
        await manager.equalizeAMMMargin(perpetualId);
        let gapAfter = await queryMarginGap(false);       
        let mgn = await manager.getAvailableMargin(perpetualId, manager.address, true);
        let isSafe = mgn>=0;
        if(!isSafe) {
            console.log("gap before rebalance = ", gap);
            console.log("gap after rebalance = ", gapAfter);
        }
        expect(isSafe).to.be.true;

    });

    


});


