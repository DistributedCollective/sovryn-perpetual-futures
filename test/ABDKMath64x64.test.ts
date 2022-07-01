import { expect, use, util } from "chai";
const { ethers } = require("hardhat");
import { waffleChai } from "@ethereum-waffle/chai";
import { toWei, createContract, getAccounts } from "../scripts/utils/utils";
import { equalForPrecision, floatToABK64x64, ABK64x64ToFloat, fromDec18, equalForPrecisionFloat } from "../scripts/utils/perpMath";
import { deployMockContract } from "ethereum-waffle";
import * as fs from "fs";
import { BigNumber, BigNumberish } from "ethers";

const BN = ethers.BigNumber;

const ONE_DEC18 = BN.from(10).pow(BN.from(18));
const DOT_ONE_DEC18 = BN.from(10).pow(BN.from(17));
const DOT_ONE_18_DEC18 = BN.from(1);
const ONE_64x64 = BN.from("0x010000000000000000");
const TWO_64x64 = BN.from("0x020000000000000000");
const DOT_ONE_64x64 = floatToABK64x64(0.1);
const DOT_ZERO_ONE_64x64 = floatToABK64x64(0.01);
const DOT_ONE_DEC18_64x64 = floatToABK64x64(0.0000000000000000001);

describe("ABDKMath64x64", () => {
    let contract, accounts;
    let two, four;

    before(async () => {
        accounts = await getAccounts();
        contract = await createContract("MockABDKMath64x64");
        
    });

    describe("math", () => {
        before(async () => {
            two = ONE_64x64.add(ONE_64x64);
            four = two.add(two);
        });
        it("mul", async () => {
            let value = await contract.mul(floatToABK64x64(2), floatToABK64x64(-2));
            expect(value).equal(floatToABK64x64(-4));
        });
        it("div", async () => {
            let value = await contract.div(four, two);
            expect(value).equal(two);
        });
        it("sqrt", async () => {
            let value = await contract.sqrt(four);
            expect(value).equal(two);
        });
        
        it("add", async () => {
            let value = await contract.add(four, two);
            expect(value).equal(floatToABK64x64(6));
        });
        it("sub", async () => {
            let value = await contract.sub(four, two);
            expect(value).equal(two);
            value = await contract.sub(two, four);
            expect(value).equal(floatToABK64x64(-2));
        });
        it("avg", async () => {
            let value = await contract.avg(four, two);
            expect(value).equal(floatToABK64x64(3));
            value = await contract.avg(four, floatToABK64x64(-4));
            expect(value).equal(floatToABK64x64(0));
        });
        it("gavg", async () => {
            let value = await contract.gavg(four, four);
            expect(value).equal(floatToABK64x64(4));
        });
        it("divu", async () => {
            let value = await contract.divu(BN.from(9), BN.from(4));
            expect(value).equal(floatToABK64x64(9/4));
        });
        it("divi", async () => {
            let value = await contract.divi(BN.from(-9), BN.from(4));
            expect(value).equal(floatToABK64x64(-9/4));
        });
        it("muli", async () => {
            let value = await contract.mul(floatToABK64x64(-2), BN.from(4));
            expect(value).equal(BN.from(-8));
        });
        it("mulu", async () => {
            let value = await contract.mulu(floatToABK64x64(2), BN.from(4));
            expect(value).equal(BN.from(8));
        });
        it("neg", async () => {
            let value = await contract.neg(four);
            expect(value).equal(floatToABK64x64(-4));
        });
        it("abs", async () => {
            let value = await contract.abs(floatToABK64x64(-4));
            expect(value).equal(four);
            value = await contract.abs(floatToABK64x64(4));
            expect(value).equal(four);
        });
        it("pow", async () => {
            let fValue = await contract.pow(two, BN.from(2));
            expect(fValue).equal(four);
        });

        it("inv", async () => {
            let arr = [3.7, -2.1, 48, 500];
            for(var j=0; j<arr.length; j++) {
                let start = arr[j];
                let val_in = floatToABK64x64(1/start);
                let fValue = await contract.inv(val_in);
                let res = ABK64x64ToFloat(fValue);
                let isEqual = equalForPrecisionFloat(res, start, 12);
                if (!isEqual) {
                    console.log("Result   = ", res)
                    console.log("Expected = ", start)
                }
                expect(isEqual).to.be.true;
            }

        });
        it("exp", async () => {
            // exp(-2) * exp(2) == 1
            let arr = [0, 2, 4];
            for(var j=0; j<arr.length; j++) {
                let v = 2**arr[j];
                //console.log(v)
                let fv1 = await contract.exp(floatToABK64x64(v));
                let fv2 = await contract.exp(floatToABK64x64(-v));
                let fRes = await contract.mul(fv1, fv2);
                let res = ABK64x64ToFloat(fRes);
                let isEqual = equalForPrecisionFloat(res, 1, 12);
                if (!isEqual) {
                    console.log("Result   = ", res)
                    console.log("Expected = ", 1)
                }
                expect(isEqual).to.be.true;
            }
            
        });
        
        it("exp_2", async () => {
            // 2^(-2) * 2^(2) == 1
            let arr = [BN.from("0x8FFFFFFFFFFFFFFF"), floatToABK64x64(2)];
            let arr_neg = [BN.from("0x8FFFFFFFFFFFFFFF").mul(-1), floatToABK64x64(-2)];
            for(var j=0; j< arr.length; j++) {
                let v1 = arr[j];
                let v2 = arr_neg[j]
                let fv1 = await contract.exp_2(v1);
                let fv2 = await contract.exp_2(v2);
                let fRes = await contract.mul(fv1, fv2);
                let res = ABK64x64ToFloat(fRes);
                let isEqual = equalForPrecisionFloat(res, 1, 15);
                if (!isEqual) {
                    console.log("Result   = ", res)
                    console.log("Expected = ", 1)
                }
                expect(isEqual).to.be.true;
            }
            
        });
        it("ln", async () => {
            // log(exp(x)) == x
            let v = floatToABK64x64(Math.exp(3));
            let fRes = await contract.ln(v);
            let res = ABK64x64ToFloat(fRes);
            let isEqual = equalForPrecisionFloat(res, 3, 15);
            if (!isEqual) {
                console.log("Result   = ", res)
                console.log("Expected = ", 1)
            }
            expect(isEqual).to.be.true;
        });
        it("log2", async () => {
            
            let arr = [1, 2, 8, 16, 24];
            for(var j=0; j<arr.length; j++) {
                let v = arr[j];
                let fV = await contract.pow(two, BN.from(v));
                let fRes = await contract.log_2(fV);
                let res = ABK64x64ToFloat(fRes);
                let isEqual = equalForPrecisionFloat(res, v, 5);
                if (!isEqual) {
                    console.log("Result   = ", res)
                    console.log("Expected = ", v)
                }
                expect(isEqual).to.be.true;
            }
        });
    });

    describe("fromDec18", () => {
        it("convert 1", async () => {
            let value = await contract.fromDec18(ONE_DEC18);
            expect(value).equal(ONE_64x64);
        });

        it("out of range max", async () => {
            let fMax = BN.from("0x8FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
            let tx = contract.fromDec18(fMax);
            await expect(tx).to.be.revertedWith("result out of range");
        });

        it("out of range min", async () => {
            let fMin = BN.from("-0x80000000000000000000000000000001");
            let tx = contract.fromDec18(fMin);
            await expect(tx).to.be.revertedWith("result out of range");
        });

        it("toUDec18 should fail with negative values", async () => {
            await expect(contract.toUDec18(floatToABK64x64(-2))).to.be.revertedWith("negative value");
        });

        it("toUDec18 with positive value", async () => {
            let v = await contract.toUDec18(floatToABK64x64(1));
            expect(v).to.be.equal(ONE_DEC18)
        });

        it("from128x128", async () => {
            let ONE128x128 = BN.from(2).pow(128)
            let v = await contract.from128x128(ONE128x128);
            expect(v).to.be.equal(ONE_64x64);
        });

        it("to128x128", async () => {
            let ONE128x128 = BN.from(2).pow(128)
            let v = await contract.to128x128(ONE_64x64);
            expect(v).to.be.equal(ONE128x128);
        });


        it("convert 1.1", async () => {
            let inputValue = ONE_DEC18.add(DOT_ONE_DEC18);
            let outputValue = await contract.fromDec18(inputValue);
            let res = ONE_64x64.add(DOT_ONE_64x64);
            let isEqual = equalForPrecision(outputValue, res, 15, false);
            if (!isEqual) {
                console.log("in=", inputValue);
                console.log("out=", outputValue);
                console.log("expected=", res);
            }
            expect(isEqual).to.be.true;
        });

        it("convert 1.000000000000000001", async () => {
            let inputValue = ONE_DEC18.add(DOT_ONE_18_DEC18);
            let outputValue = await contract.fromDec18(inputValue);

            let expectedValue = ONE_64x64.add(DOT_ONE_DEC18_64x64);
            let isEqual = equalForPrecision(outputValue, expectedValue, 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert 12345", async () => {
            let inputValue = ONE_DEC18.mul(12345);
            let outputValue = await contract.fromDec18(inputValue);

            expect(outputValue).equal(ONE_64x64.mul(12345));
        });

        it("convert -0.03", async () => {
            let inputValue = ONE_DEC18.mul(-3).div(100);
            let outputValue = await contract.fromDec18(inputValue);
            expect(outputValue).equal(DOT_ZERO_ONE_64x64.mul(-3));
        });

        it("convert -1.000000000000000001", async () => {
            let inputValue = ONE_DEC18.add(DOT_ONE_18_DEC18).mul(-1);
            let outputValue = await contract.fromDec18(inputValue);

            let expectedValue = ONE_64x64.add(DOT_ONE_DEC18_64x64).mul(-1);
            let isEqual = equalForPrecision(outputValue, expectedValue, 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert -6789", async () => {
            let inputValue = ONE_DEC18.mul(-6789);
            let outputValue = await contract.fromDec18(inputValue);

            expect(outputValue).equal(ONE_64x64.mul(-6789));
        });
    });

    describe("toDec18", () => {
        it("convert 1", async () => {
            let value = await contract.toDec18(ONE_64x64);
            expect(value).equal(ONE_DEC18);
        });

        it("convert 1.1", async () => {
            let inputValue = ONE_64x64.add(DOT_ONE_64x64);
            let outputValue = await contract.toDec18(inputValue);

            let isEqual = equalForPrecision(outputValue, ONE_DEC18.add(DOT_ONE_DEC18), 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert 1.000000000000000001", async () => {
            let inputValue = ONE_64x64.add(DOT_ONE_DEC18_64x64);
            let outputValue = await contract.toDec18(inputValue);

            let isEqual = equalForPrecision(outputValue, ONE_DEC18.add(DOT_ONE_18_DEC18), 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert 12345", async () => {
            let inputValue = ONE_64x64.mul(12345);
            let outputValue = await contract.toDec18(inputValue);

            expect(outputValue).equal(ONE_DEC18.mul(12345));
        });

        it("convert 0.05", async () => {
            let inputValue = DOT_ZERO_ONE_64x64.mul(5);
            let outputValue = await contract.toDec18(inputValue);

            let isEqual = equalForPrecision(outputValue, ONE_DEC18.mul(5).div(100), 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert -0.03", async () => {
            let inputValue = DOT_ZERO_ONE_64x64.mul(-3);
            let outputValue = await contract.toDec18(inputValue);

            let isEqual = equalForPrecision(outputValue, ONE_DEC18.mul(-3).div(100), 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert -1.000000000000000001", async () => {
            let inputValue = ONE_64x64.add(DOT_ONE_DEC18_64x64).mul(-1);
            let outputValue = await contract.toDec18(inputValue);

            let isEqual = equalForPrecision(outputValue, ONE_DEC18.add(DOT_ONE_18_DEC18).mul(-1), 17, false);
            expect(isEqual).to.be.true;
        });

        it("convert -6789", async () => {
            let inputValue = ONE_64x64.mul(-6789);
            let outputValue = await contract.toDec18(inputValue);

            expect(outputValue).equal(ONE_DEC18.mul(-6789));
        });
    });
});
