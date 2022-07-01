import { expect, use, util } from "chai";
const { ethers } = require("hardhat");
import { waffleChai } from "@ethereum-waffle/chai";
import { fromBytes32, toBytes32, createContract, getAccounts } from "../scripts/utils/utils";
import { deployMockContract } from "ethereum-waffle";
import * as fs from "fs";
import exp = require("constants");

const BN = ethers.BigNumber;

const ONE_64x64 = BN.from("0x010000000000000000");
const ONE_DEC18 = BN.from(10).pow(BN.from(18));

const BTC = toBytes32("BTC");
const USD = toBytes32("USD");
const ETH = toBytes32("ETH");

describe("OracleFactory", () => {
    let accounts;
    let oracleFactory;
    let mockPriceFeedsExt;
    let mockPriceFeedsBTCtoUSD, mockPriceFeedsETHtoUSD;

    before(async () => {
        accounts = await getAccounts();

        oracleFactory = await createContract("OracleFactory");

        let fileName = "artifacts/contracts/interface/IPriceFeedsExt.sol/IPriceFeedsExt.json";
        const file = fs.readFileSync(fileName, "utf8");
        let IPriceFeedsExt = JSON.parse(file);

        mockPriceFeedsExt = await deployMockContract(accounts[0], IPriceFeedsExt.abi);
        mockPriceFeedsBTCtoUSD = await deployMockContract(accounts[0], IPriceFeedsExt.abi);
        mockPriceFeedsETHtoUSD = await deployMockContract(accounts[0], IPriceFeedsExt.abi);
    });

    describe("createOracle", () => {
        it("should fail if base currency is empty", async () => {
            await expect(oracleFactory.createOracle(toBytes32(""), USD, [mockPriceFeedsExt.address], [false])).to.be.revertedWith("invalid base currency");
        });

        it("should fail if quote currency is empty", async () => {
            await expect(oracleFactory.createOracle(BTC, toBytes32(""), [mockPriceFeedsExt.address], [false])).to.be.revertedWith("invalid quote currency");
        });

        it("should fail if base and quote currencies are equal", async () => {
            await expect(oracleFactory.createOracle(BTC, BTC, [mockPriceFeedsExt.address], [false])).to.be.revertedWith("base and quote should differ");
        });

        it("should fail if base and quote currencies are equal", async () => {
            await expect(oracleFactory.createOracle(BTC, USD, [], [false])).to.be.revertedWith("at least one price feed needed");
        });

        //TODO: James: uncomment after changing deployment (mock price feed should be deployed locally)
        // it("should fail if PriceFeedsExt doesn't work", async () => {
        //     let errorMessage = "Error in mockPriceFeedsExt";
        //     await mockPriceFeedsExt.mock.latestAnswer.revertsWithReason(errorMessage);
        //     await expect(oracleFactory.createOracle(BTC, USD, [mockPriceFeedsExt.address], [false])).to.be.revertedWith(errorMessage);
        // });

        it("should fail if user isn't an owner", async () => {
            await expect(oracleFactory.connect(accounts[1]).createOracle(BTC, USD, [mockPriceFeedsExt.address], [false])).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it("should deploy oracle", async () => {
            await mockPriceFeedsExt.mock.latestAnswer.returns(1);

            let tx = await oracleFactory.createOracle(BTC, USD, [mockPriceFeedsExt.address], [false]);
            let route = await oracleFactory.getRoute(BTC, USD);

            expect(route.length).equal(1);
            expect(route[0].isInverse).to.be.false;
            let oracleAddress = route[0].oracle;

            await expect(tx).to.emit(oracleFactory, "OracleCreated").withArgs(BTC, USD, oracleAddress);
            await expect(tx).to.emit(oracleFactory, "ShortRouteAdded").withArgs(BTC, USD, oracleAddress);

            let oracle = await ethers.getContractAt("SpotOracle", oracleAddress);
            let oracleOwner = await oracle.owner();
            expect(oracleOwner).equal(accounts[0].address);
        });
    });

    describe("addOracle", () => {
        it("should fail if contract isn't an oracle", async () => {
            await expect(oracleFactory.addOracle(oracleFactory.address)).to.be.revertedWith("invalid oracle");
        });

        it("should fail if user isn't an owner", async () => {
            await expect(oracleFactory.connect(accounts[1]).addOracle(oracleFactory.address)).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should fail if PriceFeedsExt doesn't work", async () => {
            await mockPriceFeedsExt.mock.latestAnswer.returns(1);
            await oracleFactory.createOracle(BTC, USD, [mockPriceFeedsExt.address], [false]);
            let route = await oracleFactory.getRoute(BTC, USD);
            let oracle = route[0].oracle;
            await oracleFactory.removeRoute(BTC, USD);
            route = await oracleFactory.getRoute(BTC, USD);
            expect(route.length).equal(0);

            let errorMessage = "Error in mockPriceFeedsExt";
            await mockPriceFeedsExt.mock.latestAnswer.revertsWithReason(errorMessage);
            await expect(oracleFactory.addOracle(oracle)).to.be.revertedWith(errorMessage);
        });

        it("should add oracle", async () => {
            await mockPriceFeedsExt.mock.latestAnswer.returns(1);
            await oracleFactory.createOracle(BTC, USD, [mockPriceFeedsExt.address], [false]);
            let route = await oracleFactory.getRoute(BTC, USD);
            let oracle = route[0].oracle;
            await oracleFactory.removeRoute(BTC, USD);
            route = await oracleFactory.getRoute(BTC, USD);
            expect(route.length).equal(0);

            let tx = await oracleFactory.addOracle(oracle);
            route = await oracleFactory.getRoute(BTC, USD);

            expect(route.length).equal(1);
            expect(route[0].isInverse).to.be.false;
            oracle = route[0].oracle;

            await expect(tx).to.emit(oracleFactory, "OracleAdded").withArgs(BTC, USD, oracle);
            await expect(tx).to.emit(oracleFactory, "ShortRouteAdded").withArgs(BTC, USD, oracle);
        });
    });

    describe("addRoute", () => {
        let oracleBTCtoUSD;

        before(async () => {
            oracleBTCtoUSD = await createOracle(BTC, USD, mockPriceFeedsExt.address);
        });

        it("should fail if wrong arrays' sizes", async () => {
            await expect(oracleFactory.addRoute(BTC, USD, [], [false])).to.be.revertedWith("arrays mismatch");
        });

        it("should fail if array of oracles is empty", async () => {
            await expect(oracleFactory.addRoute(BTC, USD, [], [])).to.be.revertedWith("invalid oracles data");
        });

        it("should fail if route is invalid: reason 1", async () => {
            await expect(oracleFactory.addRoute(USD, BTC, [oracleBTCtoUSD], [false])).to.be.revertedWith("invalid route [1]");
        });

        it("should fail if route is invalid: reason 2", async () => {
            await expect(oracleFactory.addRoute(BTC, USD, [oracleBTCtoUSD], [true])).to.be.revertedWith("invalid route [2]");
        });

        it("should fail if route is invalid: reason 3", async () => {
            await expect(oracleFactory.addRoute(BTC, USD, [oracleBTCtoUSD, oracleBTCtoUSD], [false, false])).to.be.revertedWith("invalid route [3]");
        });

        it("should fail if route is invalid: reason 4", async () => {
            await expect(oracleFactory.addRoute(USD, BTC, [oracleBTCtoUSD, oracleBTCtoUSD], [true, true])).to.be.revertedWith("invalid route [4]");
        });

        it("should fail if route is invalid: reason 5", async () => {
            await expect(oracleFactory.addRoute(BTC, USD, [oracleBTCtoUSD, oracleBTCtoUSD], [false, true])).to.be.revertedWith("invalid route [5]");
        });

        it("should fail if user isn't an owner", async () => {
            await expect(oracleFactory.connect(accounts[1]).addRoute(BTC, USD, [], [false])).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should add a route", async () => {
            await mockPriceFeedsBTCtoUSD.mock.latestAnswer.returns(40);
            await mockPriceFeedsETHtoUSD.mock.latestAnswer.returns(2);

            let oracleBTCtoUSD = await createOracle(BTC, USD, mockPriceFeedsBTCtoUSD.address);
            let oracleETHtoUSD = await createOracle(ETH, USD, mockPriceFeedsETHtoUSD.address);

            let tx = await oracleFactory.addRoute(BTC, ETH, [oracleBTCtoUSD, oracleETHtoUSD], [false, true]);

            let route = await oracleFactory.getRoute(BTC, ETH);
            expect(route.length).equal(2);
            expect(route[0].isInverse).to.be.false;
            expect(route[0].oracle).equal(oracleBTCtoUSD);
            expect(route[1].isInverse).to.be.true;
            expect(route[1].oracle).equal(oracleETHtoUSD);

            await expect(tx).to.emit(oracleFactory, "RouteAdded").withArgs(BTC, ETH, [oracleBTCtoUSD, oracleETHtoUSD], [false, true]);
        });
    });

    describe("removeRoute", () => {
        it("should to remove a route", async () => {
            await mockPriceFeedsExt.mock.latestAnswer.returns(1);
            await oracleFactory.createOracle(BTC, USD, [mockPriceFeedsExt.address], [false]);
            let route = await oracleFactory.getRoute(BTC, USD);
            expect(route.length).equal(1);

            let tx = await oracleFactory.removeRoute(BTC, USD);
            route = await oracleFactory.getRoute(BTC, USD);
            expect(route.length).equal(0);

            await expect(tx).to.emit(oracleFactory, "RouteRemoved").withArgs(BTC, USD);
        });

        it("should fail if user isn't an owner", async () => {
            await expect(oracleFactory.connect(accounts[1]).removeRoute(BTC, USD)).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("getSpotPrice", () => {
        let priceBTC, priceBTC_64x64;
        let priceETH, priceETH_64x64;

        before(async () => {
            priceBTC = 40000;
            priceBTC_64x64 = BN.from(priceBTC).mul(ONE_64x64);
            await mockPriceFeedsBTCtoUSD.mock.latestAnswer.returns(BN.from(priceBTC).mul(ONE_DEC18));

            priceETH = 2000;
            priceETH_64x64 = BN.from(priceETH).mul(ONE_64x64);
            await mockPriceFeedsETHtoUSD.mock.latestAnswer.returns(BN.from(priceETH).mul(ONE_DEC18));

            let oracleBTCtoUSD = await createOracle(BTC, USD, mockPriceFeedsBTCtoUSD.address);
            let oracleETHtoUSD = await createOracle(ETH, USD, mockPriceFeedsETHtoUSD.address);
            await oracleFactory.addRoute(BTC, ETH, [oracleBTCtoUSD, oracleETHtoUSD], [false, true]);
        });

        it("should fail for undefined pair", async () => {
            await expect(oracleFactory.getSpotPrice(BTC, toBytes32("DUMMY"))).to.be.revertedWith("route not found");
        });

        it("should return spot price for short routes", async () => {
            let priceData = await oracleFactory.getSpotPrice(BTC, USD);
            expect(priceData[0]).equal(priceBTC_64x64);

            priceData = await oracleFactory.getSpotPrice(USD, BTC);
            expect(priceData[0]).equal(ONE_64x64.div(priceBTC));

            priceData = await oracleFactory.getSpotPrice(ETH, USD);
            expect(priceData[0]).equal(priceETH_64x64);

            priceData = await oracleFactory.getSpotPrice(USD, ETH);
            expect(priceData[0]).equal(ONE_64x64.div(priceETH));
        });

        it("should return spot price for long routes", async () => {
            let priceData = await oracleFactory.getSpotPrice(BTC, ETH);
            expect(priceData[0]).equal(BN.from(priceBTC).div(BN.from(priceETH)).mul(ONE_64x64));

            priceData = await oracleFactory.getSpotPrice(ETH, BTC);
            expect(priceData[0]).equal(ONE_64x64.mul(BN.from(priceETH)).div(priceBTC).toString());
        });
    });

    async function createOracle(baseCurrency, quoteCurrency, priceFeedsExt) {
        await oracleFactory.createOracle(baseCurrency, quoteCurrency, [priceFeedsExt], [false]);
        let route = await oracleFactory.getRoute(baseCurrency, quoteCurrency);
        return route[0].oracle;
    }
});
