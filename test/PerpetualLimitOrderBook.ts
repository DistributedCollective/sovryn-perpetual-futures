// @ts-nocheck
import { expect } from "chai";
const { ethers } = require("hardhat");
const abi = require("ethereumjs-abi");
import * as fs from "fs";
import { getAccounts, createContract, toBytes32 } from "../scripts/utils/utils";

import { createLiquidityPool, createPerpetual, getBTCBaseParams, createOracle, createPerpetualManagerForIT} from "./TestFactory";
import { floatToABK64x64, toDec18, COLLATERAL_CURRENCY_QUANTO, COLLATERAL_CURRENCY_BASE, PerpetualStateINITIALIZING, 
        floatToDec18, dec18ToFloat } from "../scripts/utils/perpMath";
import {contractOrderToOrder, getLastTradeDigest, executeLimitOrder, createOrder, postLimitOrder, createLimitOrder, createSignature} from "./tradeFunctionsAlt.ts"
import { BigNumberish, Contract } from "ethers";
import { BytesLike } from "@ethersproject/bytes";
import { keccak256 } from "ethereumjs-util";
import { number } from "mathjs";
const BN = ethers.BigNumber;
const ONE_64x64 = BN.from("0x010000000000000000");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MASK_LIMIT_ORDER = BN.from("0x04000000");
const ONE_DEC18 = BN.from(10).pow(BN.from(18));

describe("PerpetualLimitOrderBook", () => {
    let accounts, owner, manager;
    let orderBookImplementation, orderBookFactory, limitOrderBeacon, limitOrderBookLogic, limitOrderBookAddress;
    let limitOrderBook;
    let poolId, perpetualId;
    let marginToken;
    let mngrAddr;
    let chainId;

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

    before(async () => {
        accounts = await getAccounts();
        owner = accounts[0].address;
        manager = await createPerpetualManagerForIT();
        let poolData = await createLiquidityPool(manager, owner);
        poolId = poolData.id;
        marginToken = poolData.marginToken;
        await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));
        let s2 = 47200;
        let premium = 5;
        let oracles = await setupOracle(s2);
        perpetualId = await createPerpetual(manager, poolId, null, null, null, COLLATERAL_CURRENCY_BASE, oracles);
        let governanceAccount = accounts[2];
        // transfer 'some' tokens to governance
        await poolData.marginToken.mint(governanceAccount.address, ONE_DEC18.mul(100));
        await poolData.marginToken.connect(governanceAccount).approve(manager.address, ONE_DEC18.mul(1000));
        await manager.addAmmGovernanceAddress(governanceAccount.address);
        await manager.setPerpetualState(perpetualId, PerpetualStateINITIALIZING);
        await manager.connect(governanceAccount).addAMMLiquidityToPerpetual(perpetualId, floatToABK64x64(10));
        await manager.runLiquidityPool(poolId);

        await manager.setGenericPerpInt128(perpetualId, "fAMMFundCashCC", floatToABK64x64(5));
        await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(s2));
        await manager.setGenericPriceData(perpetualId, "currentPremiumRate", floatToABK64x64(premium/s2));
        await manager.setGenericPriceData(perpetualId, "currentMarkPremiumRate", floatToABK64x64(premium/s2));
        await manager.setGenericPriceData(perpetualId, "fCurrentTraderExposureEMA", floatToABK64x64(5));

        orderBookImplementation = await createContract("LimitOrderBook");
        orderBookFactory = await createContract("LimitOrderBookFactory", [orderBookImplementation.address]);
        limitOrderBookLogic = await orderBookFactory.getImplementation();

        //Deploy OrderBook
        let tx = await orderBookFactory.deployLimitOrderBookProxy(manager.address, perpetualId);
        await expect(tx).to.emit(orderBookFactory, "PerpetualLimitOrderBookDeployed");
        limitOrderBookAddress = await orderBookFactory.getOrderBookAddress(perpetualId);
        limitOrderBook = await ethers.getContractAt("LimitOrderBook", limitOrderBookAddress);
    });

    describe("createLimitOrder", () => {
        let fLockedInValueQC, fCashCC, traderPos, depositAmount, tradeAmount, limitPrice;
        let timestamp;
        before(async () => {
            fLockedInValueQC = ONE_64x64.mul(40000);
            fCashCC = ONE_64x64.mul(100000);
            traderPos = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);

            depositAmount = floatToABK64x64(3);
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            tradeAmount = depositAmount;
            limitPrice = floatToABK64x64(50000);

            await manager.setWhitelistActive(true);
            await manager.addToWhitelist([owner]);

            await marginToken.mint(manager.address, ONE_DEC18.mul(100));

        });

        it("should not create a limit order if trade address is 0", async () => {
            await expect(createLimitOrder(limitOrderBook, perpetualId, tradeAmount, limitPrice, ZERO_ADDRESS, accounts[0], manager.address, ZERO_ADDRESS)).to.be.revertedWith("invalid-trader");
            let num = await limitOrderBook.numberOfOrderBookDigests();
            expect(num).to.be.equal(0);
        });

        it("should not create a limit order if deadline is in the past", async () => {
            await expect(createLimitOrder(limitOrderBook, perpetualId, tradeAmount, limitPrice, owner, accounts[0], manager.address, Math.round(new Date() / 1000))).to.be.revertedWith("invalid-deadline");
        });

        it("should create a limit order", async () => {
            timestamp = Math.round(new Date() / 1000) + 1000;
            let res = await createLimitOrder(limitOrderBook, perpetualId, tradeAmount, limitPrice, owner, accounts[0], manager.address,
                timestamp + 20000, timestamp, accounts[3].address, null, false);
            let tx = res[0];
            let order = res[1];
            let digest = await getLastTradeDigest(owner, limitOrderBook);
            await expect(tx).to.emit(limitOrderBook, "PerpetualLimitOrderCreated").withArgs(order.iPerpetualId, 
                order.traderAddr, order.fAmount, order.fLimitPrice, 
                order.fTriggerPrice, order.iDeadline, order.referrerAddr, 
                order.flags, order.fLeverage, order.createdTimestamp, digest);
            let num = await limitOrderBook.numberOfOrderBookDigests();
            expect(num).to.be.equal(1);
        });

        it("should not create a duplicate limit order", async () => {
            //createLimitOrder(limitOrderBook: Contract, perpetualId, tradeAmount, limitPrice, account, signer, managerAddr : string, deadline, 
            //    createdTimestamp, referrer = ZERO_ADDRESS, leverage = null, executeOrder=false)
            //We use another referrer address (it must not matter)
            await expect(createLimitOrder(limitOrderBook, perpetualId, tradeAmount, limitPrice, owner, accounts[0], manager.address,
                timestamp + 20000, timestamp, accounts[4].address, null, false)).to.be.revertedWith("order-exists");
        });

        it("should create a second(different) limit order for the same trader", async () => {
            const timestamp = Math.round(new Date() / 1000) + 1000;
            let res = await createLimitOrder(limitOrderBook, perpetualId, tradeAmount, limitPrice, owner, accounts[0], manager.address, null, timestamp, ZERO_ADDRESS, null);
            let tx = res[0];
            let order = res[1];
            let digest = await getLastTradeDigest(owner, limitOrderBook)
            await expect(tx).to.emit(limitOrderBook, "PerpetualLimitOrderCreated").withArgs(order.iPerpetualId, 
                order.traderAddr, order.fAmount, order.fLimitPrice, 
                order.fTriggerPrice, order.iDeadline, order.referrerAddr, 
                order.flags, order.fLeverage, order.createdTimestamp, digest);
           
        });

        it("should show 2 limit order digests", async () => {
            let num = await limitOrderBook.numberOfOrderBookDigests();
            expect(num).to.be.equal(2);
        });

        it("should correctly return the orders in the orderbook", async () => {
            let orders, orderHashes;
            const bytes0 = ethers.constants.HashZero;
            ({ orders, orderHashes } = await limitOrderBook.pollLimitOrders(bytes0, 5));
            expect(orders[1].traderAddr).not.eql('0x0000000000000000000000000000000000000000'); // Non empty order
            expect(orders[2].traderAddr).equal('0x0000000000000000000000000000000000000000'); // Empty order
            expect(orderHashes[1]).not.eql('0x0000000000000000000000000000000000000000000000000000000000000000'); // Non empty order
            expect(orderHashes[2]).equal('0x0000000000000000000000000000000000000000000000000000000000000000'); // Empty order
        });

        it("should return the number of limit orders for a trader", async () => {
            let res = await createLimitOrder(limitOrderBook, perpetualId, tradeAmount.div(4), limitPrice, owner, accounts[0], manager.address,
                timestamp + 20000, timestamp, accounts[4].address, null, false);
            let order = res[1];
            expect(await limitOrderBook.numberOfDigestsOfTrader(owner)).equal(3);
            let digest = await getLastTradeDigest(owner, limitOrderBook);
            // cancel
            let sigTrader = await createSignature(order, false, accounts[0], manager.address, chainId);
            await expect(limitOrderBook.cancelLimitOrder(digest, sigTrader));
            // correct number?
            expect(await limitOrderBook.numberOfDigestsOfTrader(owner)).equal(2);
        });
        


        it("should return the number of all limit orders", async () => {
            // returns all digests, also cancelled ones
            expect(await limitOrderBook.numberOfAllDigests()).equal(3);
        });

        it("should return an array of digests of orders of a trader", async () => {
            let orders = await limitOrderBook.limitDigestsOfTrader(owner, 0, 2);
            expect(orders.length).equal(2);
        });

        it("should return an array of all digests", async () => {
            let orders = await limitOrderBook.allLimitDigests(0, 2);
            expect(orders.length).equal(2);
        });

        it("should return the address of trader for an order digest", async () => {
            let orders = await limitOrderBook.allLimitDigests(0, 1);
            let traderAddr = await limitOrderBook.getTrader(orders[0]);
            expect(traderAddr).equal(owner);
        });

        it("should return the address of trader for an order digest", async () => {
            let orders = await limitOrderBook.allLimitDigests(0, 1);
            let traderAddr = await limitOrderBook.getTrader(orders[0]);
            expect(traderAddr).equal(owner);
        });

        it("should return all order details of a trader", async () => {
            let orders = await limitOrderBook.getOrders(owner, 0, 2);
            expect(orders.length).equal(2);
        });

        it("should return the signature of trader for an order digest", async () => {
            let allLimitDigests = await limitOrderBook.allLimitDigests(0, 5);
            let signatueOfOrder1 = await limitOrderBook.getSignature(allLimitDigests[0]);
            let signatueOfOrder2 = await limitOrderBook.getSignature(allLimitDigests[1]);
            expect(signatueOfOrder1).not.eql(undefined);
            expect(signatueOfOrder2).not.eql(undefined);
        });

        it("should not allow too many orders", async () => {
            let trader = accounts[5].address;
            for(var k=0; k<16; k++) {
                const timestamp = Math.round(new Date() / 1000) + k;
                //console.log("k=",k)
                if(k==15) {
                    await expect(
                        createLimitOrder(limitOrderBook, perpetualId, tradeAmount, limitPrice, trader, accounts[5], manager.address, null, timestamp, ZERO_ADDRESS, null)
                      ).to.be.revertedWith("max num orders for trader exceeded");
                } else {
                    await createLimitOrder(limitOrderBook, perpetualId, tradeAmount, limitPrice, trader, accounts[5], manager.address, null, timestamp, ZERO_ADDRESS, null);
                }
            }
            
        });
    });

    describe("executeLimitOrder", () => {
        let fLockedInValueQC, fCashCC, traderPos, depositAmount, tradeAmount, limitPrice, trader;

        

        before(async () => {
            // give the test trader some tokens
            trader = accounts[3];
            let governanceAccount = accounts[2];
            await marginToken.mint(governanceAccount.address, ONE_DEC18.mul(100));
            await marginToken.connect(governanceAccount).transfer(trader.address, ONE_DEC18.mul(4));
            
            fLockedInValueQC = ONE_64x64.mul(40000);
            fCashCC = ONE_64x64.mul(100000);
            traderPos = ONE_64x64.mul(2);
            await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);

            depositAmount = floatToABK64x64(1);
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            tradeAmount = 0.5*depositAmount;
            limitPrice = floatToABK64x64(50000);

            await manager.setWhitelistActive(true);
            await manager.addToWhitelist([owner]);
        });

        it("wrong order book", async () => {
            const timestamp = Math.round(new Date() / 1000) + 1500;
            let fakeId = await createPerpetual(manager, poolId, null, null, null, COLLATERAL_CURRENCY_BASE);
            let tx = createLimitOrder(limitOrderBook, fakeId, tradeAmount, limitPrice, owner, 
                accounts[0], manager.address, null, timestamp, ZERO_ADDRESS, null, true);
            await expect(tx).to.be.revertedWith("order should be sent to correct order book");
        });
        
        it("should execute order", async () => {
            const timestamp = Math.round(new Date() / 1000) + 1500;
            let res = await createLimitOrder(limitOrderBook, perpetualId, tradeAmount, limitPrice, owner, accounts[0], manager.address, null, timestamp, ZERO_ADDRESS, null, true);
            let tx = res[0];
            await expect(tx).to.emit(manager, "Trade");
            await expect(tx).to.emit(manager, "RealizedPnL");
        });

        it("should remove order if the order is expired", async () => {
            const timestamp = Math.round(new Date() / 1000) + 2300;
            let digests = await limitOrderBook.limitDigestsOfTrader(owner, 0, 20);
            let numOrders = digests.filter(el => !el.startsWith("0x00000")).length;
            tradeAmount = -0.01*depositAmount;
            limitPrice = floatToABK64x64(40000);
            let tx = await createLimitOrder(limitOrderBook, perpetualId, tradeAmount, limitPrice, owner, accounts[0], manager.address, timestamp + 1000, timestamp, ZERO_ADDRESS, null, true);
            let digestsAfter = await limitOrderBook.limitDigestsOfTrader(owner, 0, 20);
            let numOrdersAfter = digestsAfter.filter(el => !el.startsWith("0x00000")).length;
            expect(numOrdersAfter).equal(numOrders); // Cancelled order was not added
        });

       

        it("should execute leveraged limit order", async () => {
            const timestamp = Math.round(new Date() / 1000) + 1500;
            const deadline = Math.round(new Date() / 1000) + 86400;
            let tradeNotional = 0.32;
            let fTradeNotional = floatToABK64x64(tradeNotional);
            await manager.addToWhitelist([trader.address]);
            let fLeverage = floatToABK64x64(2);
            
            let limitPrice = floatToABK64x64(90000);
            let order = createOrder(perpetualId, fTradeNotional, limitPrice, trader.address, deadline, timestamp, ZERO_ADDRESS, fLeverage); 
            let allowance = tradeNotional*1.05;
            
            let tx = await postLimitOrder(marginToken, limitOrderBook, order, trader, manager.address, false, allowance);
            // trade
            let d18Balance = await marginToken.balanceOf(trader.address);
            //console.log("balance = ", dec18ToFloat(d18Balance));
            let tx2 = await executeLimitOrder(limitOrderBook, order);
            await expect(tx2).to.emit(manager, "Trade");
        });

        it("should cancel defunded order", async () => {
            const timestamp = Math.round(new Date() / 1000) + 1500;
            const deadline = Math.round(new Date() / 1000) + 86400;
            
            // set position and deposit to zero:
            await manager.setMarginAccount(perpetualId, trader.address, 0, 0, 0);

            let tradeNotional = 0.123;
            let fTradeNotional = floatToABK64x64(tradeNotional);
            await manager.addToWhitelist([trader.address]);
            let fLeverage = floatToABK64x64(2);
            let limitPrice = floatToABK64x64(90000);
            let order = createOrder(perpetualId, fTradeNotional, limitPrice, trader.address, deadline, timestamp, ZERO_ADDRESS, fLeverage); 
            let allowance = tradeNotional*1.05;
            let tx = await postLimitOrder(marginToken, limitOrderBook, order, trader, manager.address, false, allowance);
            // defund: send all tokens from trader to address[0]
            let d18Balance = await marginToken.balanceOf(trader.address);
            
            await marginToken.connect(trader).approve(owner, d18Balance);
            await marginToken.connect(trader).transfer(accounts[0].address, d18Balance.mul(99).div(100));
            // trade
            let tx2 = await executeLimitOrder(limitOrderBook, order);
            await expect(tx2).to.emit(manager, "PerpetualLimitOrderCancelled");
        });

        it("should cancel order with too small allowance", async () => {
            const timestamp = Math.round(new Date() / 1000) + 1500;
            const deadline = Math.round(new Date() / 1000) + 86400;
            let trader = accounts[3];
            let tradeNotional = 0.321;
            let fTradeNotional = floatToABK64x64(tradeNotional);
            await manager.addToWhitelist([trader.address]);
            let fLeverage = floatToABK64x64(2);
            let fLimitPrice = floatToABK64x64(90000);
            let order = createOrder(perpetualId, fTradeNotional, fLimitPrice, trader.address, deadline, timestamp, ZERO_ADDRESS, fLeverage); 
            let allowance = tradeNotional*2*1.05;
            let tx = await postLimitOrder(marginToken, limitOrderBook, order, trader, manager.address, false, allowance);
            // trade
            let tx2 = await executeLimitOrder(limitOrderBook, order);
            await expect(tx2).to.emit(manager, "PerpetualLimitOrderCancelled");
            // trade via digest
            order.createdTimestamp = order.createdTimestamp + 1500
            tx = await postLimitOrder(marginToken, limitOrderBook, order, trader, manager.address, false, allowance);
            let digests = await limitOrderBook.limitDigestsOfTrader(order.traderAddr, 0, 10);
            let tx3 = await executeLimitOrder(limitOrderBook, order, digests[0]);
            await expect(tx3).to.emit(manager, "PerpetualLimitOrderCancelled");
        });

        
    });

    describe("upgradeImplementation", () => {
        let fLockedInValueQC, fCashCC, traderPos, depositAmount, tradeAmount, limitPrice;
        let limitOrderBookNew;

        before(async () => {
            fLockedInValueQC = ONE_64x64.mul(40000);
            fCashCC = ONE_64x64.mul(100000);
            traderPos = ONE_64x64.mul(1);
            await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);

            depositAmount = floatToABK64x64(1);
            await marginToken.approve(manager.address, toDec18(depositAmount));
            await manager.deposit(perpetualId, depositAmount);

            tradeAmount = depositAmount;
            limitPrice = floatToABK64x64(50000);

            await manager.setWhitelistActive(true);
            await manager.addToWhitelist([owner]);
        });

        it("should upgrade implementation", async () => {
            let limitOrderBookLogicOld = await orderBookFactory.getImplementation();
            let orderBookImplementationNew = await createContract("MockLimitOrderBook");
            let limitOrderBeaconAddress = await orderBookFactory.getBeacon();
            limitOrderBeacon = await ethers.getContractAt("LimitOrderBookBeacon", limitOrderBeaconAddress);
            await limitOrderBeacon.update(orderBookImplementationNew.address);
            let limitOrderBookLogicNew = await orderBookFactory.getImplementation();

            expect(limitOrderBookLogicOld).not.eql(limitOrderBookLogicNew);
        });

        it("should create limit order using new implementation and new functions should be usable", async () => {
            limitOrderBookNew = await ethers.getContractAt("MockLimitOrderBook", limitOrderBookAddress);
            let res = await createLimitOrder(limitOrderBookNew, perpetualId, tradeAmount, limitPrice, owner, accounts[0], manager.address);
            let tx = res[0];
            let order = res[1];
            let digest = await getLastTradeDigest(owner, limitOrderBookNew);
            await expect(tx).to.emit(limitOrderBookNew, "PerpetualLimitOrderCreated").withArgs(order.iPerpetualId, 
                order.traderAddr, order.fAmount, order.fLimitPrice, 
                order.fTriggerPrice, order.iDeadline, order.referrerAddr, 
                order.flags, order.fLeverage, order.createdTimestamp, digest);
            let allOrders = await limitOrderBookNew.getAllOrders(0, 5); // New function - getAllOrders
            expect(allOrders.length).to.equal(5);
        });

        it("should deploy new orderbook using latest implementation", async () => {
            let baseParamsBTC = getBTCBaseParams();
            let perpetualIdNew = await createPerpetual(manager, poolId, baseParamsBTC, null, null, COLLATERAL_CURRENCY_QUANTO);

            await orderBookFactory.deployLimitOrderBookProxy(manager.address, perpetualIdNew);
            let limitOrderBookAddressNew = await orderBookFactory.getOrderBookAddress(perpetualIdNew);
            let limitOrderBookLatest = await ethers.getContractAt("MockLimitOrderBook", limitOrderBookAddressNew);

            let res = await createLimitOrder(limitOrderBookLatest, perpetualIdNew, tradeAmount, limitPrice, owner, accounts[0], manager.address);
            let tx = res[0];
            let order = res[1];
            let digest = await getLastTradeDigest(owner, limitOrderBookLatest);
            await expect(tx).to.emit(limitOrderBookLatest, "PerpetualLimitOrderCreated").withArgs(order.iPerpetualId, 
                order.traderAddr, order.fAmount, order.fLimitPrice, 
                order.fTriggerPrice, order.iDeadline, order.referrerAddr, 
                order.flags, order.fLeverage, order.createdTimestamp, digest);
            let allPreviousOrders = await limitOrderBookNew.getAllOrders(0, 5); // New function - getAllOrders
            expect(allPreviousOrders.length).to.equal(5); // Existing orders in the old orderbook

            let allOrders = await limitOrderBookLatest.getAllOrders(0, 1); // New function - getAllOrders
            expect(allOrders.length).to.equal(1); // Only one order for latest deployed order book
        })

        it("should return orders using correct sequence from the list", async () => {
            let orders, orderHashes;
            ({ orders, orderHashes } = await limitOrderBook.pollLimitOrders("0x0000000000000000000000000000000000000000000000000000000000000000", 2));
            let oldHash = orderHashes[0];
            ({ orders, orderHashes } = await limitOrderBook.pollLimitOrders(orderHashes[1], 2));
            let newHash = orderHashes[0];
            expect(oldHash).not.equal.toString(newHash);
        });

        it("should not allow cancel order by anyone but the trader", async () => {
            let orders, orderHashes;
            ({ orders, orderHashes } = await limitOrderBook.pollLimitOrders(toBytes32(0), 4));
            let order = contractOrderToOrder(orders[0]);
            let sigTrader = await createSignature(order, false, accounts[0], manager.address, chainId);
            let sigWrong = await createSignature(order, true, accounts[0], manager.address, chainId);
            let sigElse = await createSignature(order, false, accounts[2], manager.address, chainId);
            await expect(limitOrderBook.cancelLimitOrder(orderHashes[0], sigWrong)).to.be.revertedWith("trader must sign cancel order");
            await expect(limitOrderBook.cancelLimitOrder(orderHashes[0], sigElse)).to.be.revertedWith("trader must sign cancel order");
            await expect(limitOrderBook.cancelLimitOrder(orderHashes[0], sigTrader)).to.emit(manager, "PerpetualLimitOrderCancelled").withArgs(orderHashes[0]);
        });

        it("should cancel the first order and remove it from the list", async () => {
            let orders, orderHashes;
            let oldHash, newHash;
            ({ orders, orderHashes } = await limitOrderBook.pollLimitOrders(toBytes32(0), 4));
            oldHash = orderHashes[0];
            expect(owner).to.be.equal(accounts[0].address);
            expect(owner).to.be.equal(orders[0].traderAddr);
            let order = contractOrderToOrder(orders[0]);

            let sigTrader = await createSignature(order, false, accounts[0], manager.address, chainId);
            await limitOrderBook.cancelLimitOrder(orderHashes[0], sigTrader);
            ({ orders, orderHashes } = await limitOrderBook.pollLimitOrders(toBytes32(0), 4));
            newHash = orderHashes[0];
            expect(oldHash).not.equal.toString(newHash);
        });
    });

    

    
});