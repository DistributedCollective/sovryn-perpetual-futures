// @ts-nocheck
import { expect, use, util } from "chai";
const { ethers } = require("hardhat");
import { waffleChai } from "@ethereum-waffle/chai";
import { fromBytes32, toBytes32, createContract, getAccounts } from "../scripts/utils/utils";
import { deployMockContract } from "ethereum-waffle";
import * as fs from "fs";

const BN = ethers.BigNumber;

const ONE_64x64 = BN.from("0x010000000000000000");
const ONE_DEC8 = BN.from(10).pow(BN.from(8));
const ONE_DEC18 = BN.from(10).pow(BN.from(18));

const BTC = toBytes32("BTC");
const USD = toBytes32("USD");

describe("SpotOracle", () => {
    let accounts;
    let mockPriceFeed_1, mockPriceFeed_2, mockPriceFeed_3, mockPriceFeed_4;
    let oracle;

    before(async () => {
        accounts = await getAccounts();
        let fileName = "artifacts/contracts/interface/IChainLinkPriceFeed.sol/IChainLinkPriceFeed.json";
        const file = fs.readFileSync(fileName, "utf8");
        let IChainLinkPriceFeed = JSON.parse(file);

        mockPriceFeed_1 = await deployMockContract(accounts[0], IChainLinkPriceFeed.abi);
        mockPriceFeed_2 = await deployMockContract(accounts[0], IChainLinkPriceFeed.abi);
        mockPriceFeed_3 = await deployMockContract(accounts[0], IChainLinkPriceFeed.abi);
        mockPriceFeed_4 = await deployMockContract(accounts[0], IChainLinkPriceFeed.abi);

        let priceBTC_1 = 40000;
        await mockPriceFeed_1.mock.latestAnswer.returns(BN.from(priceBTC_1).mul(ONE_DEC18));
        oracle = await createContract("SpotOracle", [BTC, USD, [mockPriceFeed_1.address], [false]]);
    });

    describe("getters", () => {
        it("should return base currency", async () => {
            let currency = await oracle.getBaseCurrency();
            expect(currency).equal(BTC);
        });

        it("should return quote currency", async () => {
            let currency = await oracle.getQuoteCurrency();
            expect(currency).equal(USD);
        });

        it("should return price feed", async () => {
            let priceFeed = await oracle.priceFeeds(0);
            expect(priceFeed).equal(mockPriceFeed_1.address);
        });
    });

    describe("setMarketClosed", () => {
        it("should fail if user isn't an owner", async () => {
            await expect(oracle.connect(accounts[1]).setMarketClosed(true)).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should return false", async () => {
            let isMarketClosed = await oracle.isMarketClosed();
            expect(isMarketClosed).false;
        });

        it("should set isMarketClosed", async () => {
            await oracle.setMarketClosed(true);

            let isMarketClosed = await oracle.isMarketClosed();
            expect(isMarketClosed).true;
        });
    });

    describe("setTerminated", () => {
        it("should fail if user isn't an owner", async () => {
            await expect(oracle.connect(accounts[1]).setTerminated(true)).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should return false", async () => {
            let isTerminated = await oracle.isTerminated();
            expect(isTerminated).false;
        });

        it("should set isMarketClosed", async () => {
            await oracle.setTerminated(true);

            let isTerminated = await oracle.isTerminated();
            expect(isTerminated).true;
        });
    });

    describe("getSpotPrice", () => {
        it("should return price using 1 price feed", async () => {
            let priceBTC_1 = 40000;
            await mockPriceFeed_1.mock.latestAnswer.returns(BN.from(priceBTC_1).mul(ONE_DEC18));
            let oracle = await createContract("SpotOracle", [BTC, USD, [mockPriceFeed_1.address], [false]]);

            let priceData = await oracle.getSpotPrice();
            expect(priceData[0]).equal(ONE_64x64.mul(priceBTC_1));
        });

        it("should return price using 1 price feed (isChainLink = true)", async () => {
            let priceBTC_1 = 40000;
            await mockPriceFeed_1.mock.latestAnswer.returns(BN.from(priceBTC_1).mul(ONE_DEC8));
            let timestamp = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp;
            await mockPriceFeed_1.mock.latestTimestamp.returns(timestamp);
            let oracle = await createContract("SpotOracle", [BTC, USD, [mockPriceFeed_1.address], [true]]);

            let priceData = await oracle.getSpotPrice();
            expect(priceData[0]).equal(ONE_64x64.mul(priceBTC_1));
            expect(priceData[1]).equal(timestamp);
        });

        it("should return price using 2 price feeds", async () => {
            let priceBTC_1 = 40000;
            let priceBTC_2 = 45000;
            await mockPriceFeed_1.mock.latestAnswer.returns(BN.from(priceBTC_1).mul(ONE_DEC18));
            await mockPriceFeed_2.mock.latestAnswer.returns(BN.from(priceBTC_2).mul(ONE_DEC18));
            let oracle = await createContract("SpotOracle", [BTC, USD, [mockPriceFeed_1.address, mockPriceFeed_2.address], [false, false]]);

            let priceData = await oracle.getSpotPrice();
            expect(priceData[0]).equal(ONE_64x64.mul((priceBTC_1 + priceBTC_2) / 2));
        });

        it("should return price using 3 price feeds", async () => {
            let priceBTC_1 = 40000;
            let priceBTC_2 = 45000;
            let priceBTC_3 = 42000;
            await mockPriceFeed_1.mock.latestAnswer.returns(BN.from(priceBTC_1).mul(ONE_DEC18));
            await mockPriceFeed_2.mock.latestAnswer.returns(BN.from(priceBTC_2).mul(ONE_DEC18));
            await mockPriceFeed_3.mock.latestAnswer.returns(BN.from(priceBTC_3).mul(ONE_DEC18));
            let oracle = await createContract("SpotOracle", [BTC, USD, [mockPriceFeed_1.address, mockPriceFeed_2.address, mockPriceFeed_3.address], [false, false, false]]);

            let priceData = await oracle.getSpotPrice();
            expect(priceData[0]).equal(ONE_64x64.mul(priceBTC_3));
        });

        it("should return price using 4 price feeds", async () => {
            let priceBTC_1 = 40000;
            let priceBTC_2 = 45000;
            let priceBTC_3 = 42000;
            let priceBTC_4 = 41000;
            await mockPriceFeed_1.mock.latestAnswer.returns(BN.from(priceBTC_1).mul(ONE_DEC18));
            await mockPriceFeed_2.mock.latestAnswer.returns(BN.from(priceBTC_2).mul(ONE_DEC18));
            await mockPriceFeed_3.mock.latestAnswer.returns(BN.from(priceBTC_3).mul(ONE_DEC18));
            await mockPriceFeed_4.mock.latestAnswer.returns(BN.from(priceBTC_4).mul(ONE_DEC18));
            let oracle = await createContract("SpotOracle", [
                BTC,
                USD,
                [mockPriceFeed_1.address, mockPriceFeed_2.address, mockPriceFeed_3.address, mockPriceFeed_4.address],
                [false, false, false, false]
            ]);

            let priceData = await oracle.getSpotPrice();
            expect(priceData[0]).equal(ONE_64x64.mul((priceBTC_3 + priceBTC_4) / 2));
        });
    });
});
