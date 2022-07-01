import { expect, use, util } from "chai";
const { ethers } = require("hardhat");
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
    calculateLiquidationPriceCollateralBase,
    calculateLiquidationPriceCollateralQuote,
    calculateLiquidationPriceCollateralQuanto,
    roundToLot,
    COLLATERAL_CURRENCY_BASE,
    COLLATERAL_CURRENCY_QUANTO,
    COLLATERAL_CURRENCY_QUOTE,
    getTradeAmountFromPrice,
    getPricesAndTradesForPercentRage,
} from "../scripts/utils/perpMath";
import exp = require("constants");

const BN = ethers.BigNumber;

const ONE_DEC18 = BN.from(10).pow(BN.from(18));
const DOT_ONE_DEC18 = BN.from(10).pow(BN.from(17));
const DOT_ONE_18_DEC18 = BN.from(1);

const ONE_64x64 = BN.from("0x010000000000000000");
const DOT_ONE_64x64 = ONE_64x64.div(10);
const DOT_ONE_DEC18_64x64 = BN.from("0x0000000000000001");
const DOT_ZERO_ONE_64x64 = ONE_64x64.div(100);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("PerpMath", () => {
    describe("floatToABK64x64", () => {
        it("convert 1", async () => {
            let value = floatToABK64x64(1);
            expect(value).equal(ONE_64x64);
        });

        it("convert 1.1", async () => {
            let value = floatToABK64x64(1.1);

            let expectedValue = ONE_64x64.add(DOT_ONE_64x64);
            let isEqual = equalForPrecision(value, expectedValue, 16, false);
            expect(isEqual).to.be.true;
        });

        it("convert 1.000000000000000001", async () => {
            let value = floatToABK64x64(1.000000000000000001);
            let expectedValue = ONE_64x64.add(DOT_ONE_DEC18_64x64);
            let isEqual = equalForPrecision(value, expectedValue, 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert 12345", async () => {
            let value = floatToABK64x64(12345);
            expect(value).equal(ONE_64x64.mul(12345));
        });

        it("convert - 0.03", async () => {
            let value = floatToABK64x64(-0.03);
            let expectedValue = DOT_ZERO_ONE_64x64.mul(-3);
            let isEqual = equalForPrecision(value, expectedValue, 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert -1.000000000000000001", async () => {
            let value = floatToABK64x64(-1.000000000000000001);
            let expectedValue = ONE_64x64.add(DOT_ONE_DEC18_64x64).mul(-1);
            let isEqual = equalForPrecision(value, expectedValue, 17, false);
            expect(isEqual).to.be.true;
        });
    });

    describe("ABK64x64ToFloat", () => {
        it("convert 1", async () => {
            let value = ABK64x64ToFloat(ONE_64x64);
            expect(value).equal(1);
        });

        it("convert 1.1", async () => {
            let value = ABK64x64ToFloat(ONE_64x64.add(DOT_ONE_64x64));
            expect(value).equal(1.1);
        });

        it("convert 1.000000000000000001", async () => {
            let value = ABK64x64ToFloat(ONE_64x64.add(DOT_ONE_DEC18_64x64));
            expect(value).equal(1.000000000000000001);
        });

        it("convert 12345", async () => {
            let value = ABK64x64ToFloat(ONE_64x64.mul(12345));
            expect(value).equal(12345);
        });
    });

    describe("fromDec18", () => {
        it("convert 1", async () => {
            let value = fromDec18(ONE_DEC18);
            expect(value).equal(ONE_64x64);
        });

        it("convert 1.1", async () => {
            let inputValue = ONE_DEC18.add(DOT_ONE_DEC18);
            let outputValue = fromDec18(inputValue);

            expect(outputValue).equal(ONE_64x64.add(DOT_ONE_64x64));
        });

        it("convert 1.000000000000000001", async () => {
            let inputValue = ONE_DEC18.add(DOT_ONE_18_DEC18);
            let outputValue = fromDec18(inputValue);

            let expectedValue = ONE_64x64.add(DOT_ONE_DEC18_64x64);
            let isEqual = equalForPrecision(outputValue, expectedValue, 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert 12345", async () => {
            let inputValue = ONE_DEC18.mul(12345);
            let outputValue = fromDec18(inputValue);

            expect(outputValue).equal(ONE_64x64.mul(12345));
        });

        it("convert -0.03", async () => {
            let inputValue = ONE_DEC18.mul(-3).div(100);
            let outputValue = fromDec18(inputValue);

            expect(outputValue).equal(DOT_ZERO_ONE_64x64.mul(-3));
        });

        it("convert -1.000000000000000001", async () => {
            let inputValue = ONE_DEC18.add(DOT_ONE_18_DEC18).mul(-1);
            let outputValue = fromDec18(inputValue);

            let expectedValue = ONE_64x64.add(DOT_ONE_DEC18_64x64).mul(-1);
            let isEqual = equalForPrecision(outputValue, expectedValue, 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert -6789", async () => {
            let inputValue = ONE_DEC18.mul(-6789);
            let outputValue = fromDec18(inputValue);

            expect(outputValue).equal(ONE_64x64.mul(-6789));
        });
    });

    describe("toDec18", () => {
        it("convert 1", async () => {
            let value = toDec18(ONE_64x64);
            expect(value).equal(ONE_DEC18);
        });

        it("convert 1.1", async () => {
            let inputValue = ONE_64x64.add(DOT_ONE_64x64);
            let outputValue = toDec18(inputValue);

            let expectedValue = ONE_DEC18.add(DOT_ONE_DEC18);
            let isEqual = equalForPrecision(outputValue, expectedValue, 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert 1.000000000000000001", async () => {
            let inputValue = ONE_64x64.add(DOT_ONE_DEC18_64x64);
            let outputValue = toDec18(inputValue);

            let expectedValue = ONE_DEC18.add(DOT_ONE_18_DEC18);
            let isEqual = equalForPrecision(outputValue, expectedValue, 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert 12345", async () => {
            let inputValue = ONE_64x64.mul(12345);
            let outputValue = toDec18(inputValue);

            expect(outputValue).equal(ONE_DEC18.mul(12345));
        });

        it("convert 0.05", async () => {
            let inputValue = DOT_ZERO_ONE_64x64.mul(5);
            let outputValue = toDec18(inputValue);

            let expectedValue = ONE_DEC18.mul(5).div(100);
            let isEqual = equalForPrecision(outputValue, expectedValue, 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert -0.03", async () => {
            let inputValue = DOT_ZERO_ONE_64x64.mul(-3);
            let outputValue = toDec18(inputValue);

            let expectedValue = ONE_DEC18.mul(-3).div(100);
            let isEqual = equalForPrecision(outputValue, expectedValue, 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert -1.000000000000000001", async () => {
            let inputValue = ONE_64x64.add(DOT_ONE_DEC18_64x64).mul(-1);
            let outputValue = toDec18(inputValue);

            let isEqual = equalForPrecision(outputValue, ONE_DEC18.add(DOT_ONE_18_DEC18).mul(-1), 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert -6789", async () => {
            let inputValue = ONE_64x64.mul(-6789);
            let outputValue = toDec18(inputValue);

            expect(outputValue).equal(ONE_DEC18.mul(-6789));
        });
    });

    describe("mul64x64", () => {
        it("0.6 * 1.232", async () => {
            let xFlt = 0.6;
            let yFlt = 1.232;
            let resExp = floatToABK64x64(xFlt * yFlt);
            let x = floatToABK64x64(xFlt);
            let y = floatToABK64x64(yFlt);
            let res = mul64x64(x, y);
            let isEqual = equalForPrecision(res, resExp, 17);
            if (!isEqual) {
                console.log("Expected=", resExp.toString());
                console.log("Received=", res.toString());
            }
            expect(isEqual).to.be.true;
        });
    });
    describe("div64x64", () => {
        it("0.6 / 1.232", async () => {
            let xFlt = 0.6;
            let yFlt = 1.232;
            let resExp = floatToABK64x64(xFlt / yFlt);
            let x = floatToABK64x64(xFlt);
            let y = floatToABK64x64(yFlt);
            let res = div64x64(x, y);
            let isEqual = equalForPrecision(res, resExp, 17);
            if (!isEqual) {
                console.log("Expected=", ABK64x64ToFloat(resExp));
                console.log("Received=", ABK64x64ToFloat(res));
            }
            expect(isEqual).to.be.true;
        });
    });
    describe("add64x64", () => {
        it("0.6 + 1.232", async () => {
            let xFlt = 0.6;
            let yFlt = 1.232;
            let resExp = floatToABK64x64(xFlt + yFlt);
            let x = floatToABK64x64(xFlt);
            let y = floatToABK64x64(yFlt);
            let res = add64x64(x, y);
            let isEqual = equalForPrecision(res, resExp, 15);
            if (!isEqual) {
                console.log("Expected=", ABK64x64ToFloat(resExp));
                console.log("Received=", ABK64x64ToFloat(res));
            }
            expect(isEqual).to.be.true;
        });
    });

    describe("fractionToABDK64x64", () => {
        it("convert 1/3", async () => {
            let nom = 1;
            let denom = 3;
            let fNumber = nom / denom;
            let bn1 = floatToABK64x64(fNumber);
            let bn2 = fractionToABDK64x64(nom, denom);

            let bn1_flt: Number = ABK64x64ToFloat(bn1);
            let bn2_flt: Number = ABK64x64ToFloat(bn2);

            let isEqual = equalForPrecision(bn2, bn1, 15);
            if (!isEqual) {
                console.log("Expected=", fNumber);
                console.log("Received=", bn2_flt);
                console.log("via float=", bn1_flt);
            }
            expect(isEqual).to.be.true;
        });
    });

    describe("AMM Functions", () => {
        it("AMM pool target size M2", async () => {
            let fAMMTargetDD = -1.88;
            let fAMMMinSizeCC = 0.25;
            let sigma2 = 0.05;
            let sigma3 = 0.07;
            let rho23 = 0.5;
            const S2 = 36000;
            const S3 = 2000;
            let K2 = 1;
            let L1 = -36000;
            let collateralCCY = COLLATERAL_CURRENCY_BASE;
            const M2expected = 2.0999338042070876;
            let M2rec = calculateAMMTargetSize(fAMMTargetDD, fAMMMinSizeCC, sigma2, sigma3, rho23, S2, S3, K2, L1, collateralCCY);
            let isEqual = equalForPrecisionFloat(M2expected, M2rec, 16);
            if (!isEqual) {
                console.log("Expected=", M2expected);
                console.log("Received=", M2rec);
            }
            expect(isEqual).to.be.true;
        });

        it("AMM pool target size M3", async () => {
            let fAMMTargetDD = -1.88;
            let fAMMMinSizeCC = 0.25;
            let sigma2 = 0.05;
            let sigma3 = 0.07;
            let rho23 = 0.5;
            const S2 = 36000;
            const S3 = 2000;
            let K2 = 1;
            let L1 = -36000;
            let collateralCCY = COLLATERAL_CURRENCY_QUANTO;
            const M3expected = 40.75618690434952;
            let Mrec = calculateAMMTargetSize(fAMMTargetDD, fAMMMinSizeCC, sigma2, sigma3, rho23, S2, S3, K2, L1, collateralCCY);
            let isEqual = equalForPrecisionFloat(M3expected, Mrec, 16);
            if (!isEqual) {
                console.log("Expected=", M3expected);
                console.log("Received=", Mrec);
            }
            expect(isEqual).to.be.true;
        });

        it("AMM pool target size M1", async () => {
            let fAMMTargetDD = -1.88;
            let fAMMMinSizeCC = 0.25;
            let sigma2 = 0.05;
            let sigma3 = 0.07;
            let rho23 = 0.5;
            const S2 = 36000;
            const S3 = 2000;
            let K2 = 1;
            let L1 = -36000;
            let collateralCCY = COLLATERAL_CURRENCY_QUOTE;
            const Mexpected = 75498.74654857512;
            let Mrec = calculateAMMTargetSize(fAMMTargetDD, fAMMMinSizeCC, sigma2, sigma3, rho23, S2, S3, K2, L1, collateralCCY);
            let isEqual = equalForPrecisionFloat(Mexpected, Mrec, 16);
            if (!isEqual) {
                console.log("Expected=", Mexpected);
                console.log("Received=", Mrec);
            }
            expect(isEqual).to.be.true;
        });
    });

    describe("Pricing Functions", () => {
        it("no quanto price", async () => {
            let K2 = 0.4;
            let L1 = 0.4 * 36000;
            let S2 = 38000;
            let sig2 = 0.05;
            let M1 = 10;
            let M2 = 0.06;
            let M3 = 0;
            let r = 0;
            let res = probDefNoQuanto(K2, L1, S2, sig2, r, M1, M2);
            let dd = res[1];
            let pd = res[0];
            let pdRes = 0.013624986789704379;
            //dd=-2.207918233139494
            let isEqual = equalForPrecisionFloat(pd, pdRes, 14);
            if (!isEqual) {
                console.log("Expected=", pdRes);
                console.log("Received pd=", pd, " dd=", dd);
            }
            expect(isEqual).to.be.true;
        });

        it("quanto price", async () => {
            let K2 = 0.4;
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
            // q = 0.0014113639000835527
            // pd=-2.9864112264836455
            let res = probDefQuanto(K2, L1, S2, S3, sig2, sig3, rho23, r, M1, M2, M3);
            let pdRes = 0.0014113639000835527;
            //dd=-2.207918233139494
            let isEqual = equalForPrecisionFloat(res[0], pdRes, 16);
            if (!isEqual) {
                console.log("Expected=", pdRes);
                console.log("Received pd=", res[0], " dd=", res[1]);
            }
            expect(isEqual).to.be.true;
        });

        it("perpetual price", async () => {
            // PricingBenchmark.py, test_casePerpMathTest2()
            let K2 = 0.4;
            let L1 = 0.4 * 36000;
            let S2 = 38000;
            let S3 = 2000;
            let sig2 = 0.05;
            let sig3 = 0.07;
            let rho23 = 0.5;
            let M1 = 10;
            let M2 = 0.06;
            let M3Vec = [0.02, 0];
            let r = 0;
            const minSpread = 0.05;
            const kVec = [-0.01, 0.01];
            //console.log("0.00001=",floatToABK64x64(0.00001).toString())
            let pxExpected = [36375.90405068361, 36540.38276709904, 40303.0727255397, 40501.438025113704];
            let count = 0;
            for (var jj = 0; jj < kVec.length; jj++) {
                for (var j = 0; j < M3Vec.length; j++) {
                    let M3 = M3Vec[j];
                    let k = kVec[jj];
                    let px = calcPerpPrice(K2, k, L1, S2, S3, sig2, sig3, rho23, r, M1, M2, M3, minSpread);
                    let isEqual = equalForPrecisionFloat(px, pxExpected[count], 11, false);
                    if (!isEqual) {
                        console.log("k=", k, "M3=", M3);
                        console.log("Expected=", pxExpected[count]);
                        console.log("Received pd=", px);
                        console.log("diff=", pxExpected[count] - px);
                    }
                    expect(isEqual).to.be.true;
                    count++;
                }
            }

        });

        it("round to lot ", async () => {
            let v = 0.11089797002408143;
            let vRounded = roundToLot(v, 0.0001);

            let isEqual = equalForPrecisionFloat(vRounded, 0.1109, 16);
            if (!isEqual) {
                console.log("Lot rounded = ", vRounded);
            }
            expect(isEqual).to.be.true;

            v = -0.11089797002408143;
            vRounded = roundToLot(v, 0.0001);
            isEqual = equalForPrecisionFloat(vRounded, -0.1109, 16);
            if (!isEqual) {
                console.log("Lot rounded = ", vRounded);
            }
            expect(isEqual).to.be.true;
        });

        describe("Inverse pricing Functions", () => {
            /*
            it("inverse perpetual price", async () => {
                let K2 = 0.4;
                let L1 = 0.4 * 36000;
                let S2 = 38000;
                let S3 = 2000;
                let sig2 = 0.05;
                let sig3 = 0.07;
                let rho23 = 0.5;
                let M1 = 10;
                let M2 = 0.06;
                let M3Vec = [0.02, 0];
                let r = 0;
                const minSpread = 0.05;
                const incSpread = 0.001;
                const kVec = [-0.01, 0.01];
                //console.log("0.00001=",floatToABK64x64(0.00001).toString())
                let pxExpected = [36375.90405068361, 36553.66776709904, 40303.0727255397, 40515.4830251137];
                let count = 0;
                for (var jj = 0; jj < kVec.length; jj++) {
                    for (var j = 0; j < M3Vec.length; j++) {
                        let M3 = M3Vec[j];
                        let k = kVec[jj];
                        let px = calcPerpPrice(K2, k, L1, S2, S3, sig2, sig3, rho23, r, M1, M2, M3, [minSpread, incSpread]);
                        let k2 = getTradeAmountFromPrice(K2, px, L1, S2, S3, sig2, sig3, rho23, r, M1, M2, M3, [minSpread, incSpread])
                        let isEqual = equalForPrecisionFloat(k, k2, 6, false);
                        if (!isEqual) {
                            console.log("px=", px, "M3=", M3);
                            console.log("Expected k=", k);
                            console.log("Received k=", k2);
                            console.log("diff=", k2 - k);
                        }
                        expect(isEqual).to.be.true;
                    }
                }

            });
            
            it("trades for percent range from price", async () => {
                let pctRange = [-1.0, -0.9, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, 0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
                let K2 = 0.4;
                let L1 = 0.4 * 36000;
                let S2 = 38000;
                let S3 = 2000;
                let sig2 = 0.05;
                let sig3 = 0.07;
                let rho23 = 0.5;
                let M1 = 10;
                let M2 = 0.06;
                let M3Vec = [0, 0.01];
                let r = 0;
                const minSpread = 0.05;
                const incSpread = 0.001;

                for (let j = 0; j < M3Vec.length; j++) {
                    let M3 = M3Vec[j];
                    let mat = getPricesAndTradesForPercentRage(K2, L1, S2, S3, sig2, sig3, rho23, r, M1, M2, M3, [minSpread, incSpread], pctRange);
                    for(let i = 0; i <mat[0].length; i++) {
                        let px = calcPerpPrice(K2, mat[2][i], L1, S2, S3, sig2, sig3, rho23, r, M1, M2, M3, [minSpread, incSpread]);
                        let isEqual = equalForPrecisionFloat(mat[0][i], px, 6, false);
                        if (!isEqual) {
                            console.log("M3=", M3, "k=", mat[2][i], "px=", px, "expected px=", mat[0][i]);
                        }
                        expect(isEqual).to.be.true;
                    }
                    
                }
            });
            */
        });
    });
    
});
