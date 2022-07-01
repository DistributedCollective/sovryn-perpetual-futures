// @ts-nocheck
import { expect } from "chai";
const { ethers } = require("hardhat");
const abi = require("ethereumjs-abi");
import { getAccounts, createContract, toBytes32 } from "../scripts/utils/utils";
import { queryTraderState, queryAMMState, queryPerpParameters, getTraderOrders } from "../scripts/utils/perpQueries";
import { getTraderLeverage, getPrice, getEstimatedMarginCollateralForTrader, getMarkPrice, getTradingFeeRate, getInitialMarginRate } from "../scripts/utils/perpUtils";
import { createLiquidityPool, createPerpetual, createPerpetualManager, createOracle, createPerpetualManagerForIT} from "./TestFactory";
import { floatToABK64x64, toDec18, COLLATERAL_CURRENCY_QUANTO, COLLATERAL_CURRENCY_BASE, ABK64x64ToFloat, 
    PerpetualStateINITIALIZING, equalForPrecisionFloat, getDepositAmountForLvgTrade } from "../scripts/utils/perpMath";
import {createLimitOrder, combineFlags,
    MASK_CLOSE_ONLY,
    MASK_MARKET_ORDER,
    MASK_STOP_ORDER,
    MASK_KEEP_POS_LEVERAGE,
    MASK_LIMIT_ORDER} from "./tradeFunctionsAlt.ts"
import {trade} from "./tradeFunctions.ts"
const BN = ethers.BigNumber;
const ONE_64x64 = BN.from("0x010000000000000000");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ONE_DEC18 = BN.from(10).pow(BN.from(18));

describe("PerpetualLimitOrderBookExt", () => {
    let accounts, owner, manager;
    let orderBookImplementation, orderBookFactory, limitOrderBeacon, limitOrderBookLogic, limitOrderBookAddress;
    let limitOrderBook;
    let poolId, perpetualId;
    let marginToken;
    let poolData;
    let s2;

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
        poolData = await createLiquidityPool(manager, owner);
        poolId = poolData.id;
        marginToken = poolData.marginToken;
        await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));
        let premium = 2;
        s2 = 47200; 
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

        await marginToken.transfer(accounts[1].address, ONE_DEC18.mul(5));
        await marginToken.transfer(accounts[2].address, ONE_DEC18.mul(5));
        await marginToken.transfer(accounts[3].address, ONE_DEC18.mul(5));

        orderBookImplementation = await createContract("LimitOrderBook");
        orderBookFactory = await createContract("LimitOrderBookFactory", [orderBookImplementation.address]);
        limitOrderBookLogic = await orderBookFactory.getImplementation();

        //Deploy OrderBook
        await orderBookFactory.deployLimitOrderBookProxy(manager.address, perpetualId);
        limitOrderBookAddress = await orderBookFactory.getOrderBookAddress(perpetualId);
        limitOrderBook = await ethers.getContractAt("LimitOrderBook", limitOrderBookAddress);

        let fLockedInValueQC = ONE_64x64.mul(40000);
        let fS2 = floatToABK64x64(s2);
        let fCashCC = ONE_64x64.mul(100000);
        let traderPos = ONE_64x64.mul(2);
        await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);
        await manager.setGenericPriceData(perpetualId, "indexS2PriceData", fS2);
        await manager.setUnitAccumulatedFunding(perpetualId, 0);
        await manager.setGenericPerpInt128(perpetualId, "fAMMFundCashCC", floatToABK64x64(25));
        await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(s2));
        await manager.setGenericPriceData(perpetualId, "currentPremiumRate", floatToABK64x64(premium/s2));
        await manager.setGenericPriceData(perpetualId, "currentMarkPremiumRate", floatToABK64x64(premium/s2));
        await manager.setGenericPriceData(perpetualId, "fCurrentTraderExposureEMA", floatToABK64x64(5));
    });

    describe("test leverage", () => {
        let fLockedInValueQC, fCashCC, traderPos, fDepositAmount, tradeAmount, limitPrice;
        let trader1, trader2, trader3;
        before(async () => {
            trader1 = accounts[1];
            trader2 = accounts[2];
            trader3 = accounts[3];
            fLockedInValueQC = ONE_64x64.mul(0);
            fCashCC = ONE_64x64.mul(0);
            traderPos = ONE_64x64.mul(0);
            let depositAmount = 2;
            fDepositAmount = floatToABK64x64(depositAmount);
            tradeAmount = floatToABK64x64(1);
            limitPrice = floatToABK64x64(20000);
            await manager.setMarginAccount(perpetualId, trader1.address, fLockedInValueQC, fCashCC, traderPos);
            await manager.setMarginAccount(perpetualId, trader2.address, fLockedInValueQC, fCashCC, traderPos);
            await manager.setMarginAccount(perpetualId, trader3.address, fLockedInValueQC, fCashCC, traderPos);
            await poolData.marginToken.connect(trader1).approve(manager.address, ONE_DEC18.mul(depositAmount));
            await poolData.marginToken.connect(trader2).approve(manager.address, ONE_DEC18.mul(depositAmount));   
            await poolData.marginToken.connect(trader3).approve(manager.address, ONE_DEC18.mul(depositAmount));                
        });

        it("should execute long order when limit price higher than market", async () => {
            const timestamp = Math.round(new Date() / 1000) + 1500;
            let tradeAmt = 1;
            let targetLvg = 2;
            let fLeverage = floatToABK64x64(targetLvg);
            let signer = trader1;
            limitPrice = floatToABK64x64(50000);
            let fTradeAmount = floatToABK64x64(tradeAmt);
            let perpParams = await queryPerpParameters(manager, perpetualId);
            let ammData = await queryAMMState(manager, perpetualId);
            let price = getPrice(tradeAmt, perpParams, ammData);
            let Sm = getMarkPrice(ammData);
            let S2 = ammData.indexS2PriceDataOracle;
            let depExpected = getDepositAmountForLvgTrade(0, 0, tradeAmt, 2, price, S2, Sm);
            let depExpectedAFees = depExpected + tradeAmt * getTradingFeeRate(perpParams) + perpParams.fReferralRebateCC;
            let initialMgnRate = getInitialMarginRate(tradeAmt, perpParams);
            let initialMgn = tradeAmt * initialMgnRate;

            let b0 = tradeAmt * (Sm - price)/S2 + depExpected;
            let b02 = tradeAmt * (Sm - price)/S2 + depExpectedAFees;
            if (false) {
                console.log("ammData = ", ammData);
                console.log("perpParams = ", perpParams);
                console.log("initialMgn = ", initialMgn);
                console.log("b0 = ", b0);
                console.log("b02 = ", b02);
                console.log("price = ", price);
                console.log("S2 = ", ammData.indexS2PriceDataOracle);
                console.log("Sm = ", Sm);
                console.log("Deposit expected = ", depExpected);
                console.log("Deposit expected after fees = ", depExpectedAFees);
            }
            //createLimitOrder(limitOrderBook: Contract, perpetualId, tradeAmount, limitPrice, account, signer, 
            //  managerAddr : string, deadline, createdTimestamp, referrer = ZERO_ADDRESS, 
            //  leverage = null, executeOrder=false) {
            let res = await createLimitOrder(limitOrderBook, perpetualId, fTradeAmount, limitPrice, trader1.address, accounts[1], manager.address,
                null, timestamp, trader2.address, fLeverage, signer, true);
            let tx = res[0];
            expect(tx).to.emit(manager, "TokensDeposited");
            expect(tx).to.emit(manager, "Trade");
            let ammData2 = await queryAMMState(manager, perpetualId);
            let traderState2 = await queryTraderState(manager, perpetualId, trader1.address);
            let lvg2 = getTraderLeverage(traderState2, ammData2);
            let isEqual = equalForPrecisionFloat(targetLvg, lvg2, 2);
            if(true || !isEqual) {
                console.log("realized leverage = ", lvg2);
                console.log("target leverage = ", targetLvg);
            }
        });
        
        it("should *not* execute long order with limit price lower than market", async () => {
            const timestamp = Math.round(new Date() / 1000) + 1500;
            let leverage = floatToABK64x64(2);
            let signer = trader1;
            //> check balance: let balanceBefore = await marginToken.balanceOf(trader1.address);
            limitPrice = floatToABK64x64(20000);
            //limitOrderBook: Contract, perpetualId, tradeAmount, limitPrice, account, 
            //deadline, createdTimestamp, referrer = ZERO_ADDRESS, leverage = null, signer, executeOrder, cancelOrder) 
            let tx = createLimitOrder(limitOrderBook, perpetualId, tradeAmount, limitPrice, trader1.address, accounts[1], manager.address,
                null, timestamp, ZERO_ADDRESS, leverage, signer, true);
            await expect(tx).to.be.revertedWith("price exceeds limit");
        });

        it("should have correct leverage", async () => {
            let traderState = await queryTraderState(manager, perpetualId, trader1.address);
            let ammState = await queryAMMState(manager, perpetualId);
            let lvg = getTraderLeverage(traderState, ammState);
            let isEqual = equalForPrecisionFloat(lvg, 2, 4);
            if (!isEqual) {
                console.log("target lvg=", 2)
                console.log("realized lvg = ", lvg)
            }
            expect(isEqual).to.be.true;
        });

        it("should keep leverage when reducing position", async () => {
            const timestamp = Math.round(new Date() / 1000) + 1500;
            let traderState = await queryTraderState(manager, perpetualId, trader1.address);
            let ammState = await queryAMMState(manager, perpetualId);
            let perpParams = await queryPerpParameters(manager, perpetualId);
            let lvg = getTraderLeverage(traderState, ammState);
            let irrelevantLeverage = floatToABK64x64(3);
            let tradeAmount = -traderState.marginAccountPositionBC/2;
            let px = getPrice(tradeAmount, perpParams, ammState);
            let limitPrice = (px * (1+Math.sign(tradeAmount)*0.01));
            
            let signer = trader1;
            let res = await createLimitOrder(limitOrderBook, perpetualId, floatToABK64x64(tradeAmount), 
                floatToABK64x64(limitPrice), trader1.address, accounts[1], manager.address,
                null, timestamp, ZERO_ADDRESS, irrelevantLeverage, signer, true);
            let tx = res[0];
            expect(tx).to.emit(manager, "Trade");
            
            let traderState2 = await queryTraderState(manager, perpetualId, trader1.address);
            let ammState2 = await queryAMMState(manager, perpetualId);
            let lvg2 = getTraderLeverage(traderState2, ammState2);
            let isEqual = equalForPrecisionFloat(lvg, lvg2, 2);
            if(!isEqual) {
                console.log("New leverage = ", lvg2);
                console.log("New position size = ", traderState2.marginAccountPositionBC);
                console.log("Old leverage = ", lvg);
                console.log("Old position size = ", traderState.marginAccountPositionBC);
            }
            expect(isEqual).to.be.true;
        });
        it("should trade maximal leverage", async () => {
            const timestamp = Math.round(new Date() / 1000) + 1500;
            let perpParams = await queryPerpParameters(manager, perpetualId);
            let tradeAmount = 0.5;
            let leverage = 9.99999;
            
            let signer = trader2;
            let ammState = await queryAMMState(manager, perpetualId);
            let px = getPrice(tradeAmount, perpParams, ammState);
            let limitPrice = (px * (1+Math.sign(tradeAmount)*0.01));
            
            let res = await createLimitOrder(limitOrderBook, perpetualId, floatToABK64x64(tradeAmount), floatToABK64x64(limitPrice), 
                trader2.address, accounts[2], manager.address, null, timestamp, accounts[2].address, floatToABK64x64(leverage), signer, true);
            let tx = res[0];
            await expect(tx).to.emit(manager, "Trade");
            let traderState2 = await queryTraderState(manager, perpetualId, trader2.address);
            let ammState2 = await queryAMMState(manager, perpetualId);
            let lvg2 = getTraderLeverage(traderState2, ammState2);
            let isEqual = equalForPrecisionFloat(leverage, lvg2, 3);
            if(!isEqual) {
                console.log("px = ", px, "s2=", ammState.indexS2PriceData, "limit=",limitPrice);
                console.log("New leverage = ", lvg2);
            }
        });

        it("should have enough margin for 2 limit and 1 market orders", async () => {
            const timestamp = Math.round(new Date() / 1000) + 1500;
            let perpParams = await queryPerpParameters(manager, perpetualId);
            let ammData = await queryAMMState(manager, perpetualId);
            let tradeAmountLong = 0.01;
            let tradeAmountShort = -0.01;
            let tradeAmountMarket = 0.01;
            let leverage = 9.99999;
            
            let signer = trader3;
            let ammState = await queryAMMState(manager, perpetualId);
            let px = getPrice(tradeAmountLong, perpParams, ammState);
            let limitPriceLong = (px * (1 + Math.sign(tradeAmountLong)*0.01));
            let limitPriceShort = (px * (1 + Math.sign(tradeAmountShort)*0.01));
            // a limit buy
            let tx1 = createLimitOrder(limitOrderBook, perpetualId, floatToABK64x64(tradeAmountLong), floatToABK64x64(limitPriceLong), 
                trader3.address, accounts[3], manager.address, null, timestamp, accounts[2].address, floatToABK64x64(leverage), signer, false);
            // a limit sell
            let tx2 = createLimitOrder(limitOrderBook, perpetualId, floatToABK64x64(tradeAmountShort), floatToABK64x64(limitPriceShort), 
                trader3.address, accounts[3], manager.address, null, timestamp+1, accounts[2].address, floatToABK64x64(leverage), signer, false);
            
            let traderState = await queryTraderState(manager, perpetualId, trader3.address);
            let traderOrders = await getTraderOrders(limitOrderBook, signer.address);
                        
            let marginRequired = await getEstimatedMarginCollateralForTrader(
                tradeAmountMarket,
                10,
                traderOrders,
                perpParams,
                ammData,
                traderState,
                0.0015);
            
            
            console.log("marginRequired=", marginRequired);
            console.log("traderState.availableMarginCC=", traderState.availableMarginCC);

            // if (traderState.availableMarginCC < marginRequired) {
            //     await expect(tx).to.be.revertedWith("trader margin unsafe");
            // } else {
            //     await expect(tx).to.emit(manager, "Trade");
            // }
        });

        it("should set trade leverage when flipping position sign", async () => {
            //trade(manager: Contract, perpetualId, tradeAmount, limitPrice, account, referrer = ZERO_ADDRESS, 
            //    deadline = null, leverage = null, flags = null, triggerPrice = 0)
            let traderState = await queryTraderState(manager, perpetualId, trader1.address);
            let ammState = await queryAMMState(manager, perpetualId);
            
            let pos = traderState.marginAccountPositionBC;
            let tradeAmount =  pos - Math.sign(pos) * (pos + 0.75);
            let leverage = 4.5; 
            let limitPrice = s2 * 0.9
            let flags = combineFlags(MASK_MARKET_ORDER, MASK_KEEP_POS_LEVERAGE);
            let tx = await trade(manager, perpetualId, floatToABK64x64(tradeAmount), floatToABK64x64(limitPrice), trader1, ZERO_ADDRESS,
                null, floatToABK64x64(leverage), flags);
            let traderState2 = await queryTraderState(manager, perpetualId, trader1.address);
            let ammState2 = await queryAMMState(manager, perpetualId);
            let lvg2 = getTraderLeverage(traderState2, ammState2);
            let isEqual = equalForPrecisionFloat(leverage, lvg2, 3);
            if(!isEqual) {
                console.log(traderState);
                console.log("flags = ", flags.toString())
                console.log("initial pos = ", pos);
                console.log("trade amount = ", tradeAmount);
                console.log("new pos = ", traderState2.marginAccountPositionBC);
                console.log("New leverage = ", lvg2);
                console.log("trader state=", traderState2);
                console.log("amm state=", ammState2);
            }
        });
        
    });
});
