// @ts-nocheck
import { expect } from "chai";
const { ethers } = require("hardhat");
const abi = require("ethereumjs-abi");
const ethUtil = require("ethereumjs-util");
import { getAccounts } from "../scripts/utils/utils";
import { createLiquidityPool, createPerpetual, createPerpetualManager } from "./TestFactory";
import {
    ABK64x64ToFloat,
    COLLATERAL_CURRENCY_BASE,
    COLLATERAL_CURRENCY_QUANTO,
    COLLATERAL_CURRENCY_QUOTE,
    div64x64,
    add64x64,
    equalForPrecision,
    floatToABK64x64,
    mul64x64,
    roundToLot,
    toDec18,
    equalForPrecisionFloat,
} from "../scripts/utils/perpMath";
import { calculateSlippagePrice } from "../scripts/utils/perpUtils";
import { deposit, trade } from "../scripts/deployment/deploymentUtil";
import { PERPETUAL_ID } from "../scripts/deployment/contracts";
import { BigNumberish, Contract } from "ethers";
import { BytesLike } from "@ethersproject/bytes";
import { TypedDataUtils } from "ethers-eip712";
import { equal, or } from "mathjs";
import ethUtil, { keccak256 } from "ethereumjs-util";
import { PerpetualManagerProxy, IMockPerpetualManager } from "typechain";
import { createSignature } from "./tradeFunctions";
const BN = ethers.BigNumber;

const ONE_DEC18 = BN.from(10).pow(BN.from(18));
const ONE_64x64 = BN.from("0x010000000000000000");
const DOT_ONE_64x64 = ONE_64x64.div(BN.from("10")); //BN.from("0x016345785d8a0000");

const DECIMALS = BN.from(10).pow(BN.from(18));

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const MASK_CLOSE_ONLY = BN.from("0x80000000");
const MASK_MARKET_ORDER = BN.from("0x40000000");
const MASK_STOP_ORDER = BN.from("0x20000000");
const MASK_USE_TARGET_LEVERAGE = BN.from("0x08000000");
const MASK_LIMIT_ORDER = BN.from("0x04000000");

const PERPETUAL_STATE_INVALID = 0;
const PERPETUAL_STATE_INITIALIZING = 1;
const PERPETUAL_STATE_NORMAL = 2;
const PERPETUAL_STATE_EMERGENCY = 3;
const PERPETUAL_STATE_CLEARED = 4;

describe("PerpetualTradeLogic", () => {
    let accounts, owner;
    let manager: IMockPerpetualManager;
    let poolId, perpetualId;
    let marginToken;

    before(async () => {
        accounts = await getAccounts();
        owner = accounts[0].address;

        manager = await createPerpetualManager();
        let poolData = await createLiquidityPool(manager, owner);
        poolId = poolData.id;
        marginToken = poolData.marginToken;
        await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));
        perpetualId = await createPerpetual(manager, poolId);
        await manager.runLiquidityPool(poolId);
    });

    describe("trade", () => {
        let manager;
        let poolId, perpetualId;
        let marginToken;

        before(async () => {
            manager = await createPerpetualManager(false, ["MockSettedPerpetualTradeLogic"]);
            // manager = await createPerpetualManager(false, []);
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
            await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));
            perpetualId = await createPerpetual(manager, poolId);
            await manager.runLiquidityPool(poolId);
        });

        beforeEach(async () => {
            await manager.setWhitelistActive(false);
        });

        it("should fail if not whitelisted", async () => {
            let tradeAmount = floatToABK64x64(3);
            let limitPrice = floatToABK64x64(50000);

            await manager.setWhitelistActive(true);
            //trade(manager, perpetualId, tradeAmount, limitPrice, account, referrer = ZERO_ADDRESS, 
            //    deadline = null, leverage = null, flags = null, triggerPrice = 0)
            await expect(trade(manager, perpetualId, tradeAmount, limitPrice, owner)).to.be.revertedWith("account should be whitelisted");
            let isWhitelisted: bool = await manager.isAddrWhitelisted(owner);
            expect(isWhitelisted).to.be.false;

            await manager.setWhitelistActive(false);
            let isWhitelisted2: bool = await manager.isAddrWhitelisted(owner);
            expect(isWhitelisted2).to.be.true;
        });

        it("should fail if trader address is empty", async () => {
            let tradeAmount = floatToABK64x64(3);
            let limitPrice = floatToABK64x64(50000);
            await expect(trade(manager, perpetualId, tradeAmount, limitPrice, ZERO_ADDRESS)).to.be.revertedWith("sender should be set in an order");
        });

        it("should fail if referrer can't be set", async () => {
            let tradeAmount = floatToABK64x64(3);
            let limitPrice = floatToABK64x64(50000);
            await expect(trade(manager, perpetualId, tradeAmount, limitPrice, owner, accounts[1].address)).to.be.revertedWith(
                "referrer can't be set for market order"
            );
        });

        it("should fail if trade amount is zero", async () => {
            let tradeAmount = 0;
            let limitPrice = floatToABK64x64(50000);
            await expect(trade(manager, perpetualId, tradeAmount, limitPrice, owner)).to.be.revertedWith("invalid amount");
        });

        it("should fail if deadline exceeded", async () => {
            let tradeAmount = floatToABK64x64(3);
            let limitPrice = floatToABK64x64(50000);
            let deadline = Math.round(new Date() / 1000);
            await expect(trade(manager, perpetualId, tradeAmount, limitPrice, owner, ZERO_ADDRESS, deadline)).to.be.revertedWith("deadline exceeded");
        });

        it("should fail if perpetual.state != NORMAL", async () => {
            let tradeAmount = floatToABK64x64(3);
            let limitPrice = floatToABK64x64(50000);

            await manager.setPerpetualState(perpetualId, PERPETUAL_STATE_INITIALIZING);
            await expect(trade(manager, perpetualId, tradeAmount, limitPrice, owner)).to.be.revertedWith("perpetual should be in NORMAL state");
            await manager.setPerpetualState(perpetualId, PERPETUAL_STATE_NORMAL);
        });

        it("should fail if market is closed now", async () => {
            let tradeAmount = floatToABK64x64(3);
            let limitPrice = floatToABK64x64(50000);

            let perpetual = await manager.getPerpetual(perpetualId);
            let oracle = await ethers.getContractAt("SpotOracle", perpetual.oracleS2Addr);

            await oracle.setMarketClosed(true);
            await expect(trade(manager, perpetualId, tradeAmount, limitPrice, owner)).to.be.revertedWith("market is closed now");
            await oracle.setMarketClosed(false);
        });

        it("should fail if quanto market is closed now", async () => {
            let tradeAmount = floatToABK64x64(3);
            let limitPrice = floatToABK64x64(50000);

            let perpetual = await manager.getPerpetual(perpetualId);
            let oracle = await ethers.getContractAt("SpotOracle", perpetual.oracleS3Addr);
            await oracle.setMarketClosed(true);
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(trade(manager, perpetualId, tradeAmount, limitPrice, owner)).to.be.revertedWith("quanto market is closed now");
            await oracle.setMarketClosed(false);
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_BASE);
        });

        it("should fail if trade amount is too high", async () => {
            let fLockedInValueQC = ONE_64x64.mul(40000);
            let fCashCC = ONE_64x64.mul(100000);
            let traderPos = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);
            let ema = floatToABK64x64(0.5); //= 0.5
            let ammCash = floatToABK64x64(1); //= 1
            let bumpUp = floatToABK64x64(1.1);
            await manager.setGenericPerpInt128(perpetualId, "fCurrentTraderExposureEMA", ema);
            await manager.setGenericPerpInt128(perpetualId, "fAMMFundCashCC", ammCash);
            await manager.setGenericPerpInt128(perpetualId, "fMaximalTradeSizeBumpUp", bumpUp);
            // kstar = cash - K2 = 1 - 2 = -1


            // checks:
            // let margin = await manager.getMarginAccount(perpetualId, owner);
            // let perp = await manager.getPerpetual(perpetualId);
            // console.log("position = ", ABK64x64ToFloat(margin.fPositionBC));
            // console.log("AMM cash = ", ABK64x64ToFloat(perp.fAMMFundCashCC));
            // console.log("bump up = ", ABK64x64ToFloat(perp.fMaximalTradeSizeBumpUp));
            // console.log("EMA = ", ABK64x64ToFloat(perp.fCurrentTraderExposureEMA));

            let depositAmount = floatToABK64x64(1001);
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            let tradeAmount = depositAmount;
            let limitPrice = floatToABK64x64(50000);
            await expect(trade(manager, perpetualId, tradeAmount, limitPrice, owner)).to.be.revertedWith(
                "Trade amount exceeds maximal trade amount for trader and AMM state"
            );
        });

        it("should execute trade (open position)", async () => {
            let fLockedInValueQC = ONE_64x64.mul(40000);
            let fCashCC = ONE_64x64.mul(100000);
            let traderPos = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);

            let depositAmount = floatToABK64x64(3);
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            let tradeAmount = depositAmount;
            let limitPrice = floatToABK64x64(50000);

            await manager.setWhitelistActive(true);
            await manager.addToWhitelist([owner]);

            let tx = await trade(manager, perpetualId, tradeAmount, limitPrice, owner);
            await manager.setWhitelistActive(false);

            //check preTrade
            await expect(tx).to.emit(manager, "MockPreTrade").withArgs(perpetualId, owner, tradeAmount, limitPrice, MASK_MARKET_ORDER);
            //check executeTrade
            let fDeltaLockedValue = mul64x64(tradeAmount, limitPrice);
            await expect(tx).to.emit(manager, "MockExecuteTrade").withArgs(perpetualId, owner, traderPos, tradeAmount, fDeltaLockedValue, false);
            //check distributeFees
            await expect(tx).to.emit(manager, "MockDistributeFees").withArgs(perpetualId, owner, ZERO_ADDRESS, tradeAmount, true);

            //check _updateMarkPrice
            await expect(tx).to.emit(manager, "UpdateMarkPrice");
        });
        
        it("should execute trade (limit order)", async () => {
            let fLockedInValueQC = ONE_64x64.mul(40000);
            let fCashCC = ONE_64x64.mul(100000);
            let traderPos = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);

            let depositAmount = floatToABK64x64(3);
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            let tradeAmount = depositAmount;
            let limitPrice = floatToABK64x64(50000);

            await manager.setWhitelistActive(true);
            await manager.addToWhitelist([owner]);
            let isWhitelisted: bool = await manager.isAddrWhitelisted(owner);
            expect(isWhitelisted).to.be.true;
            let tx = await trade(manager, perpetualId, tradeAmount, limitPrice, owner, ZERO_ADDRESS, null, null, MASK_LIMIT_ORDER);
            await manager.setWhitelistActive(false);

            //check preTrade
            await expect(tx).to.emit(manager, "MockPreTrade").withArgs(perpetualId, owner, tradeAmount, limitPrice, MASK_LIMIT_ORDER);
            //check executeTrade
            let fDeltaLockedValue = mul64x64(tradeAmount, limitPrice);
            await expect(tx).to.emit(manager, "MockExecuteTrade").withArgs(perpetualId, owner, traderPos, tradeAmount, fDeltaLockedValue, false);
            //check distributeFees
            await expect(tx).to.emit(manager, "MockDistributeFees").withArgs(perpetualId, owner, ZERO_ADDRESS, tradeAmount, true);

            //check _updateMarkPrice
            await expect(tx).to.emit(manager, "UpdateMarkPrice");
        });

        it("should execute trade (stop order)", async () => {
            let fLockedInValueQC = ONE_64x64.mul(40000);
            let fCashCC = ONE_64x64.mul(100000);
            let traderPos = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);

            let depositAmount = floatToABK64x64(3);
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            let tradeAmount = depositAmount;
            let limitPrice = floatToABK64x64(50000);

            await manager.setWhitelistActive(true);
            await manager.addToWhitelist([owner]);

            let premium = 2;
            let s2 = 40000;
            await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(s2));
            await manager.setGenericPriceData(perpetualId, "currentPremiumRate", floatToABK64x64(premium / s2));
            await manager.setGenericPriceData(perpetualId, "currentMarkPremiumRate", floatToABK64x64(premium / s2));

            let perpetual = await manager.getPerpetual(perpetualId);
            let priceData = await manager.getOraclePriceData(perpetual.oracleS2Addr);
            let markPrice = ABK64x64ToFloat(mul64x64(priceData.fPrice,
                add64x64(ONE_64x64, perpetual.currentMarkPremiumRate.fPrice)));
            //console.log("mark price =", markPrice);
            let triggerPrice = floatToABK64x64(markPrice - 100);
            let tx = await trade(manager, perpetualId, tradeAmount, limitPrice, owner, ZERO_ADDRESS, null, null, MASK_STOP_ORDER,
                triggerPrice);
            await manager.setWhitelistActive(false);

            //check preTrade
            await expect(tx).to.emit(manager, "MockPreTrade").withArgs(perpetualId, owner, tradeAmount, limitPrice, MASK_STOP_ORDER);
            //check executeTrade
            let fDeltaLockedValue = mul64x64(tradeAmount, limitPrice);
            await expect(tx).to.emit(manager, "MockExecuteTrade").withArgs(perpetualId, owner, traderPos, tradeAmount, fDeltaLockedValue, false);
            //check distributeFees
            await expect(tx).to.emit(manager, "MockDistributeFees").withArgs(perpetualId, owner, ZERO_ADDRESS, tradeAmount, true);

            //check _updateMarkPrice
            await expect(tx).to.emit(manager, "UpdateMarkPrice");
        });

    });

    describe("tradeBySig branches", () => {
        it("should fail if invalid trigger", async () => {
            let triggerPrice = floatToABK64x64(-2);
            let depositAmount = floatToABK64x64(3);
            let deadline = Math.round(new Date() / 1000) + 1000;
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            let tradeAmount = floatToABK64x64(0.01);
            let limitPrice = floatToABK64x64(60000);
            let premium = 2;
            let s2 = 40000;
            await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(s2));
            await manager.setGenericPriceData(perpetualId, "currentPremiumRate", floatToABK64x64(premium / s2));
            await manager.setGenericPriceData(perpetualId, "currentMarkPremiumRate", floatToABK64x64(premium / s2));
            // async function tradeBySig(manager: Contract, perpetualId, tradeAmount, limitPrice, account,
            // referrer = ZERO_ADDRESS, deadline = null, signSecondTime = false, cancelOrder = false, leverage = null,
            // signer = accounts[0], flags = null
            let signer = owner.address;
            let lvg = floatToABK64x64(0.5);
            await expect(tradeBySig(manager, perpetualId, tradeAmount, limitPrice, owner, accounts[2].address, deadline, false, false, lvg,
                signer, MASK_STOP_ORDER, triggerPrice)).to.be.revertedWith("positive trigger price required for stop orders")
        });
        it("should fail if stop price not met", async () => {

            let depositAmount = floatToABK64x64(3);
            let deadline = Math.round(new Date() / 1000) + 6000;
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            let tradeAmount = floatToABK64x64(0.01);
            let limitPrice = floatToABK64x64(60000);
            let premium = 2;
            let s2 = 40000;
            await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(s2));
            await manager.setGenericPriceData(perpetualId, "currentPremiumRate", floatToABK64x64(premium / s2));
            await manager.setGenericPriceData(perpetualId, "currentMarkPremiumRate", floatToABK64x64(premium / s2));
            let triggerPrice = floatToABK64x64(50000);
            // async function tradeBySig(manager: Contract, perpetualId, tradeAmount, limitPrice, account,
            // referrer = ZERO_ADDRESS, deadline = null, signSecondTime = false, cancelOrder = false, leverage = null,
            // signer = accounts[0], flags = null
            let signer = owner.address;
            let lvg = floatToABK64x64(0.5);
            await expect(tradeBySig(manager, perpetualId, tradeAmount, limitPrice, owner, accounts[2].address, deadline, false, false, lvg,
                signer, MASK_STOP_ORDER, triggerPrice)).to.be.revertedWith("mark price does not meet stop order trigger condition");
        });

        it("should execute if stop price met", async () => {
            let tradeAmount = floatToABK64x64(0.1);
            let limitPrice = floatToABK64x64(60000);
            let premium = 2;
            let s2 = 40000;
            await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(s2));
            await manager.setGenericPriceData(perpetualId, "currentPremiumRate", floatToABK64x64(premium / s2));
            await manager.setGenericPriceData(perpetualId, "currentMarkPremiumRate", floatToABK64x64(premium / s2));
            let triggerPrice = floatToABK64x64(35000);
            // async function tradeBySig(manager: Contract, perpetualId, tradeAmount, limitPrice, account,
            // referrer = ZERO_ADDRESS, deadline = null, signSecondTime = false, cancelOrder = false, leverage = null,
            // signer = accounts[0], flags = null
            let signer = owner.address;
            let lvg = floatToABK64x64(0.5);
            let tx = tradeBySig(manager, perpetualId, tradeAmount, limitPrice, owner, accounts[2].address, null, false, false, lvg,
                signer, MASK_STOP_ORDER, triggerPrice);
            await expect(tx).to.emit(manager, "UpdateMarkPrice");
        });
    });

    describe("tradeBySig", () => {
        let manager;
        let poolId, perpetualId;
        let marginToken;

        before(async () => {
            manager = await createPerpetualManager(false, ["MockSettedPerpetualTradeLogic"]);
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
            await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));
            perpetualId = await createPerpetual(manager, poolId);
            await manager.runLiquidityPool(poolId);
        });

        beforeEach(async () => {
            await manager.setWhitelistActive(false);
        });

        it("should fail if not whitelisted", async () => {
            let fLockedInValueQC = ONE_64x64.mul(40000);
            let fCashCC = ONE_64x64.mul(100000);
            let traderPos = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);

            let depositAmount = floatToABK64x64(1);
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            let tradeAmount = depositAmount;
            let limitPrice = floatToABK64x64(50000);

            await manager.setWhitelistActive(true);
            await expect(tradeBySig(manager, perpetualId, tradeAmount, limitPrice, owner)).to.be.revertedWith("account should be whitelisted");

            await manager.setWhitelistActive(false);
        });

        it("should fail if wrong signer", async () => {
            let fLockedInValueQC = ONE_64x64.mul(40000);
            let fCashCC = ONE_64x64.mul(100000);
            let traderPos = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);

            let depositAmount = floatToABK64x64(2);
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            let tradeAmount = depositAmount;
            let limitPrice = floatToABK64x64(50000);

            await expect(tradeBySig(manager, perpetualId, tradeAmount, limitPrice, accounts[1].address)).to.be.revertedWith("invalid signature");
        });

        it("should fail if already signed", async () => {
            let fLockedInValueQC = ONE_64x64.mul(40000);
            let fCashCC = ONE_64x64.mul(100000);
            let traderPos = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);

            let depositAmount = floatToABK64x64(3);
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            let tradeAmount = depositAmount;
            let limitPrice = floatToABK64x64(50000);

            await expect(tradeBySig(manager, perpetualId, tradeAmount, limitPrice, accounts[1].address, ZERO_ADDRESS, null, true)).to.be.revertedWith(
                "invalid signature"
            );
        });

        it("should fail if already executed", async () => {
            let fLockedInValueQC = ONE_64x64.mul(30000);
            let fCashCC = ONE_64x64.mul(100000);
            let traderPos = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);

            let depositAmount = floatToABK64x64(4);
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            let tradeAmount = depositAmount;
            let limitPrice = floatToABK64x64(50000);

            await manager.setWhitelistActive(true);
            await manager.addToWhitelist([accounts[1].address]);
            /*async function tradeBySig(
                manager: Contract,
                perpetualId,
                tradeAmount,
                limitPrice,
                account,
                referrer = ZERO_ADDRESS,
                deadline = null,
                signSecondTime = false,
                cancelOrder = false,
                leverage = null,
                signer = accounts[0],
                flags = null,
                triggerPrice = null
            )*/
            const timestamp = Math.round(new Date() / 1000)
            let t1 = tradeBySig(manager, perpetualId, tradeAmount, limitPrice, accounts[1].address, ZERO_ADDRESS, timestamp + 50000, timestamp, false, null, accounts[1]);
            await expect(t1).to.be.revertedWith("order already executed");

            await manager.setWhitelistActive(false);
        });

        it("should fail if order canceled", async () => {
            let fLockedInValueQC = ONE_64x64.mul(40000);
            let fCashCC = ONE_64x64.mul(100000);
            let traderPos = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);

            let depositAmount = floatToABK64x64(5);
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            let tradeAmount = depositAmount;
            let limitPrice = floatToABK64x64(50000);

            // manager: Contract,
            // perpetualId,
            // tradeAmount,
            // limitPrice,
            // account,
            // referrer = ZERO_ADDRESS,
            // deadline = null,
            // signSecondTime = false,
            // cancelOrder = false,
            // leverage = null,
            // signer = accounts[0],
            // flags = null

            await expect(tradeBySig(manager, perpetualId, tradeAmount, limitPrice, accounts[1].address, ZERO_ADDRESS, null, false, true, null, accounts[1])).to.be.revertedWith(
                "order was canceled"
            );
        });

        it("should fail if order canceled", async () => {
            let fLockedInValueQC = ONE_64x64.mul(40000);
            let fCashCC = ONE_64x64.mul(100000);
            let traderPos = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);

            let depositAmount = floatToABK64x64(6);
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            let tradeAmount = depositAmount;
            let limitPrice = floatToABK64x64(50000);

            await expect(tradeBySig(manager, perpetualId, tradeAmount, limitPrice, owner, ZERO_ADDRESS, null, false, true)).to.be.revertedWith(
                "order was canceled"
            );
        });

        it("should execute trade (open position) using a signature", async () => {
            let fLockedInValueQC = ONE_64x64.mul(40000);
            let fCashCC = ONE_64x64.mul(100000);
            let traderPos = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);

            let depositAmount = floatToABK64x64(7);
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            let tradeAmount = depositAmount;
            let limitPrice = floatToABK64x64(50000);

            await manager.setWhitelistActive(true);
            await manager.addToWhitelist([owner]);
            let tx = await tradeBySig(manager, perpetualId, tradeAmount, limitPrice, owner);
            await manager.setWhitelistActive(false);

            //check preTrade
            await expect(tx).to.emit(manager, "MockPreTrade").withArgs(perpetualId, owner, tradeAmount, limitPrice, MASK_MARKET_ORDER);
            //check executeTrade
            let fDeltaLockedValue = mul64x64(tradeAmount, limitPrice);
            await expect(tx).to.emit(manager, "MockExecuteTrade").withArgs(perpetualId, owner, traderPos, tradeAmount, fDeltaLockedValue, false);
            //check distributeFees
            await expect(tx).to.emit(manager, "MockDistributeFees").withArgs(perpetualId, owner, ZERO_ADDRESS, tradeAmount, true);
            //check _updateMarkPrice
            await expect(tx).to.emit(manager, "UpdateMarkPrice");
        });
    });

    describe("_executeTrade", () => {
        let manager;
        let poolId, perpetualId;
        let marginToken;

        before(async () => {
            manager = await createPerpetualManager(true, ["MockWithoutRestrictionPerpetualTradeLogic"]);
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
            await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));
            perpetualId = await createPerpetual(manager, poolId);
            await manager.runLiquidityPool(poolId);
        });

        it("should execute trade (open position)", async () => {
            let fLockedInValueQC = ONE_64x64.mul(40000);
            let fCashCC = ONE_64x64.mul(100000);
            let traderPos = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);
            await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(40000));
            let unitAccumulatedFunding = ONE_64x64.mul(5);
            await manager.setUnitAccumulatedFunding(perpetualId, unitAccumulatedFunding);
            let marginBefore = await manager.getMarginAccount(perpetualId, owner);
            let ammBefore = await manager.getMarginAccount(perpetualId, manager.address);

            let perpetualBefore = await manager.getPerpetual(perpetualId);
            expect(perpetualBefore.fCurrentTraderExposureEMA).not.equal(ONE_64x64);

            let fDeltaPosition = ONE_64x64.mul(3);
            let fPrice = floatToABK64x64(40000);
            await manager.executeTrade(perpetualId, owner, traderPos, fDeltaPosition, fPrice, false);
            let deltaLockedValue = mul64x64(fDeltaPosition, fPrice);

            let marginAfter = await manager.getMarginAccount(perpetualId, owner);
            expect(marginAfter.fPositionBC.sub(marginBefore.fPositionBC)).equal(fDeltaPosition);

            expect(marginAfter.fLockedInValueQC.sub(marginBefore.fLockedInValueQC)).equal(deltaLockedValue);

            let ammAfter = await manager.getMarginAccount(perpetualId, manager.address);
            expect(ammBefore.fPositionBC.sub(ammAfter.fPositionBC)).equal(fDeltaPosition);

            expect(ammBefore.fLockedInValueQC.sub(ammAfter.fLockedInValueQC)).equal(deltaLockedValue);

            let perpetualAfter = await manager.getPerpetual(perpetualId);
            expect(perpetualAfter.fCurrentTraderExposureEMA).equal(ONE_64x64);
        });

        it("should fail if fLockedInValueQC == 0", async () => {
            await manager.setMarginAccount(perpetualId, owner, 0, 0, 0);

            let traderPos = ONE_64x64.mul(2);
            let fDeltaPosition = ONE_64x64.mul(3);
            let deltaLockedValue = ONE_64x64.mul(1000);
            await expect(manager.executeTrade(perpetualId, owner, traderPos, fDeltaPosition, deltaLockedValue, true)).to.be.revertedWith(
                "cannot be closing if no exposure"
            );
        });

        it("should fail if _fTraderPos == 0", async () => {
            await manager.setMarginAccount(perpetualId, owner, ONE_64x64, 0, 0);

            let traderPos = 0;
            let fDeltaPosition = ONE_64x64.mul(3);
            let deltaLockedValue = ONE_64x64.mul(1000);
            await expect(manager.executeTrade(perpetualId, owner, traderPos, fDeltaPosition, deltaLockedValue, true)).to.be.revertedWith(
                "cannot be closing if already closed"
            );
        });
    });

    describe("_updateAverageTradeExposures", () => {
        let lambda0flt = 0.8;
        let lambda1flt = 0.6;
        let lambda0 = floatToABK64x64(lambda0flt);
        let lambda1 = floatToABK64x64(lambda1flt);

        before(async () => {
            await manager.setDFLambda(perpetualId, lambda0, lambda1);
        });

        it("should update EMAs", async () => {
            let ammPosition = ONE_64x64.mul(-2);
            let lockedInValueQC = ONE_64x64.mul(-5);
            await manager.setMarginAccount(perpetualId, manager.address, lockedInValueQC, 0, ammPosition);

            let currentAMMExposureEMA0 = ONE_64x64.mul(3); //3
            let currentAMMExposureEMA1 = ONE_64x64.mul(4); //4
            await manager.setCurrentAMMExposureEMAs(perpetualId, currentAMMExposureEMA0, currentAMMExposureEMA1);

            let currentTraderExposureEMA = ONE_64x64.mul(5); //5
            await manager.setCurrentTraderExposureEMA(perpetualId, currentTraderExposureEMA);

            let tradeAmount = ONE_64x64.mul(7);
            await manager.updateAverageTradeExposures(perpetualId, tradeAmount);

            let perpetual = await manager.getPerpetual(perpetualId);

            // calculate expected EMA value using float numbers:
            let expectedAMMExposureEMAflt = ABK64x64ToFloat(currentAMMExposureEMA1) * lambda0flt - ABK64x64ToFloat(ammPosition) * (1 - lambda0flt);
            // convert back to ABK64x64
            let expectedAMMExposureEMA = floatToABK64x64(expectedAMMExposureEMAflt);
            let isEqual = equalForPrecision(expectedAMMExposureEMA, perpetual.fCurrentAMMExposureEMA[1], 16);
            if (!isEqual) {
                console.log("EMA Expected: ", ABK64x64ToFloat(expectedAMMExposureEMA));
                console.log("EMA Received: ", ABK64x64ToFloat(perpetual.fCurrentAMMExposureEMA[1]));
            }
            expect(isEqual).to.be.true;

            let expectedEMAflt = ABK64x64ToFloat(currentTraderExposureEMA) * lambda1flt + ABK64x64ToFloat(tradeAmount) * (1 - lambda1flt);
            let expectedTraderExposureEMA = floatToABK64x64(expectedEMAflt);
            isEqual = equalForPrecision(expectedTraderExposureEMA, perpetual.fCurrentTraderExposureEMA, 15);
            if (!isEqual) {
                console.log("EMA Expected: ", ABK64x64ToFloat(expectedTraderExposureEMA));
                console.log("EMA Received: ", ABK64x64ToFloat(perpetual.fCurrentTraderExposureEMA));
            }
            expect(isEqual).to.be.true;
        });
    });

    describe("_updateMargin", () => {
        let perpetualId;

        let traderAddr;
        let fDeltaPosition;
        let fDeltaCashCC;
        let fDeltaLockedInValueQC;

        before(async () => {
            perpetualId = await createPerpetual(manager, poolId);

            traderAddr = owner;
            fDeltaPosition = ONE_64x64.mul(5);
            fDeltaCashCC = ONE_64x64.mul(6);
            fDeltaLockedInValueQC = ONE_64x64.mul(7);
        });

        it("should update margin", async () => {
            let oldPosition = ONE_64x64.mul(-2);
            await manager.setMarginAccount(perpetualId, owner, ONE_64x64, ONE_64x64, oldPosition);

            let marginBefore = await manager.getMarginAccount(perpetualId, owner);
            let perpetualBefore = await manager.getPerpetual(perpetualId);

            let unitAccumulatedFunding = ONE_64x64.mul(5);
            await manager.setUnitAccumulatedFunding(perpetualId, unitAccumulatedFunding);
            await manager.updateMargin(perpetualId, traderAddr, fDeltaPosition, fDeltaCashCC, fDeltaLockedInValueQC);

            let marginAfter = await manager.getMarginAccount(perpetualId, owner);
            let perpetualAfter = await manager.getPerpetual(perpetualId);
            expect(marginAfter.fPositionBC.sub(marginBefore.fPositionBC)).equal(fDeltaPosition);
            expect(marginAfter.fCashCC.sub(marginBefore.fCashCC)).equal(fDeltaCashCC.sub(mul64x64(marginBefore.fPositionBC, unitAccumulatedFunding)));
            expect(marginAfter.fLockedInValueQC.sub(marginBefore.fLockedInValueQC)).equal(fDeltaLockedInValueQC);

            expect(perpetualAfter.fOpenInterest.sub(perpetualBefore.fOpenInterest)).equal(fDeltaPosition.add(oldPosition));
        });
    });

    describe("_transferFee", () => {
        let traderAddr;
        let referrerAddr;
        let fPnLparticipantFee;
        let fTreasuryFee;
        let fReferralRebate;
        let fDefaultFundContribution;
        let fAMMCashContribution;

        before(async () => {
            traderAddr = owner;
            referrerAddr = accounts[1].address;
            fPnLparticipantFee = ONE_64x64.mul(2); //2
            fTreasuryFee = DOT_ONE_64x64.mul(4); //0.4
            fReferralRebate = DOT_ONE_64x64.mul(5); //0.5
            fDefaultFundContribution = DOT_ONE_64x64.mul(7); //0.7
            fAMMCashContribution = DOT_ONE_64x64.mul(3); //0.3
            // add participant cash or else fee is paid to amm pool
            await manager.setPnLparticipantsCashCC(poolId, floatToABK64x64(2));
        });

        it("should fail if _fPnLparticipantFee < 0", async () => {
            await expect(
                manager.transferFee(
                    poolId,
                    perpetualId,
                    traderAddr,
                    referrerAddr,
                    fPnLparticipantFee.mul(-1),
                    fReferralRebate,
                    fDefaultFundContribution,
                    fAMMCashContribution
                )
            ).to.be.revertedWith("PnL participant should earn fee");
        });

        it("should fail if _fReferralRebate < 0", async () => {
            await expect(
                manager.transferFee(
                    poolId,
                    perpetualId,
                    traderAddr,
                    referrerAddr,
                    fPnLparticipantFee,
                    fReferralRebate.mul(-1),
                    fDefaultFundContribution,
                    fAMMCashContribution
                )
            ).to.be.revertedWith("referrer should earn fee");
        });

        it("should transfer fee", async () => {
            let poolBefore = await manager.getLiquidityPool(poolId);
            let perpetualBefore = await manager.getPerpetual(perpetualId);
            let referrerBalanceBefore = await marginToken.balanceOf(referrerAddr);

            let tx = await manager.transferFee(
                poolId,
                perpetualId,
                traderAddr,
                referrerAddr,
                fPnLparticipantFee,
                fReferralRebate,
                fDefaultFundContribution,
                fAMMCashContribution
            );

            let poolAfter = await manager.getLiquidityPool(poolId);
            let perpetualAfter = await manager.getPerpetual(perpetualId);
            let referrerBalanceAfter = await marginToken.balanceOf(referrerAddr);

            expect(poolAfter.fPnLparticipantsCashCC.sub(poolBefore.fPnLparticipantsCashCC)).equal(fPnLparticipantFee);
            expect(poolAfter.fDefaultFundCashCC.sub(poolBefore.fDefaultFundCashCC)).equal(fDefaultFundContribution);
            expect(poolAfter.fAMMFundCashCC.sub(poolBefore.fAMMFundCashCC)).equal(fAMMCashContribution);
            expect(perpetualAfter.fAMMFundCashCC.sub(perpetualBefore.fAMMFundCashCC)).equal(fAMMCashContribution);

            expect(referrerBalanceAfter.sub(referrerBalanceBefore)).equal(toDec18(fReferralRebate));

            await expect(tx).to.emit(manager, "TransferFeeToReferrer").withArgs(perpetualId, traderAddr, referrerAddr, fReferralRebate);
        });
    });

    describe("_distributeFees", () => {
        let traderAddr;
        let referrerAddr;

        before(async () => {
            traderAddr = owner;
            referrerAddr = accounts[1].address;
        });

        it("should distribute fees", async () => {
            await manager.setMarginAccount(perpetualId, owner, ONE_64x64, ONE_64x64, ONE_64x64);

            let marginBefore = await manager.getMarginAccount(perpetualId, owner);

            let deltaPos = ONE_64x64.mul(2);
            // let tx = await manager.distributeFees(perpetualId, traderAddr, referrerAddr, deltaPos, false);
            let order = {iPerpetualId : perpetualId,
                traderAddr : traderAddr,
                fAmount : deltaPos,
                fLimitPrice:BN.from(0),
                fTriggerPrice:BN.from(0),
                iDeadline: Math.round(new Date() / 1000),
                referrerAddr : referrerAddr,
                flags:BN.from(0),
                fLeverage:BN.from(0),
                createdTimestamp:BN.from(0)};
            let tx = await manager.delegateDistributeFees(order, false);

            let perpetual = await manager.getPerpetual(perpetualId);

            let fPnLparticipantFee = mul64x64(deltaPos, perpetual.fPnLPartRate);
            let fTreasuryFee = mul64x64(deltaPos, perpetual.fTreasuryFeeRate);
            let fReferralRebateCC = perpetual.fReferralRebateCC;
            let totalFee = fPnLparticipantFee.add(fTreasuryFee).add(fReferralRebateCC);

            let marginAfter = await manager.getMarginAccount(perpetualId, owner);
            expect(marginBefore.fCashCC.sub(marginAfter.fCashCC)).equal(totalFee);

            await expect(tx).to.emit(manager, "TransferFeeToReferrer").withArgs(perpetualId, traderAddr, referrerAddr, fReferralRebateCC);
        });
    });

    describe("_calculateContributions", () => {
        let traderAddr;
        let referrerAddr;
        let inputTreasuryFee = ONE_64x64.mul(2);

        before(async () => {
            traderAddr = owner;
            referrerAddr = accounts[1].address;

            await manager.setAMMFundCashCC(poolId, ONE_64x64.mul(10));
            await manager.setDefaultFundCashCC(poolId, ONE_64x64.mul(10));
        });

        it("should calculate contributions (AMM Fund > target)", async () => {
            let inputTargetAMMFundSize = ONE_64x64.mul(10);
            let inputTargetDFSize = ONE_64x64.mul(7);
            await manager.setTargetAMMFundSize(poolId, inputTargetAMMFundSize);
            await manager.setTargetDFSize(poolId, inputTargetDFSize);

            let data = await manager.calculateContributions(poolId, inputTreasuryFee);
            let fAMMFundContribution = data[0];
            let fDefaultFundContribution = data[1];
            expect(fAMMFundContribution).equal(inputTreasuryFee);
            expect(fDefaultFundContribution).equal(0);
        });

        it("should calculate contributions (AMM Fund < target, AMM Fund + fee < target, default fund < target)", async () => {
            // let inputTreasuryFee = ONE_64x64.mul(2);
            let inputTargetAMMFundSize = ONE_64x64.mul(14);
            let inputTargetDFSize = ONE_64x64.mul(11);
            await manager.setTargetAMMFundSize(poolId, inputTargetAMMFundSize);
            await manager.setTargetDFSize(poolId, inputTargetDFSize);

            let data = await manager.calculateContributions(poolId, inputTreasuryFee);
            let fAMMFundContribution = data[0];
            let fDefaultFundContribution = data[1];
            let diffAMMExpected = inputTreasuryFee;
            let diffDFExpected = ONE_64x64.mul(0);
            expect(fAMMFundContribution).equal(diffAMMExpected);
            expect(fDefaultFundContribution).equal(diffDFExpected);
        });

        it("should calculate contributions (AMM Fund + fee < target, default fund > target)", async () => {
            // let inputTreasuryFee = ONE_64x64.mul(2);
            let inputTargetAMMFundSize = ONE_64x64.mul(14);
            let inputTargetDFSize = ONE_64x64.mul(9);
            // AMM gap = 4
            // DF is overfunded by 1
            // AMM receives fee (=2) and DF overfund = 3
            // DF gives up 2: -2
            await manager.setTargetAMMFundSize(poolId, inputTargetAMMFundSize);
            await manager.setTargetDFSize(poolId, inputTargetDFSize);

            let data = await manager.calculateContributions(poolId, inputTreasuryFee);
            let fAMMFundContribution = data[0];
            let fDefaultFundContribution = data[1];
            let diffAMMExpected = inputTreasuryFee.add(ONE_64x64);
            let diffDFExpected = ONE_64x64.mul(-1);
            expect(fAMMFundContribution).equal(diffAMMExpected);
            expect(fDefaultFundContribution).equal(diffDFExpected);
        });
    });

    describe("transferEarningsToTreasury", () => {
        it("should withdraw from default fund if safe", async () => {
            let poolBefore = await manager.getLiquidityPool(poolId);
            let lockedInValueQC = floatToABK64x64(0);
            let pos = floatToABK64x64(2);
            let cash = floatToABK64x64(20);
            await manager.setTargetDFSize(poolId, floatToABK64x64(3));
            await manager.setMarginAccount(perpetualId, manager.address, lockedInValueQC, cash, pos);
            await manager.setGenericPerpInt128(perpetualId, "fCurrentTraderExposureEMA", floatToABK64x64(0.01));
            await manager.setGenericPairData(perpetualId, "fCurrentAMMExposureEMA", floatToABK64x64(-0.25), floatToABK64x64(0.25));
            await manager.transferEarningsToTreasury(poolId, floatToABK64x64(2));
            let poolAfter = await manager.getLiquidityPool(poolId);
            let dfBefore = ABK64x64ToFloat(poolBefore.fDefaultFundCashCC);
            let dfAfter = ABK64x64ToFloat(poolAfter.fDefaultFundCashCC);
            let hasDecreased = poolBefore.fDefaultFundCashCC > poolAfter.fDefaultFundCashCC;
            if (!hasDecreased) {
                console.log("DF before=", dfBefore);
                console.log("DF after =", dfAfter);
            }
            expect(poolBefore.fDefaultFundCashCC > poolAfter.fDefaultFundCashCC).to.be.true;
        });

        it("should not withdraw from default fund if unsafe", async () => {
            let poolBefore = manager.getLiquidityPool(poolId);
            let lockedInValueQC = floatToABK64x64(0);
            let pos = floatToABK64x64(200);
            let cash = floatToABK64x64(20);

            await manager.setMarginAccount(perpetualId, manager.address, lockedInValueQC, cash, pos);
            await manager.setGenericPerpInt128(perpetualId, "fCurrentTraderExposureEMA", floatToABK64x64(0.01));
            await manager.setGenericPairData(perpetualId, "fCurrentAMMExposureEMA", floatToABK64x64(-200), floatToABK64x64(0.25));
            await manager.transferEarningsToTreasury(poolId, floatToABK64x64(2));
            let poolAfter = manager.getLiquidityPool(poolId);
            expect(poolBefore.fDefaultFundCashCC == poolAfter.fDefaultFundCashCC);
        });
    });

    describe("_calculateFees", () => {
        let fTreasuryFeeRate = DOT_ONE_64x64; //0.1
        let fPnLPartRate = DOT_ONE_64x64.mul(2); //0.2
        let fReferralRebateCC = floatToABK64x64(0.0001);

        before(async () => {
            await manager.setPerpetualFees(perpetualId, fTreasuryFeeRate, fPnLPartRate, fReferralRebateCC);
        });

        it("should fail if _fDeltaPosCC < 0", async () => {
            await expect(manager.calculateFees(perpetualId, owner, ZERO_ADDRESS, ONE_64x64.mul(-1), false)).to.be.revertedWith("absolute trade value required");
        });

        it("should fail if margin < fTotalFee (hasOpen = true)", async () => {
            await manager.setMarginAccount(perpetualId, owner, ONE_64x64.div(100), ONE_64x64.div(100), ONE_64x64.div(100));

            await expect(manager.calculateFees(perpetualId, owner, ZERO_ADDRESS, ONE_64x64, true)).to.be.revertedWith("margin not enough");
        });

        it("should return zero values if margin = 0 (hasOpen = false)", async () => {
            await manager.setMarginAccount(perpetualId, owner, 0, 0, 0);

            let data = await manager.calculateFees(perpetualId, owner, ZERO_ADDRESS, ONE_64x64, false);
            let expectedPnLparticipantFee = 0;
            let expectedTreasuryFee = 0;
            let expectedReferralRebate = 0;
            expect(data[0]).equal(expectedPnLparticipantFee);
            expect(data[1]).equal(expectedTreasuryFee);
            expect(data[2]).equal(expectedReferralRebate);
        });

        it("should decrease fees values if margin balance < fTotalFee (hasOpen = false)", async () => {
            await manager.setMarginAccount(perpetualId, owner, ONE_64x64.div(100), ONE_64x64.div(100), ONE_64x64.div(100));

            let data = await manager.calculateFees(perpetualId, owner, ZERO_ADDRESS, ONE_64x64, false);

            let availableMargin = await manager.getMarginBalance(perpetualId, owner);
            expect(availableMargin).equal(data[0].add(data[1]));

            let expectedReferralRebate = 0;
            expect(data[2]).equal(expectedReferralRebate);
        });

        it("should calculate fees", async () => {
            await manager.setMarginAccount(perpetualId, owner, ONE_64x64, ONE_64x64, ONE_64x64);

            let deltaPos = ONE_64x64.mul(2);
            let data = await manager.calculateFees(perpetualId, owner, ZERO_ADDRESS, deltaPos, false);
            let expectedPnLparticipantFee = fPnLPartRate.mul(2);
            let expectedTreasuryFee = fTreasuryFeeRate.mul(2);
            let expectedReferralRebate = 0;
            expect(data[0]).equal(expectedPnLparticipantFee);
            expect(data[1]).equal(expectedTreasuryFee);
            expect(data[2]).equal(expectedReferralRebate);
        });

        it("should calculate fees with a rebate", async () => {
            await manager.setMarginAccount(perpetualId, owner, ONE_64x64, ONE_64x64, ONE_64x64);

            let deltaPos = ONE_64x64.mul(2);
            let data = await manager.calculateFees(perpetualId, owner, owner, deltaPos, false);
            let expectedPnLparticipantFee = fPnLPartRate.mul(2); //feerate* 2
            let expectedTreasuryFee = fTreasuryFeeRate.mul(2); //feerate* 2

            let isEqual = equalForPrecision(data[0], expectedPnLparticipantFee, 17, false);
            expect(isEqual).to.be.true;

            isEqual = equalForPrecision(data[1], expectedTreasuryFee, 17, false);
            expect(isEqual).to.be.true;

            let expectedReferralRebate = fReferralRebateCC;
            isEqual = equalForPrecision(data[2], expectedReferralRebate, 17, false);
            expect(isEqual).to.be.true;
        });
    });

    describe("_isTraderMarginSafe", () => {
        it("should return true (_isInitialMarginSafe)", async () => {
            await manager.setMarginAccount(perpetualId, owner, ONE_64x64, ONE_64x64.mul(2), ONE_64x64.mul(3));

            let isMarginSafe = await manager.isInitialMarginSafe(perpetualId, owner);
            expect(isMarginSafe).true;
        });

        it("should return false (_isInitialMarginSafe)", async () => {
            await manager.setMarginAccount(perpetualId, owner, ONE_64x64.mul(4), ONE_64x64.mul(2), ONE_64x64);

            let isMarginSafe = await manager.isInitialMarginSafe(perpetualId, owner);
            expect(isMarginSafe).false;
        });

        it("should return true (_isMarginSafe)", async () => {
            await manager.setMarginAccount(perpetualId, owner, ONE_64x64, ONE_64x64.mul(2), ONE_64x64.mul(3));

            let isMarginSafe = await manager.isTraderMaintenanceMarginSafe(perpetualId, owner);
            expect(isMarginSafe).true;
        });

        it("should return false (_isMarginSafe)", async () => {
            await manager.setMarginAccount(perpetualId, owner, ONE_64x64.mul(4), ONE_64x64.mul(2), ONE_64x64);

            let isMarginSafe = await manager.isTraderMaintenanceMarginSafe(perpetualId, owner);
            expect(isMarginSafe).false;
        });
    });

    describe("_isMarginSafe", () => {
        it("should return true if margin >= 0", async () => {
            await manager.setMarginAccount(perpetualId, owner, ONE_64x64, ONE_64x64.mul(2), ONE_64x64.mul(3));

            let isMarginSafe = await manager.isMarginSafe(perpetualId, owner);
            expect(isMarginSafe).true;
        });

        it("should return false if margin < 0", async () => {
            await manager.setMarginAccount(perpetualId, owner, ONE_64x64.mul(4), ONE_64x64.mul(2), ONE_64x64);

            let isMarginSafe = await manager.isMarginSafe(perpetualId, owner);
            expect(isMarginSafe).false;
        });
    });

    describe("_queryPriceFromAMM", () => {
        before(async () => {
            manager = await createPerpetualManager(true);
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
            await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));
            perpetualId = await createPerpetual(manager, poolId);
            await manager.runLiquidityPool(poolId);
        });

        it("should fail if _fPnLparticipantFee < 0", async () => {
            await expect(manager.queryPriceFromAMM(perpetualId, 0)).to.be.revertedWith("trading amount is zero");
        });

        it("should return price", async () => {
            let price = await manager.queryPriceFromAMM(perpetualId, ONE_64x64);
            expect(price).equal(ONE_64x64);
        });
    });

    describe("_preTrade", () => {
        it("should fail if trader has no position to close", async () => {
            let position = 0;
            await manager.setMarginAccount(perpetualId, owner, 0, 0, position);
            let flags = MASK_CLOSE_ONLY;

            let amount = ONE_64x64.mul(-3);
            let limitPrice = ONE_64x64;
            let order = {iPerpetualId : perpetualId,
                traderAddr : owner,
                fAmount : amount,
                fLimitPrice : limitPrice,
                fTriggerPrice : BN.from(0),
                iDeadline: Math.round(new Date() / 1000),
                referrerAddr : ZERO_ADDRESS,
                flags: flags,
                fLeverage:BN.from(0),
                createdTimestamp:BN.from(0)};
            await expect(manager.preTrade(perpetualId, order)).to.be.revertedWith("trader has no position to close");
        });

        it("should fail if trader has negative position", async () => {
            let position = ONE_64x64.mul(-2);
            await manager.setMarginAccount(perpetualId, owner, 0, 0, position);
            let flags = MASK_CLOSE_ONLY;

            let amount = ONE_64x64.mul(-3);
            let limitPrice = ONE_64x64;
            let order = {iPerpetualId : perpetualId,
                traderAddr : owner,
                fAmount : amount,
                fLimitPrice : limitPrice,
                fTriggerPrice : BN.from(0),
                iDeadline: Math.round(new Date() / 1000),
                referrerAddr : ZERO_ADDRESS,
                flags: flags,
                fLeverage:BN.from(0),
                createdTimestamp:BN.from(0)};
            await expect(manager.preTrade(perpetualId, order)).to.be.revertedWith("trade is close only");
        });

        it("should fail if trader has negative position", async () => {
            let position = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, 0, 0, position);
            let flags = MASK_CLOSE_ONLY;

            let amount = ONE_64x64.mul(-3);
            let limitPrice = ONE_64x64.mul(10);
            let order = {iPerpetualId : perpetualId,
                traderAddr : owner,
                fAmount : amount,
                fLimitPrice : limitPrice,
                fTriggerPrice : BN.from(0),
                iDeadline: Math.round(new Date() / 1000),
                referrerAddr : ZERO_ADDRESS,
                flags: flags,
                fLeverage:BN.from(0),
                createdTimestamp:BN.from(0)};
            await expect(manager.preTrade(perpetualId, order)).to.be.revertedWith("price exceeds limit");
        });

        it("should calculate data for a closing position", async () => {
            let position = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, 0, 0, position);
            let flags = MASK_CLOSE_ONLY;

            let amount = ONE_64x64.mul(-3);
            let limitPrice = ONE_64x64;
            let order = {iPerpetualId : perpetualId,
                traderAddr : owner,
                fAmount : amount,
                fLimitPrice : limitPrice,
                fTriggerPrice : BN.from(0),
                iDeadline: Math.round(new Date() / 1000),
                referrerAddr : ZERO_ADDRESS,
                flags: flags,
                fLeverage:BN.from(0),
                createdTimestamp:BN.from(0)};
            let tx = await manager.preTrade(perpetualId, order);

            let expectedPrice = ONE_64x64;
            await expect(tx).to.emit(manager, "PreTradeResult").withArgs(expectedPrice, position.mul(-1));
        });
    });

    describe("_validatePrice", () => {
        it("should fail if price is negative", async () => {
            await expect(manager.validatePrice(true, ONE_64x64.mul(-1), ONE_64x64)).to.be.revertedWith("price must be positive");
        });

        it("should fail if limit price is zero", async () => {

            await expect(manager.validatePrice(true, ONE_64x64.mul(-1), floatToABK64x64(0))).to.be.revertedWith("price must be positive");
        });

        it("should fail if price exceeds limit (long)", async () => {
            await expect(manager.validatePrice(true, ONE_64x64.mul(2), ONE_64x64)).to.be.revertedWith("price exceeds limit");
        });

        it("should fail if price exceeds limit (short)", async () => {
            await expect(manager.validatePrice(false, ONE_64x64, ONE_64x64.mul(2))).to.be.revertedWith("price exceeds limit");
        });
    });

    describe("validateStopPrice", () => {
        it("should fail if short and mark price>trigger", async () => {
            await expect(manager.validateStopPrice(false, ONE_64x64.mul(2), ONE_64x64)).to.be.revertedWith("mark price does not meet stop order trigger condition");
        });

        it("should fail if long and mark price<trigger", async () => {
            await expect(manager.validateStopPrice(true, ONE_64x64, ONE_64x64.mul(2))).to.be.revertedWith("mark price does not meet stop order trigger condition");
        });

        it("should do nothing if trigger price zero", async () => {
            await expect(manager.validateStopPrice(true, ONE_64x64, floatToABK64x64(0)));
            await expect(manager.validateStopPrice(false, ONE_64x64, floatToABK64x64(0)));
        });

    });

    describe("_shrinkToMaxPositionToClose", () => {
        it("should fail if position is zero", async () => {
            await expect(manager.shrinkToMaxPositionToClose(0, ONE_64x64)).to.be.revertedWith("trader has no position to close");
        });

        it("should fail if position negative (trade is close only)", async () => {
            await expect(manager.shrinkToMaxPositionToClose(ONE_64x64.mul(-1), ONE_64x64.mul(-1))).to.be.revertedWith("trade is close only");
        });
    });

    describe("getMaxSignedTradeSizeForPos", () => {
        it("should fail if _fTraderExposureEMA <= 0", async () => {
            let fCurrentTraderPos = ONE_64x64.mul(3);
            let fkStar = ONE_64x64.mul(5);
            let fTraderExposureEMA = 0;
            let fBumpUp = ONE_64x64;
            let fTrade = ONE_64x64;
            await manager.setGenericPerpInt128(perpetualId, "fkStar", fkStar);
            await manager.setGenericPerpInt128(perpetualId, "fCurrentTraderExposureEMA", fTraderExposureEMA);
            await manager.setGenericPerpInt128(perpetualId, "fMaximalTradeSizeBumpUp", fBumpUp);
            await expect(manager.getMaxSignedTradeSizeForPos(perpetualId, fCurrentTraderPos, fTrade)).to.be.revertedWith(
                "precondition: fCurrentTraderExposureEMA must be positive"
            );
        });

        it("should consider enabled max position size", async () => {
            let fCurrentTraderPos = ONE_64x64.mul(3); //3
            let fkStar = floatToABK64x64(0.5);
            let fTraderExposureEMA = ONE_64x64.mul(7); //7
            let fBumpUp = ONE_64x64.add(ONE_64x64);
            let fTrade = floatToABK64x64(2); //2
            let maxPositionSize = ONE_64x64.mul(4);
            await manager.setMaxPosition(perpetualId, maxPositionSize);
            await manager.setGenericPerpInt128(perpetualId, "fkStar", fkStar);
            await manager.setGenericPerpInt128(perpetualId, "fCurrentTraderExposureEMA", fTraderExposureEMA);
            await manager.setGenericPerpInt128(perpetualId, "fMaximalTradeSizeBumpUp", fBumpUp);
            await manager.setGenericPerpInt128(perpetualId, "fMaximalTradeSizeBumpUp", fBumpUp);
            await manager.setDefaultFundCashCC(poolId, floatToABK64x64(20));
            await manager.setTargetDFSize(poolId, floatToABK64x64(20));
            // open position from 3 to 5
            // max pos is 4, kstar is 0.5, and bump up is 2 and EMA 7, so max pos is binding -> allow trade size 1 only
            let maxTrade = maxPositionSize.sub(fCurrentTraderPos);
            let returnedMaxTrade = await manager.getMaxSignedTradeSizeForPos(perpetualId, fCurrentTraderPos, fTrade);
            // reset max position
            await manager.setMaxPosition(perpetualId, 0);
            expect(maxTrade).equal(returnedMaxTrade);

        });

        it("should follow bump up if DF is full", async () => {
            let fCurrentTraderPos = ONE_64x64.mul(3);
            let fkStar = ONE_64x64.mul(5);
            let fTraderExposureEMA = ONE_64x64.mul(7);
            let fBumpUp = ONE_64x64.add(ONE_64x64);
            let fTrade = floatToABK64x64(2); //2

            let maxPositionSize = mul64x64(fTraderExposureEMA, fBumpUp);
            let fMaxTrade = maxPositionSize.sub(fCurrentTraderPos);

            await manager.setDefaultFundCashCC(poolId, floatToABK64x64(20));
            await manager.setTargetDFSize(poolId, floatToABK64x64(20));
            await manager.setGenericPerpInt128(perpetualId, "fkStar", fkStar);
            await manager.setGenericPerpInt128(perpetualId, "fCurrentTraderExposureEMA", fTraderExposureEMA);
            await manager.setGenericPerpInt128(perpetualId, "fMaximalTradeSizeBumpUp", fBumpUp);
            let maxTradeSize = await manager.getMaxSignedTradeSizeForPos(perpetualId, fCurrentTraderPos, fTrade);
            expect(fMaxTrade).equal(maxTradeSize);
        });

        it("should follow Kstar if larger than other constraints", async () => {
            let fCurrentTraderPos = ONE_64x64.mul(3);
            let fkStar = ONE_64x64.mul(50);
            let fTraderExposureEMA = ONE_64x64.mul(7);
            let fBumpUp = ONE_64x64.add(ONE_64x64);
            let fTrade = floatToABK64x64(2); //2

            // maxPositionSize = mul64x64(fTraderExposureEMA, fBumpUp) before kstar
            let fMaxTrade = fkStar.add(fkStar);
            await manager.setGenericPerpInt128(perpetualId, "fkStar", fkStar);
            await manager.setGenericPerpInt128(perpetualId, "fCurrentTraderExposureEMA", fTraderExposureEMA);
            await manager.setGenericPerpInt128(perpetualId, "fMaximalTradeSizeBumpUp", fBumpUp);
            let returnedMaxTrade = await manager.getMaxSignedTradeSizeForPos(perpetualId, fCurrentTraderPos, fTrade);
            expect(fMaxTrade).equal(returnedMaxTrade);
        });

        it("should follow -Kstar if larger than other constraints", async () => {
            let fCurrentTraderPos = ONE_64x64.mul(-1);
            let fkStar = floatToABK64x64(-50);
            let fTraderExposureEMA = ONE_64x64.mul(1);
            let fBumpUp = ONE_64x64.add(ONE_64x64);
            let fTrade = floatToABK64x64(-12);
            // max pos = fBumpUp * fTraderExposureEMA = 2
            let fMaxTradeShort = fkStar.add(fkStar);
            await manager.setGenericPerpInt128(perpetualId, "fkStar", fkStar);
            await manager.setGenericPerpInt128(perpetualId, "fCurrentTraderExposureEMA", fTraderExposureEMA);
            await manager.setGenericPerpInt128(perpetualId, "fMaximalTradeSizeBumpUp", fBumpUp);
            // maxpos = 1*2 = 3
            let returnedMaxTrade = await manager.getMaxSignedTradeSizeForPos(perpetualId, fCurrentTraderPos, fTrade);
            expect(fMaxTradeShort).equal(returnedMaxTrade);
        });

        it("should scale down bump up id default fund not full", async () => {
            let pos = 7;
            let fCurrentTraderPos = ONE_64x64.mul(pos);
            let fkStar = ONE_64x64.mul(-50);
            let ema = 10;
            let fTraderExposureEMA = ONE_64x64.mul(ema);
            let bumpUp = 2;
            let fBumpUp = floatToABK64x64(bumpUp);
            let fTrade = floatToABK64x64(2); //2

            let maxPositionSize = mul64x64(fTraderExposureEMA, fBumpUp);
            let fMaxTradeLong = 0;
            let fMaxTradeShort = fkStar;

            await manager.setGenericPerpInt128(perpetualId, "fkStar", fkStar);
            await manager.setGenericPerpInt128(perpetualId, "fCurrentTraderExposureEMA", fTraderExposureEMA);
            await manager.setGenericPerpInt128(perpetualId, "fMaximalTradeSizeBumpUp", fBumpUp);
            // half full
            await manager.setDefaultFundCashCC(poolId, floatToABK64x64(10));
            await manager.setTargetDFSize(poolId, floatToABK64x64(20));
            let maxPosExpected = ((bumpUp * 10) / 20) * ema;
            let maxTradeExpected = floatToABK64x64(maxPosExpected - pos);
            let maxTradeSizeForPos = await manager.getMaxSignedTradeSizeForPos(perpetualId, fCurrentTraderPos, fTrade);
            let isEqual = equalForPrecision(maxTradeExpected, maxTradeSizeForPos, 15);
            if (!isEqual) {
                console.log("Expected max pos=", maxPosExpected);
                console.log("Expected max trade=", ABK64x64ToFloat(maxTradeExpected));
                console.log("Received max trade=", ABK64x64ToFloat(maxTradeSizeForPos));
            }
            expect(isEqual).to.be.true;
        });
    });

    describe("PerpetualTradeLogic.access", () => {
        let poolId;
        let perpetualId;
        let marginToken;

        before(async () => {
            manager = await createPerpetualManager(true, ["PerpetualTradeLogic"]);
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
            await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));
            perpetualId = await createPerpetual(manager, poolId);
            await manager.runLiquidityPool(poolId);
        });

        it("should fail if executeTrade invoked outside", async () => {
            await expect(manager.executeTrade(perpetualId, owner, 0, 0, 0, false)).to.be.revertedWith("can't be invoked outside");
        });

        it("should fail if preTrade invoked outside", async () => {
            let order = {iPerpetualId : perpetualId,
                traderAddr : owner,
                fAmount : BN.from(0),
                fLimitPrice : BN.from(0),
                fTriggerPrice : BN.from(0),
                iDeadline: Math.round(new Date() / 1000),
                referrerAddr : ZERO_ADDRESS,
                flags: BN.from(0),
                fLeverage:BN.from(0),
                createdTimestamp:BN.from(0)};
            await expect(manager.preTrade(perpetualId, order)).to.be.revertedWith("can't be invoked outside");
        });

        it("should fail if distributeFees invoked outside", async () => {
            let order = {iPerpetualId : perpetualId,
                traderAddr : owner,
                fAmount : BN.from(0),
                fLimitPrice : BN.from(0),
                fTriggerPrice : BN.from(0),
                iDeadline: Math.round(new Date() / 1000),
                referrerAddr : owner,
                flags: BN.from(0),
                fLeverage:BN.from(0),
                createdTimestamp:BN.from(0)};
            await expect(manager.distributeFees(order, false)).to.be.revertedWith("can't be invoked outside");
        });
    });

    describe("PerpetualMarginLogic.access", () => {
        let poolId;
        let perpetualId;
        let marginToken;

        before(async () => {
            manager = await createPerpetualManager(true, ["PerpetualTradeLogic"]);
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
            await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));
            perpetualId = await createPerpetual(manager, poolId);
            await manager.runLiquidityPool(poolId);
        });

        it("should fail if executeTrade depositMarginForOpeningTrade outside", async () => {
            let order: Order = createOrder(manager, perpetualId, 0, 0, 0, owner);
            await expect(manager.depositMarginForOpeningTrade(perpetualId, 0, order)).to.be.revertedWith("can't be invoked outside");
        });

        it("should fail if withdrawDepositFromMarginAccount invoked outside", async () => {
            await expect(manager.withdrawDepositFromMarginAccount(perpetualId, ZERO_ADDRESS)).to.be.revertedWith("can't be invoked outside");
        });
    });

    function createOrder(manager: Contract, perpetualId, tradeAmount, limitPrice, triggerPrice, account, referrer = ZERO_ADDRESS,
        deadline = null, leverage = null, flags = null) {
        type Order = {
            iPerpetualId: BytesLike;
            traderAddr: string;
            fAmount: BigNumberish;
            fLimitPrice: BigNumberish;
            fTriggerPrice: BigNumberish;
            iDeadline: BigNumberish;
            referrerAddr: string;
            flags: BigNumberish;
            fLeverage: BigNumberish;
            createdTimestamp: BigNumberish;
        };

        if (deadline == null) {
            deadline = Math.round(new Date() / 1000) + 86400;
        }
        if (leverage == null) {
            leverage = floatToABK64x64(0);
        }
        if (flags == null) {
            if (triggerPrice > 0)
                flags = MASK_STOP_ORDER;
            else
                flags = MASK_MARKET_ORDER;
        }

        let order: Order = {
            iPerpetualId: perpetualId,
            traderAddr: account,
            fAmount: tradeAmount,
            fLimitPrice: limitPrice,
            fTriggerPrice: triggerPrice,
            iDeadline: deadline,
            referrerAddr: referrer,
            flags: flags,
            fLeverage: leverage,
            createdTimestamp: Date.now(),
        };
        return order;
    }

    async function trade(manager: Contract, perpetualId, tradeAmount, limitPrice, account, referrer = ZERO_ADDRESS,
        deadline = null, leverage = null, flags = null, triggerPrice = 0) {

        let order: Order = createOrder(manager, perpetualId, tradeAmount, limitPrice, triggerPrice, account, referrer, deadline, leverage, flags);
        return await manager.trade(order);
    }

    async function tradeBySig(
        manager: Contract,
        perpetualId,
        tradeAmount,
        limitPrice,
        account,
        referrer = ZERO_ADDRESS,
        deadline = null,
        signSecondTime = false,
        cancelOrder = false,
        leverage = null,
        signer = accounts[0],
        flags = null,
        triggerPrice = null
    ) {
        const NAME = "Perpetual Trade Manager";

        let currentChainId = (await ethers.provider.getNetwork()).chainId;

        let createdTimestamp = Math.round(new Date() / 1000);
        if (deadline == null) {
            deadline = createdTimestamp + 86400;
        }
        if (leverage == null) {
            leverage = floatToABK64x64(0);
        }
        if (flags == null) {
            flags = MASK_MARKET_ORDER;
        }
        if (triggerPrice == null) {
            triggerPrice = floatToABK64x64(0);
        }
        let order = {
            iPerpetualId: perpetualId,
            traderAddr: account,
            fAmount: tradeAmount.toString(),
            fLimitPrice: limitPrice.toString(),
            fTriggerPrice: triggerPrice.toString(),
            iDeadline: deadline,
            referrerAddr: referrer,
            flags: flags.toNumber(),
            fLeverage: leverage.toString(),
            createdTimestamp: createdTimestamp,
        };

        let signature = createSignature(order, true, signer, manager.address);

        if (signSecondTime) {
            await manager.tradeBySig(order, signature);
        }
        if (cancelOrder) {
            let signatureCancel = createSignature(order, false, signer, manager.address);
            await manager.cancelOrder(order, signatureCancel);
        }

        return await manager.tradeBySig(order, signature);
    }


});
