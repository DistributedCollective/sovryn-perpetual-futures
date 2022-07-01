import { expect, use, util } from "chai";
const { ethers } = require("hardhat");
import { waffleChai } from "@ethereum-waffle/chai";
import { toWei, createContract, getAccounts } from "../scripts/utils/utils";
import { getBTCBaseParams, createLiquidityPool, createPerpetual, createPerpetualManager } from "./TestFactory";
import {
    equalForPrecision,
    floatToABK64x64,
    ABK64x64ToFloat,
    probDefNoQuanto,
    equalForPrecisionFloat,
    probDefQuanto,
    calcPerpPrice,
    getDFTargetSize,
    cdfNormalStd,
    getDepositAmountForLvgPosition,
    getDepositAmountForLvgTrade,
    COLLATERAL_CURRENCY_QUANTO,
} from "../scripts/utils/perpMath";
import fs from "fs";
import { BigNumber } from "@ethersproject/bignumber";

import { isPositiveDependencies } from "mathjs";


const ONE_64x64 = ethers.BigNumber.from("0x10000000000000000");

describe("AMMPerp", () => {
    const TRANSACTION_GAS_COST = 21000;
    const tenTo7 = ethers.BigNumber.from("10000000");
    const tenTo8 = ethers.BigNumber.from("100000000");
    const tenTo11 = ethers.BigNumber.from("100000000000");
    const tenTo13 = ethers.BigNumber.from("10000000000000");
    const tenTo16 = ethers.BigNumber.from("10000000000000000");
    const tenTo17 = ethers.BigNumber.from("100000000000000000");
    const tenTo18 = ethers.BigNumber.from("10000000000000000000");
    const tenTo19 = ethers.BigNumber.from("10000000000000000000");

    let keys = [];
    let values = [];

    let mycontractMock;
    before(async () => {
        mycontractMock = await createContract("MockAMMPerp");
    });

    describe("ema", () => {
        it("should fail if lambda>1", async () => {
            await expect(mycontractMock.ema(1, 2, ONE_64x64)).to.be.revertedWith("EMALambda must be st 1");
        });
        it("should fail if lambda<0", async () => {
            await expect(mycontractMock.ema(ONE_64x64, 0, -3)).to.be.revertedWith("EMALambda must be gt 0");
        });
        it("Checking 2 * lambda + 4 * (1-lambda) with lambda = 0.25 (=0.5+3)", async () => {
            const res_required = ONE_64x64.mul(ethers.BigNumber.from("35")).div(ethers.BigNumber.from("10"));
            const result = ethers.BigNumber.from(
                String(
                    await mycontractMock.ema(
                        ethers.BigNumber.from("0x20000000000000000"), //2
                        ethers.BigNumber.from("0x40000000000000000"), //4
                        ONE_64x64.div(ethers.BigNumber.from("4"))
                    )
                )
            );
            expect(result).equal(res_required);
        });
    });

    describe("distance to default", () => {
       
        it("Quanto", async () => {
            let L1vec = [-47000, 10000];
            let K2vec = [-1, 1, -1+0.00001, 1+0.00001];
            let S2vec = [50000, 20000];
            let S3 = 4000;
            let M2 = 0;
            let M3 = 20;
            let M1 = 0;
            let sig2 = 0.05;
            let sig3 = 0.08;
            let rho = 0.4;
            let r = 0;

            for(var j = 0; j<L1vec.length; j++) {
                
                let L1 = L1vec[j];
                let S2 = S2vec[j];
                for(var jj = 0; jj<K2vec.length; jj++) {
                    let K2 = K2vec[jj];
                    let resExpected = probDefQuanto(K2, L1, S2, S3, sig2, sig3, rho, r, M1, M2, M3);
                    let res = await mycontractMock.mockCalculateRiskNeutralDDWithQuanto(floatToABK64x64(S2),
                                                                                floatToABK64x64(S3),
                                                                                floatToABK64x64(L1),
                                                                                floatToABK64x64(M1),
                                                                                floatToABK64x64(M2),
                                                                                floatToABK64x64(M3),
                                                                                floatToABK64x64(sig2),
                                                                                floatToABK64x64(sig3),
                                                                                floatToABK64x64(rho),
                                                                                floatToABK64x64(K2));
                    let resRec = ABK64x64ToFloat(res);
                    let isEqual = equalForPrecisionFloat(cdfNormalStd(resExpected[1]), cdfNormalStd(resRec), 12);
                    if(!isEqual){
                        console.log("K2 = ", K2, " L1=", L1, " S2=", S2, " M3=", M3);
                        console.log("DD received = ", ABK64x64ToFloat(res));
                        console.log("DD expected = ", resExpected[1]);
                    }
                    expect(isEqual).to.be.true;
                }
            }
            
        });

    });
    describe("default probability", () => {
        /*
        //Setting that can be replicated in PricingBenchmark.py
        K2=0.4
        L1=0.4*36000
        s2=38000
        s3=2000
        sig2=0.05
        sig3=0.07
        rho = 0.5
        M1 = 10
        M2 = 0.06
        M3 = 0.04
        r = 0
        k2=0
        -> q1= 0.013624986789704363
        -> q2= 0.007357434523271866
        */
        let K2 = ethers.BigNumber.from(4).mul(ONE_64x64).div(ethers.BigNumber.from(10));
        let L1 = K2.mul(ethers.BigNumber.from(36000));
        let S2 = ONE_64x64.mul(ethers.BigNumber.from(38000));
        let S3 = ONE_64x64.mul(ethers.BigNumber.from(2000));
        let M1 = ethers.BigNumber.from(10).mul(ONE_64x64);
        let M2 = ethers.BigNumber.from(6).mul(ONE_64x64).div(ethers.BigNumber.from(100));
        let M3 = ethers.BigNumber.from(4).mul(ONE_64x64).div(ethers.BigNumber.from(100));
        let Zero = ethers.BigNumber.from(0);
        let sig2 = ethers.BigNumber.from(5).mul(ONE_64x64).div(ethers.BigNumber.from(100));
        let sig3 = ethers.BigNumber.from(7).mul(ONE_64x64).div(ethers.BigNumber.from(100));
        let rho23 = ethers.BigNumber.from(5).mul(ONE_64x64).div(ethers.BigNumber.from(10));

        it("PD2: Standard Dev of Quanto", async () => {
            let contractRes = await mycontractMock.mockCalculateStandardDeviationQuanto(S2, S3, L1, M1, M2, M3, sig2, sig3, rho23, K2);
            const sig = ethers.BigNumber.from(String(contractRes[0]));
            const varBin = ethers.BigNumber.from(String(contractRes[1]));
            const varC3in = ethers.BigNumber.from(String(contractRes[2]));
            // result should be sig_z=8.0452698611354
            // C3=-161.50000000000002842

            const sig_low = ONE_64x64.mul(ethers.BigNumber.from("80452698611352")).div(tenTo13);
            const sig_up = ONE_64x64.mul(ethers.BigNumber.from("80452698611355")).div(tenTo13);
            const isRequiredGT = sig.gt(sig_low);
            const isRequiredLT = sig.lt(sig_up);
            const C3 = -ONE_64x64.mul(ethers.BigNumber.from("16150000000000002842")).div(tenTo17);

            const varB = ONE_64x64.mul(ethers.BigNumber.from("35030642872402318")).div(tenTo19);
            if (!isRequiredGT || !isRequiredLT) {
                //more granular debugging:
                console.log("C3 should be =");
                console.log(C3);
                console.log("C3 is =");
                console.log(varC3in.toString());
                console.log("VarB should be =");
                console.log(varB.toString());
                console.log("VarB is =");
                console.log(varBin.toString());
                console.log("sig between=");
                console.log(sig_low.toString());
                console.log(sig_up.toString());
                console.log("sig received=");
                console.log(sig.toString());
            }
            expect(isRequiredGT).true;
            expect(isRequiredLT).true;
        });

        it("PD3: DD(params) non-quanto between floor(dd1,14) and ceil(dd1,14)", async () => {
            // non-quanto
            let dd1 = ethers.BigNumber.from(String(await mycontractMock.mockCalculateRiskNeutralDDNoQuanto(S2, S3, L1, M1, M2, Zero, sig2, sig3, rho23, K2)));
            //q1 = 0.0136249867897
            //dd1lower= -2.20791823314
            //dd1upper= -2.20791823312
            let res1_requiredLowerDD = ethers.BigNumber.from("-220791823314").mul(ONE_64x64).div(tenTo11);
            let res1_requiredUpperDD = ethers.BigNumber.from("-220791823312").mul(ONE_64x64).div(tenTo11);
            let isRequiredGT = dd1.gt(res1_requiredLowerDD);
            let isRequiredLT = dd1.lt(res1_requiredUpperDD);
            if (!isRequiredLT || !isRequiredGT) {
                console.log("DD1 between=");
                console.log(res1_requiredLowerDD.toString());
                console.log(res1_requiredUpperDD.toString());
                console.log("DD1 received=");
                console.log(dd1.toString());
            }
            expect(isRequiredLT).true;
            expect(isRequiredGT).true;
        });

        it("PD4: DD(params) quanto between floor(q2,18) and ceil(q1,18)", async () => {
            let dd2 = ethers.BigNumber.from(String(await mycontractMock.mockCalculateRiskNeutralDDWithQuanto(S2, S3, L1, M1, M2, M3, sig2, sig3, rho23, K2)));
            //dd2=-2.4393215316248247
            //q2lower= 0.007357434523271865
            //q2upper= 0.007357434523271867
            const res2_requiredLower = ethers.BigNumber.from("-243932153163").mul(ONE_64x64).div(tenTo11);
            const res2_requiredUpper = ethers.BigNumber.from("-243932153161").mul(ONE_64x64).div(tenTo11);
            let isRequiredGT = dd2.gt(res2_requiredLower);
            let isRequiredLT = dd2.lt(res2_requiredUpper);
            if (!isRequiredLT || !isRequiredGT) {
                console.log("DD2 between=");
                console.log(res2_requiredLower.toString());
                console.log(res2_requiredUpper.toString());
                console.log("DD2 received=");
                console.log(dd2.toString());
            }
            expect(isRequiredGT).true;
            expect(isRequiredLT).true;
        });

        it("PD5: Default probability (non-quanto)", async () => {
            let K2 = 0.4;
            let L1 = 0.4 * 36000;
            let S2 = 38000;
            let S3 = 2000;
            let sig2 = 0.05;
            let sig3 = 0.07;
            let rho23 = 0.5;
            let M1 = 10;
            let M2 = 0.06;
            //let M3 = 0.04;
            let r = 0;

            let pd = await mycontractMock.mockCalculateRiskNeutralPD(
                floatToABK64x64(S2),
                floatToABK64x64(S3),
                floatToABK64x64(L1),
                floatToABK64x64(M1),
                floatToABK64x64(M2),
                floatToABK64x64(Zero),
                floatToABK64x64(sig2),
                floatToABK64x64(sig3),
                floatToABK64x64(rho23),
                floatToABK64x64(K2),
                0
            );
            let pdExpected = probDefNoQuanto(K2, L1, S2, sig2, r, M1, M2);
            let pdFlt = ABK64x64ToFloat(pd);
            let isEqual = equalForPrecisionFloat(pdFlt, pdExpected[0], 7);
            if (!isEqual) {
                console.log("Expected=", pdFlt);
                console.log("Received pd=", pdExpected[0], " dd=", pdExpected[1]);
            }
            expect(isEqual).to.be.true;
        });

        it("PD5: Default probability (non-quanto), when last trader exits", async () => {
            let K2 = 1/ 2 ** 10;
            let k = -K2; // last closing trade
            let kNoise = 0;
            k += kNoise;
            let L1 = 10 // 8.862789; // some realistic small number
            let S2 = L1 / K2 - 0.01; // small trader pnl
            let S3 = S2; // not used
            let sig2 = 0.1;
            let sig3 = 0.1; // not used
            let rho23 = 1; // not used
            let M1 = 0;
            let M2 = 1;
            let M3 = 0;
            let r = 0;

            let pd = await mycontractMock.mockCalculateRiskNeutralPD(
                floatToABK64x64(S2),
                floatToABK64x64(S3),
                floatToABK64x64(L1),
                floatToABK64x64(M1),
                floatToABK64x64(M2),
                floatToABK64x64(M3),
                floatToABK64x64(sig2),
                floatToABK64x64(sig3),
                floatToABK64x64(rho23),
                floatToABK64x64(K2),
                floatToABK64x64(k)
            );
            let pdExpected = probDefNoQuanto(K2+k, L1+k*S2, S2, sig2, r, M1, M2);
            let pdFlt = ABK64x64ToFloat(pd);
            let isEqual = equalForPrecisionFloat(pdFlt, pdExpected[0], 7);
            if (!isEqual || true) {
                console.log("Expected=", pdFlt);
                console.log("Received pd=", pdExpected[0], " dd=", pdExpected[1]);
            }
            expect(isEqual).to.be.true;
        });

        it("PD5: Default probability (quanto)", async () => {
            let KVec2 = [0, -0.1, 0.2, 0.3, 0.4, 0.45];
            let L1 = 0.4 * 36000;
            let S2 = 38000;
            let S3 = 2000;
            let sig2 = 0.05;
            let sig3 = 0.07;
            let rho23 = 0.5;
            let M1 = 10;
            let M2 = 0.06;
            let M3 = 0.2;
            let r = 0;
            for(var j=0; j < KVec2.length; j++) {
                let K2 = KVec2[j];
                let pd = await mycontractMock.mockCalculateRiskNeutralPD(
                    floatToABK64x64(S2),
                    floatToABK64x64(S3),
                    floatToABK64x64(L1),
                    floatToABK64x64(M1),
                    floatToABK64x64(M2),
                    floatToABK64x64(M3),
                    floatToABK64x64(sig2),
                    floatToABK64x64(sig3),
                    floatToABK64x64(rho23),
                    floatToABK64x64(K2),
                    0
                );
                let res = probDefQuanto(K2, L1, S2, S3, sig2, sig3, rho23, r, M1, M2, M3);
                let pdFlt = ABK64x64ToFloat(pd);
                let isEqual = equalForPrecisionFloat(pdFlt, res[0], 6);
                if (!isEqual) {
                    console.log("quanto pd:")
                    console.log("Expected=", pdFlt);
                    console.log("Received pd=", res[0], " dd=", res[1]);
                }
                expect(isEqual).to.be.true;
            }
        });

        it("PD5: Default probability (quanto Test 2)", async () => {
            let K2 = 0.4;
            let L1 = 0.4 * 36000;
            let S2 = 38000;
            let S3 = 2000;
            let sig2 = 0.05;
            let sig3 = 0.07;
            let rho23 = 0.5;
            let M1 = 10;
            let M2 = 0.06;
            let M3 = 0.02;
            let r = 0;
            const k = 0.2;
            let pd = await mycontractMock.mockCalculateRiskNeutralPD(
                floatToABK64x64(S2),
                floatToABK64x64(S3),
                floatToABK64x64(L1+k*S2),
                floatToABK64x64(M1),
                floatToABK64x64(M2),
                floatToABK64x64(M3),
                floatToABK64x64(sig2),
                floatToABK64x64(sig3),
                floatToABK64x64(rho23),
                floatToABK64x64(K2+k),
                0
            );
            let pd2 = await mycontractMock.mockCalculateRiskNeutralPD(
                floatToABK64x64(S2),
                floatToABK64x64(S3),
                floatToABK64x64(L1),
                floatToABK64x64(M1),
                floatToABK64x64(M2),
                floatToABK64x64(M3),
                floatToABK64x64(sig2),
                floatToABK64x64(sig3),
                floatToABK64x64(rho23),
                floatToABK64x64(K2),
                floatToABK64x64(k)
            );
            let res = probDefQuanto(K2+k, L1+k*S2, S2, S3, sig2, sig3, rho23, r, M1, M2, M3);
            let pdFlt = ABK64x64ToFloat(pd);
            let pdFlt2 = ABK64x64ToFloat(pd2);
            let isEqual = equalForPrecisionFloat(pdFlt, res[0], 6);
            if (!isEqual) {
                console.log("quanto pd test2:")
                console.log("Received method 1=", pdFlt);
                console.log("Received method 2=", pdFlt2);
                console.log("Expected pd=", res[0], " dd=", res[1]);
            }
            expect(isEqual).to.be.true;
        });
        
        it("AMM Price 1", async () => {
            let K2 = 0.4;
            let L1 = 0.4 * 36000;
            let S2 = 38000;
            let S3 = 2000;
            let sig2 = 0.05;
            let sig3 = 0.07;
            let rho23 = 0.5;
            let M1 = 10;
            let M2 = 0.06;
            let M3 = 0;
            let r = 0;
            const minSpread = 0.02;
            const k = 0.1;
            let px = await mycontractMock.mockCalculatePerpetualPrice(
                floatToABK64x64(S2),
                floatToABK64x64(S3),
                floatToABK64x64(L1),
                floatToABK64x64(M1),
                floatToABK64x64(M2),
                floatToABK64x64(M3),
                floatToABK64x64(sig2),
                floatToABK64x64(sig3),
                floatToABK64x64(rho23),
                floatToABK64x64(K2),
                floatToABK64x64(minSpread),
                floatToABK64x64(k)
            );
            let pxExpected = calcPerpPrice(K2, k, L1, S2, S3, sig2, sig3, rho23, r, M1, M2, M3, minSpread);
            let resQ = probDefNoQuanto(K2, L1, S2, sig2, r, M1, M2);
            let pxFloat = ABK64x64ToFloat(px);
            let isEqual = equalForPrecisionFloat(pxFloat, pxExpected, 1, false);
            if (!isEqual) {
                console.log("AMM PX expected=", pxExpected);
                console.log("AMM PX received=", pxFloat);
            }
            /*
            Notes on accurracy: only 1 decimal place due to CDF table inaccurracy
            sgnm*q   =                           0.04160957189402964
            contract = 41609612799289535*1e-18 = 0.041609612799289535
            (error from cdf-table)
            JS : s2*(1+sgnm*q+minspread) = s2*(1+0.04160957189402964+0.02+0.00045960526315789476)
                                                   = 40358.62873197313
                                    contract       = s2*(1+0.041609612799289535+0.02+0.00045960526315....)
                                                   = 40358.630286373
            */

            expect(isEqual).true;
        });
        it("AMM Price 2 (quanto)", async () => {
            let K2 = 0.4;
            let L1 = 0.4 * 36000;
            let S2 = 38000;
            let S3 = 2000;
            let sig2 = 0.05;
            let sig3 = 0.07;
            let rho23 = 0.5;
            let M1 = 10;
            let M2 = 0.06;
            let M3 = 0.02;
            let r = 0;
            // minSpread 1bps
            const minSpread = 0.02;
            const k = 0.2;
            let px = await mycontractMock.mockCalculatePerpetualPrice(
                floatToABK64x64(S2),
                floatToABK64x64(S3),
                floatToABK64x64(L1),
                floatToABK64x64(M1),
                floatToABK64x64(M2),
                floatToABK64x64(M3),
                floatToABK64x64(sig2),
                floatToABK64x64(sig3),
                floatToABK64x64(rho23),
                floatToABK64x64(K2),
                floatToABK64x64(minSpread),
                floatToABK64x64(k)
            );
            let pxExpected = calcPerpPrice(K2, k, L1, S2, S3, sig2, sig3, rho23, r, M1, M2, M3, minSpread);
            let pxFloat = ABK64x64ToFloat(px);
            let isEqual = equalForPrecision(px, floatToABK64x64(pxExpected), 2, false);
            if (!isEqual) {
                console.log("AMM Price 2 (quanto)");
                console.log("AMM 2 PX expected=", pxExpected);
                console.log("AMM 2 PX received=", pxFloat);
            }
            expect(isEqual).true;
            /*
            contract:
                q = 0.067806713265424882
                minspread = 0.019999999999999999
                38000*(1+0.067806713265424882+0.019999999999999999+0)=41336.65510408615
            JS:
                q=0.06780665294752997
                minspread = 0.02
                38000*(1+0.06780665294752997+0.02+0)=41336.652812006134
            */
        });

        it("AMM Price: min spread", async () => {
            // minSpread 5%
            let K2 = 0.4;
            let L1 = 0.4 * 36000;
            let S2 = 38000;
            let S3 = 2000;
            let sig2 = 0.05;
            let sig3 = 0.07;
            let rho23 = 0.5;
            let M1 = 10;
            let M2 = 0.06;
            let M3 = 0.02;
            let r = 0;
            const minSpread = 0.05;
            const k = 0.01;
            let px = await mycontractMock.mockCalculatePerpetualPrice(
                floatToABK64x64(S2),
                floatToABK64x64(S3),
                floatToABK64x64(L1),
                floatToABK64x64(M1),
                floatToABK64x64(M2),
                floatToABK64x64(M3),
                floatToABK64x64(sig2),
                floatToABK64x64(sig3),
                floatToABK64x64(rho23),
                floatToABK64x64(K2),
                floatToABK64x64(minSpread),
                floatToABK64x64(k)
            );
            let pxExpected = calcPerpPrice(K2, k, L1, S2, S3, sig2, sig3, rho23, r, M1, M2, M3, minSpread);
            let pxFloat = ABK64x64ToFloat(px);
            let isEqual = equalForPrecision(px, floatToABK64x64(pxExpected), 3, false);
            if (!isEqual) {
                console.log("AMM (min Spread) PX expected=", pxExpected);
                console.log("AMM (min Spread) PX received=", pxFloat);
            }
            expect(isEqual).true;
        });

        it("AMM Price: spread", async () => {
            // choose rho=r=0 so that kstar = M2-K2 and |kStar| > 0.5
            let K2 = 2.0;
            let L1 = K2 * 36000;
            let S2 = 38000;
            let S3 = 40000;
            let sig2 = 0.05;
            let sig3 = 0.05;
            let rho23 = 0.0;
            let M1 = 0.0;
            let M2 = 0.0;
            let M3 = 10.0;
            let r = 0.0;
            const minSpread = 0.0005;
            let kStar = M2 - K2;
            let kAbove = kStar + 0.1;
            let kBelow = kStar - 0.1;
            let pxAbove = await mycontractMock.mockCalculatePerpetualPrice(
                floatToABK64x64(S2),
                floatToABK64x64(S3),
                floatToABK64x64(L1),
                floatToABK64x64(M1),
                floatToABK64x64(M2),
                floatToABK64x64(M3),
                floatToABK64x64(sig2),
                floatToABK64x64(sig3),
                floatToABK64x64(rho23),
                floatToABK64x64(K2),
                floatToABK64x64(minSpread),
                floatToABK64x64(kAbove)
            );
            let pxAt = await mycontractMock.mockCalculatePerpetualPrice(
                floatToABK64x64(S2),
                floatToABK64x64(S3),
                floatToABK64x64(L1),
                floatToABK64x64(M1),
                floatToABK64x64(M2),
                floatToABK64x64(M3),
                floatToABK64x64(sig2),
                floatToABK64x64(sig3),
                floatToABK64x64(rho23),
                floatToABK64x64(K2),
                floatToABK64x64(minSpread),
                floatToABK64x64(kStar)
            );
            let pxBelow = await mycontractMock.mockCalculatePerpetualPrice(
                floatToABK64x64(S2),
                floatToABK64x64(S3),
                floatToABK64x64(L1),
                floatToABK64x64(M1),
                floatToABK64x64(M2),
                floatToABK64x64(M3),
                floatToABK64x64(sig2),
                floatToABK64x64(sig3),
                floatToABK64x64(rho23),
                floatToABK64x64(K2),
                floatToABK64x64(minSpread),
                floatToABK64x64(kBelow)
            );
            let pxAboveFloat = ABK64x64ToFloat(pxAbove);
            let pxAtFloat = ABK64x64ToFloat(pxAt);
            let pxBelowFloat = ABK64x64ToFloat(pxBelow);
            // for long (short) trades, lower (higher) price is better
            let isAtBetterThanAbove = kStar < 0 ? pxAtFloat >= pxAboveFloat : pxAtFloat <= pxAboveFloat;
            let isAtBetterThanBelow = kStar < 0 ? pxAtFloat >= pxBelowFloat : pxAtFloat <= pxBelowFloat;
            if (!isAtBetterThanAbove) {
                console.log("AMM PX at k star (", kStar, "): ", pxAtFloat)
                console.log("Not better than above k star (",  kAbove, "):", pxAboveFloat);
            }
            if (!isAtBetterThanBelow) {
                console.log("AMM PX at k star: ", pxAtFloat)
                console.log("Not better than below k star (",  kBelow, "):", pxBelowFloat);
            }
            expect(isAtBetterThanAbove || isAtBetterThanBelow).true;
        });
    });

    describe("target Default fund size DF1, DF2, DF3", () => {
        let K2 = [-0.7, 0.8];
        let k2_trader = 0.11;
        let cover_n_rate = 0.05;
        let num_trade_accounts = 100;
        let cover_n = num_trade_accounts*cover_n_rate;
        let fStressRet2 = [-0.3, -0.2];
        let fStressRet3 = [-0.32, 0.18];
        let S2 = 2000;
        let S3 = 31000;
        let fK2AMM = [floatToABK64x64(K2[0]), floatToABK64x64(K2[1])];
        let fk2Trader = floatToABK64x64(k2_trader);
        let fCoverN = floatToABK64x64(cover_n);
        let fStressRet2abk = [floatToABK64x64(fStressRet2[0]), floatToABK64x64(fStressRet2[1])];
        let fStressRet3abk = [floatToABK64x64(fStressRet3[0]), floatToABK64x64(fStressRet3[1])];
        let fidxPx = [floatToABK64x64(S2), floatToABK64x64(S3)];

        // 256.8271994, 0.10513616321477055, 0.0069200035223858465
        let Iexpected = [
            getDFTargetSize(K2, k2_trader, fStressRet2, fStressRet3, cover_n, S2, S3, 0),
            getDFTargetSize(K2, k2_trader, fStressRet2, fStressRet3, cover_n, S2, S3, 1),
            getDFTargetSize(K2, k2_trader, fStressRet2, fStressRet3, cover_n, S2, S3, 2),
        ];
        for (let ccy_idx = 1; ccy_idx < 4; ccy_idx++) {
            it("Default Fund Size DF" + ccy_idx, async () => {
                let Istar = ethers.BigNumber.from(
                    String(await mycontractMock.mockCalculateDefaultFundSize(fK2AMM, fk2Trader, fCoverN, fStressRet2abk, fStressRet3abk, fidxPx, ccy_idx))
                );

                let isEqual = equalForPrecisionFloat(ABK64x64ToFloat(Istar), Iexpected[ccy_idx - 1], 12);
                if (!isEqual) {
                    console.log("Istar1 obtained=", ABK64x64ToFloat(Istar));
                    console.log("Istar1 expected=", Iexpected[ccy_idx - 1].toString());
                }
                expect(isEqual).true;
            });
        }
    });

    describe("target AMM fund size M1, M2, M3", () => {
        // setting
        // target dd -2.9677379253417833 or 15bps
        let targetDD = ethers.BigNumber.from("-29677379253417833").mul(ONE_64x64).div(tenTo16);
        let K2 = ONE_64x64;
        let S2 = ethers.BigNumber.from("36000").mul(ONE_64x64);
        let L1 = ethers.BigNumber.from("-36000").mul(ONE_64x64);
        let sigma2 = ethers.BigNumber.from("5").mul(ONE_64x64).div(100); //5%
        // additional setting for quanto (M3)
        let S3 = ethers.BigNumber.from("2000").mul(ONE_64x64);
        let sigma3 = ethers.BigNumber.from("7").mul(ONE_64x64).div(100); //7%
        let rho = ethers.BigNumber.from("5").mul(ONE_64x64).div(10); //50%

        it("Fund M1", async () => {
            let M1res = ethers.BigNumber.from(String(await mycontractMock.mockGetTargetCollateralM1(K2, S2, L1, sigma2, targetDD)));
            // M1star =  77706.45173584708
            const M1starExpected = ethers.BigNumber.from(String("7770645")).mul(ONE_64x64).div(100);
            let isEqual = equalForPrecision(M1res, M1starExpected, 2);

            if (!isEqual) {
                console.log("M1=");
                console.log(M1starExpected.toString());
                console.log("M1 received=");
                console.log(M1res.toString());
            }
            expect(isEqual).true;
        });
        it("Fund M2", async () => {
            let M2res = ethers.BigNumber.from(String(await mycontractMock.mockGetTargetCollateralM2(K2, S2, L1, sigma2, targetDD)));
            // M2star =   2.161412452959079
            const M2starExpected = ethers.BigNumber.from(String("216141245")).mul(ONE_64x64).div(100000000);
            let isEqual = equalForPrecision(M2res, M2starExpected, 6);

            if (!isEqual) {
                console.log("M2 expected=");
                console.log(M2starExpected.toString());
                console.log("M2 received=");
                console.log(M2res.toString());
            }
            expect(isEqual).true;
        });
        it("Fund M3", async () => {
            let M3res = ethers.BigNumber.from(String(await mycontractMock.mockGetTargetCollateralM3(K2, S2, S3, L1, sigma2, sigma3, rho, targetDD)));
            const M3starExpected = floatToABK64x64(44.1905);
            let isEqual = equalForPrecision(M3res, M3starExpected, 4);
            if (!isEqual) {
                console.log("test=", ABK64x64ToFloat(floatToABK64x64(10 ** -4)));
                console.log("M3 expected=");
                console.log(M3starExpected.toString());
                console.log(ABK64x64ToFloat(M3starExpected));
                console.log("M3 received=");
                console.log(M3res.toString());
                console.log(ABK64x64ToFloat(M3res));
                equalForPrecision(M3res, M3starExpected, 4, true);
            }
            expect(isEqual).true;
        });
    });

    describe("target AMM fund size M1, M2, M3", () => {
        it("getDepositAmountForLvgPosition", async () => {
            let posVec = [-1, 1];
            let leverageVec = [2, 10, 8];
            let price = 46500;
            let S2Mark = 47000;
            let S2 = 46000;
            let S3vec = [S2, 1, 4000];
            let totalFeeRate = 0;
            for(var kkk = 0; kkk<leverageVec.length; kkk++) {
                let leverage = leverageVec[kkk];
                for(var kk = 0; kk < S3vec.length; kk++) {
                    let S3 = S3vec[kk];
                    for(var k = 0; k < posVec.length; k++) {
                        let pos = posVec[k];
                        let fDepositAmount = await mycontractMock.getDepositAmountForLvgPosition(
                            floatToABK64x64(0),//existing position
                            floatToABK64x64(0),//margin balance
                            floatToABK64x64(pos),
                            floatToABK64x64(leverage),
                            floatToABK64x64(price),
                            floatToABK64x64(S2Mark),
                            floatToABK64x64(S3));
                        let depExpected = getDepositAmountForLvgPosition(pos, leverage, price, S2, S3, S2Mark, totalFeeRate);
                        // check calculation
                        let blnc = pos*(S2Mark - price)/S3 + depExpected - Math.abs(pos)*totalFeeRate*S2/S3;
                        let lvg = Math.abs(pos)*S2Mark/S3/blnc;
                        let isEqual = equalForPrecisionFloat(ABK64x64ToFloat(fDepositAmount), depExpected, 15);
                        if (!isEqual) {
                            console.log("resulting lvg = ", lvg);
                            console.log("deposit amount received = ", ABK64x64ToFloat(fDepositAmount));
                            console.log("deposit amount expected = ", depExpected);
                        }
                        expect(isEqual).true;
                    }
                }
            }
        });
        it("getDepositAmountForLvgPosition - existing pos", async () => {
            let tradeVec = [-1, 1];
            let initialPosVec = [-1.1, -0.5, 0, 0.5, 1.1];
            let leverageVec = [2, 10, 8];
            let price = 46500;
            let S2Mark = 47000;
            let S2 = 46000;
            let S3vec = [S2, 1, 4000];
            let totalFeeRate = 0;
            
            for(var kkkk = 0; kkkk<initialPosVec.length; kkkk++) {
                let pos0 = initialPosVec[kkkk];
                let mc0 = 0.15;
                let lockedIn0 = pos0*(S2*0.99);
                for(var kkk = 0; kkk<leverageVec.length; kkk++) {
                    let leverage = leverageVec[kkk];
                    for(var kk = 0; kk < S3vec.length; kk++) {
                        let S3 = S3vec[kk];
                        for(var k = 0; k < tradeVec.length; k++) {
                            let dPos = tradeVec[k];
                            let b0 = (pos0 * S2Mark - lockedIn0)/S3 + mc0;
                            let fDepositAmount = await mycontractMock.getDepositAmountForLvgPosition(
                                floatToABK64x64(pos0),//existing position
                                floatToABK64x64(b0),//margin balance
                                floatToABK64x64(dPos),
                                floatToABK64x64(leverage),
                                floatToABK64x64(price),
                                floatToABK64x64(S2Mark),
                                floatToABK64x64(S3));
                            let depExpected = getDepositAmountForLvgTrade(pos0, b0, dPos, leverage, price, S3, S2Mark) 
                            // check calculation
                            let newpos = dPos + pos0;
                            let newLockedIn = lockedIn0 + dPos * price;
                            let blnc = (newpos * S2Mark - newLockedIn)/S3 + mc0 + depExpected;
                            let lvg = Math.abs(newpos)*S2Mark/S3/blnc;
                            let isEqual = equalForPrecisionFloat(ABK64x64ToFloat(fDepositAmount), depExpected, 12);
                            let isEqual2 = equalForPrecisionFloat(lvg, leverage, 12);
                            if (!isEqual || !isEqual2) {
                                console.log("pos0 = ", pos0)
                                console.log("target lvg = ", leverage)
                                console.log("resulting lvg = ", lvg);
                                console.log("deposit amount received = ", ABK64x64ToFloat(fDepositAmount));
                                console.log("deposit amount expected = ", depExpected);
                            }
                            expect(isEqual).true;
                        }
                    }
                }
            }
            
            
        });
        
    });
    
});
