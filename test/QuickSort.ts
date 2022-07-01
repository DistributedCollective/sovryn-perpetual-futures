import { expect, use, util } from "chai";
const { ethers } = require("hardhat");
import { waffleChai } from "@ethereum-waffle/chai";
import { fromBytes32, toBytes32, createContract, getAccounts } from "../scripts/utils/utils";

const BN = ethers.BigNumber;

const ONE_64x64 = BN.from("0x010000000000000000");

const TRANSACTION_GAS_COST = 21000;

describe("QuickSort", () => {
    const array3 = [3000, 5, 700];
    const array5 = [3000, 5, 700, 9999, 555 * 10 * 18];
    const array10 = [3000, 5, 700, 9999, 555 * 10 * 18, 1000, 1, 5000, 0, 2];
    let quickSort;

    before(async () => {
        quickSort = await createContract("MockQuickSort");
    });

    describe("sort", () => {
        it("should sort an array [3]", async () => {
            let sortedData = await quickSort.sort(array3);
            checkSortedArray(sortedData);
        });

        it("should sort an array [5]", async () => {
            let sortedData = await quickSort.sort(array5);
            checkSortedArray(sortedData);
        });

        it("should sort an array [10]", async () => {
            let sortedData = await quickSort.sort(array10);
            checkSortedArray(sortedData);
        });
    });

    describe("sort: gas usage", () => {
        it("should sort an array [3]", async () => {
            let tx = await quickSort.sortInTransaction(array3);
            let receipt = await ethers.provider.getTransactionReceipt(tx.hash);
            console.log("sort: gasUsed = " + (receipt.gasUsed - TRANSACTION_GAS_COST));
        });

        it("should sort an array [5]", async () => {
            let tx = await quickSort.sortInTransaction(array5);
            let receipt = await ethers.provider.getTransactionReceipt(tx.hash);
            console.log("sort: gasUsed = " + (receipt.gasUsed - TRANSACTION_GAS_COST));
        });

        it("should sort an array [10]", async () => {
            let tx = await quickSort.sortInTransaction(array10);
            let receipt = await ethers.provider.getTransactionReceipt(tx.hash);
            console.log("sort: gasUsed = " + (receipt.gasUsed - TRANSACTION_GAS_COST));
        });
    });

    function checkSortedArray(sortedData: any) {
        for (let i = 1; i < sortedData.length; i++) {
            expect(sortedData[i]).to.be.gte(sortedData[i - 1]);
        }
    }
});
