// @ts-nocheck
import { expect } from "chai";
const { ethers } = require("hardhat");
const abi = require("ethereumjs-abi");
const ethUtil = require("ethereumjs-util");
import { getAccounts, toBytes32, createContract } from "../scripts/utils/utils";
import { createLiquidityPool, createPerpetualManager, createPerpetual} from "./TestFactory";
import {createLiquidityPool, createOracle, createPerpetualForIT, createPerpetualManagerForIT} from "./TestFactory";
import {
    ABK64x64ToFloat, COLLATERAL_CURRENCY_BASE,
    COLLATERAL_CURRENCY_QUANTO,
    COLLATERAL_CURRENCY_QUOTE,
    div64x64,add64x64,
    equalForPrecision,
    floatToABK64x64,
    mul64x64,
    roundToLot,
    roundToLotBN,
    toDec18,
    equalForPrecisionFloat,
    sub64x64,
    fromDec18,
    dec18ToFloat,
    PerpetualStateINITIALIZING,
    calculateMarginBalance,
    calculateInitialMarginRate,
    getDepositAmountForLvgTrade
} from "../scripts/utils/perpMath";
import { queryTraderState, queryAMMState, queryPerpParameters, getTraderOrders } from "../scripts/utils/perpQueries";
import {calculateSlippagePrice, getMaintenanceMarginRate, getMaxInitialLeverage, 
    getTraderLeverage, getPrice, getTradingFeeRate, getMarkPrice} from "../scripts/utils/perpUtils";
//import {createOracle, createPerpetual} from "../scripts/deployment/deploymentUtil";
import {PERPETUAL_ID} from "../scripts/deployment/contracts";
import {BigNumberish, Contract} from "ethers";
import {BytesLike} from "@ethersproject/bytes";
import { TypedDataUtils } from 'ethers-eip712';
import {or} from "mathjs";
import ethUtil, {keccak256} from "ethereumjs-util";

const BN = ethers.BigNumber;

const ONE_DEC18 = BN.from(10).pow(BN.from(18));
const ONE_64x64 = BN.from("0x010000000000000000");
const DOT_ONE_64x64 = ONE_64x64.div(BN.from("10")); //BN.from("0x016345785d8a0000");

const DECIMALS = BN.from(10).pow(BN.from(18));

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const MASK_CLOSE_ONLY = BN.from("0x80000000");
const MASK_MARKET_ORDER = BN.from("0x40000000");
const MASK_STOP_ORDER = BN.from("0x20000000");
const MASK_KEEP_POS_LEVERAGE = BN.from("0x08000000");
const MASK_LIMIT_ORDER = BN.from("0x04000000");

const PERPETUAL_STATE_INVALID = 0;
const PERPETUAL_STATE_INITIALIZING = 1;
const PERPETUAL_STATE_NORMAL = 2;
const PERPETUAL_STATE_EMERGENCY = 3;
const PERPETUAL_STATE_CLEARED = 4;

describe("PerpetualTradeFunctions", () => {
    let accounts, owner;
    let manager;
    let poolId, perpetualId;
    let marginToken;

    before(async () => {
        accounts = await getAccounts();
        owner = accounts[0].address;

        manager = await createPerpetualManager(false, ["MockWithoutRestrictionPerpetualTradeLogic"]);
        let poolData = await createLiquidityPool(manager, owner);
        poolId = poolData.id;
        marginToken = poolData.marginToken;
        await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));
        perpetualId = await createPerpetual(manager, poolId);
        await manager.runLiquidityPool(poolId);
    });

    it("should execute trade (close position)", async () => {
        let fLockedInValueQC = ONE_64x64.mul(40000);
        let S2 = 41000
        let px = 41000
        let fS2 = floatToABK64x64(S2);
        let dPos = 3;
        let fCashCC = ONE_64x64.mul(100000);
        let traderPos = ONE_64x64.mul(2);
        await manager.setMarginAccount(perpetualId, owner, fLockedInValueQC, fCashCC, traderPos);
        await manager.setGenericPriceData(perpetualId, "indexS2PriceData", fS2);

        await manager.setUnitAccumulatedFunding(perpetualId, 0);
        let marginBefore = await manager.getMarginAccount(perpetualId, owner);
        let ammBefore = await manager.getMarginAccount(perpetualId, manager.address);

        let fTradeAmount = ONE_64x64.mul(dPos);
        let fPrice = floatToABK64x64(px);
        let fPremium = (px-S2)*dPos/S2;

        await manager.executeTrade(perpetualId, owner, traderPos, fTradeAmount, fPrice, false);
        let deltaLockedValue = mul64x64(fTradeAmount, fS2);
        let dCashExpected = -(fPremium);


        let marginAfter = await manager.getMarginAccount(perpetualId, owner);
        
        expect(marginAfter.fPositionBC.sub(marginBefore.fPositionBC)).equal(fTradeAmount);
        let fDeltaCashCC = sub64x64(marginAfter.fCashCC, marginBefore.fCashCC)
        let dCashFloat = ABK64x64ToFloat( fDeltaCashCC );
        let isEqual = equalForPrecisionFloat(dCashFloat, dCashExpected, 15);
        if (!isEqual) {
            console.log("delta cash differs")
            console.log("delta cash received=", dCashFloat)
            console.log("delta cash expected=", dCashExpected);
        }
        expect(isEqual).to.be.true;
        let dL = marginAfter.fLockedInValueQC.sub(marginBefore.fLockedInValueQC);
        isEqual = equalForPrecision(deltaLockedValue, (dL), 15);
        if (!isEqual) {
            console.log("delta LockedIn differs")
            console.log("delta LockedIn received=", ABK64x64ToFloat(dL));
            console.log("delta LockedIn expected=", ABK64x64ToFloat(deltaLockedValue));
        }
        expect(isEqual).to.be.true;
        let ammAfter = await manager.getMarginAccount(perpetualId, manager.address);
        expect(ammBefore.fPositionBC.sub(ammAfter.fPositionBC)).equal(fTradeAmount);
        expect(ammBefore.fCashCC.sub(ammAfter.fCashCC)).equal(fDeltaCashCC);
        expect(ammBefore.fLockedInValueQC.sub(ammAfter.fLockedInValueQC)).equal(deltaLockedValue);
    });

    describe("try to leave dust", () => {
        let trader;
        let s2, premium;
        beforeEach(async () => {
            
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
            await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));
            perpetualId = await createPerpetual(manager, poolId);
            await manager.runLiquidityPool(poolId);

            trader = accounts[0];
            let depositAmount = floatToABK64x64(5);
            await marginToken.connect(trader).approve(manager.address, toDec18(depositAmount));
            await manager.connect(trader).deposit(perpetualId, depositAmount);

            s2 = 47200;
            premium = 2;
            await manager.setGenericPerpInt128(perpetualId, "fAMMFundCashCC", floatToABK64x64(5));
            await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(s2));
            await manager.setGenericPriceData(perpetualId, "currentPremiumRate", floatToABK64x64(premium/s2));
            await manager.setGenericPriceData(perpetualId, "currentMarkPremiumRate", floatToABK64x64(premium/s2));
            await manager.setGenericPriceData(perpetualId, "fCurrentTraderExposureEMA", floatToABK64x64(5));
            await manager.setGenericPerpInt128(perpetualId, "fLotSizeBC", floatToABK64x64(0.0001));
            await manager.setDefaultFundCashCC(poolId, floatToABK64x64(20));
            await manager.setTargetDFSize(poolId, floatToABK64x64(20));
            
        });

        it("round to lot", async () => {
            let amounts = [0.123242, 0.123, 0.1235, -0.123242];
            let lotSizes = [0.002, 0.001];
            for(var i=0; i<amounts.length; i++) {
                let amount = amounts[i];
                for(var j=0; j<lotSizes.length; j++) {
                    let lotSize = lotSizes[j];
                    let roundedAmount64 = await manager.roundToLot(floatToABK64x64(amount), floatToABK64x64(lotSize));
                    let roundedAmount = ABK64x64ToFloat(roundedAmount64);
                    let roundedAmountExpected64 = roundToLotBN(amount, lotSize);
                    if (roundedAmountExpected64.toString() != roundedAmount64.toString()) {
                        console.log("amount = ", amount);
                        console.log("roundedAmount = ", roundedAmount64.toString(), " = ", roundedAmount);
                        console.log("roundedAmountExpected = ", roundedAmountExpected64.toString(), " = ", ABK64x64ToFloat(roundedAmountExpected64));
                    }
                    expect(roundedAmountExpected64).to.be.equal(roundedAmount64);
                }
            }
            
        });

        it("should round trade amount to lot", async () => {
            let fAmount = -0.0123243413434343;
            let limPx = 0;
            
            // L, cash, pos
            await manager.setMarginAccount(perpetualId, trader.address, 
                floatToABK64x64(0), floatToABK64x64(0), floatToABK64x64(0));
            // add some leverage and deposit to catch testing-branch
            let lvg = floatToABK64x64(1.2);
            let depositAmount = floatToABK64x64(5);
            await marginToken.connect(trader).approve(manager.address, toDec18(depositAmount));
            await manager.connect(trader).deposit(perpetualId, floatToABK64x64(Math.abs(fAmount)));
           
            let perpetual = await manager.getPerpetual(perpetualId);
            //console.log(perpetual)
            await manager.setGenericPerpInt128(perpetualId, "indexS2PriceData", floatToABK64x64(s2));
           
            //trade(manager: Contract, perpetualId, tradeAmount, limitPrice, account, referrer = ZERO_ADDRESS, deadline = null,
            //    leverage = null, flags = null)
            let tx = await trade(manager, perpetualId, floatToABK64x64(fAmount), floatToABK64x64(limPx), trader.address, ZERO_ADDRESS,
                null, lvg);
            let tradeAmountExpected = roundToLot(fAmount, 0.0001);
            let marginAccount = await manager.getMarginAccount(perpetualId, trader.address);
            let posTraded = ABK64x64ToFloat(marginAccount.fPositionBC);
            let isExpected = equalForPrecisionFloat(posTraded, tradeAmountExpected, 18);
            if(!isExpected) {
                console.log("Trade amount expected = ", tradeAmountExpected);
                console.log("Trade amount realized = ", posTraded);
            }
            expect(isExpected).to.be.true;
        });

        it("should create position ids", async () => {
            // close position
            let traderState = await queryTraderState(manager, perpetualId, trader.address);
            let perpParams = await queryPerpParameters(manager, perpetualId);
            let ammState = await queryAMMState(manager, perpetualId);
            console.log(traderState);
            console.log(perpParams);
            console.log(ammState);
            let fAmount = -0.0123243413434343;// will be rounded to lot -0.012
            // open position
            await manager.setMarginAccount(perpetualId, trader.address, 
                floatToABK64x64(0), floatToABK64x64(5), floatToABK64x64(0));
            await manager.setGenericPerpInt128(perpetualId, "indexS2PriceData", floatToABK64x64(s2));
            await trade(manager, perpetualId, floatToABK64x64(fAmount), floatToABK64x64(0), trader.address);
            let marginAccount = await manager.getMarginAccount(perpetualId, trader.address);
            let posIdBefore = marginAccount.positionId;
            // close position
            console.log("1")
            await trade(manager, perpetualId, floatToABK64x64(-fAmount), floatToABK64x64(100000), trader.address);
            marginAccount = await manager.getMarginAccount(perpetualId, trader.address);
            let posIdClosed = marginAccount.positionId;
            let marginAccountAfter1 = await manager.getMarginAccount(perpetualId, trader.address);
            expect(marginAccountAfter1.fCashCC).to.be.equal(0);
            expect(marginAccountAfter1.fPositionBC).to.be.equal(0);
            // we need to deposit again
            console.log("2")
            await manager.setMarginAccount(perpetualId, trader.address, 
                floatToABK64x64(0), floatToABK64x64(5), floatToABK64x64(0));
            // open new position
            console.log("3")
            await trade(manager, perpetualId, floatToABK64x64(fAmount), floatToABK64x64(0), trader.address);
            marginAccount = await manager.getMarginAccount(perpetualId, trader.address);
            let posIdAfter = marginAccount.positionId;
            // partially close new position
            console.log("4")
            await trade(manager, perpetualId, floatToABK64x64(-fAmount/2), floatToABK64x64(100000), trader.address);
            marginAccount = await manager.getMarginAccount(perpetualId, trader.address);
            let posIdSame = marginAccount.positionId;
            
            let isCorrect = posIdBefore!=0 && posIdClosed==0 && posIdAfter!=posIdBefore && posIdAfter==posIdSame;
            if (!isCorrect) {
                console.log("Position ID not as intended:")
                console.log("posID before = ",posIdBefore);
                console.log("posID closed (should be 0)= ",posIdClosed);
                console.log("posID new (should be new id)= ", posIdAfter);
                console.log("posId same (should be same id)= ", posIdSame);
            }
            expect(isCorrect).to.be.true;
        });

        it("should successfully trade and remove odd amounts", async () => {
            await manager.setMarginAccount(perpetualId, trader.address, 
                floatToABK64x64(0), floatToABK64x64(5), floatToABK64x64(0));
            let amounts = [0.1232421212134, -0.12324289765432];
            let limPx = [100000, 0];
            for(var i=0; i<amounts.length; i++) {
                await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(s2));
                await manager.setGenericPriceData(perpetualId, "currentPremiumRate", floatToABK64x64(premium/s2));
                await manager.setGenericPriceData(perpetualId, "currentMarkPremiumRate", floatToABK64x64(premium/s2));
                
                let amount = amounts[i];
                let perpetual = await manager.getPerpetual(perpetualId);
                let priceData = await manager.getOraclePriceData(perpetual.oracleS2Addr);
                let markPrice = ABK64x64ToFloat(mul64x64(priceData.fPrice,
                    add64x64(ONE_64x64, perpetual.currentMarkPremiumRate.fPrice)));
                let limitPrice = limPx[i];
                await trade(manager, perpetualId, floatToABK64x64(amount), floatToABK64x64(limitPrice), trader.address);
            }
            let marginAccount = await manager.getMarginAccount(perpetualId, trader.address);
            let isZero = marginAccount.fPositionBC == 0;
            if(!isZero) {
                console.log("Margin account after trades:", 
                    "L=", ABK64x64ToFloat(marginAccount.fLockedInValueQC),
                    "pos=", ABK64x64ToFloat(marginAccount.fPositionBC),
                    "cash=", ABK64x64ToFloat(marginAccount.fCashCC));
            }
            expect(isZero).to.be.true;
        });
    });


    describe("Trade with leverage order", () => {
        let poolId, perpetualId, marginToken;
        let s2, premium, trader;
        let tradeAmount = 1;

        async function queryTotalCash() {
            // get AMM pool cash, AMM trader cash, PnL participant cash and DF cash
            let perpetual = await manager.getPerpetual(perpetualId);
            let lp = await manager.getLiquidityPool(poolId);
            let marginAccount = await manager.getMarginAccount(perpetualId, manager.address);
            let totalCash = ABK64x64ToFloat(perpetual.fAMMFundCashCC.add(lp.fPnLparticipantsCashCC).add(lp.fDefaultFundCashCC).add(marginAccount.fCashCC));
            return totalCash;
        }

        before(async () => {
            manager = await createPerpetualManagerForIT();
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
            await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));

            const BTC = toBytes32("BTC");
            const USD = toBytes32("USD");
            const ETH = toBytes32("ETH");
            s2 = 47200;
            premium = 2;
            let S2Oracle = s2
            let prices = [];
            for(var k = 0; k<20; k++) {
                prices.push(floatToABK64x64(S2Oracle));
            }
            let oracleBTCUSD = await createContract("MockPriceScenarioOracle", [BTC, USD, prices]);
            let oracles = [oracleBTCUSD.address, await createOracle(ETH, USD)];
            perpetualId = await createPerpetual(manager, poolId, null, null, null, COLLATERAL_CURRENCY_BASE, oracles);

            let governanceAccount = accounts[2];
            // transfer 'some' tokens to governance
            await poolData.marginToken.mint(governanceAccount.address, ONE_DEC18.mul(100));
            await poolData.marginToken.connect(governanceAccount).approve(manager.address, ONE_DEC18.mul(1000));
            await manager.addAmmGovernanceAddress(governanceAccount.address);
            await manager.setPerpetualState(perpetualId, PerpetualStateINITIALIZING);
            await manager.connect(governanceAccount).addAMMLiquidityToPerpetual(perpetualId, floatToABK64x64(10));

            await manager.runLiquidityPool(poolId);

            trader = accounts[0];
            let depositAmount = floatToABK64x64(5);
            await marginToken.connect(trader).approve(manager.address, toDec18(depositAmount));
            
            await manager.setGenericPerpInt128(perpetualId, "fAMMFundCashCC", floatToABK64x64(5));
            await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(s2));
            await manager.setGenericPriceData(perpetualId, "currentPremiumRate", floatToABK64x64(premium/s2));
            await manager.setGenericPriceData(perpetualId, "currentMarkPremiumRate", floatToABK64x64(premium/s2));
            await manager.setGenericPriceData(perpetualId, "fCurrentTraderExposureEMA", floatToABK64x64(10));
            await manager.setPerpetualParam(perpetualId, "fLotSizeBC", floatToABK64x64(0.0001));
            await manager.setDefaultFundCashCC(poolId, floatToABK64x64(20));
            await manager.setTargetDFSize(poolId, floatToABK64x64(20));

            await manager.setMarginAccount(perpetualId, trader.address, 
                floatToABK64x64(0), floatToABK64x64(0), floatToABK64x64(0));
        });

        function getRequiredCollateralCC(tradeAmount, leverage, price, S2, Sm, fee=0.0008) {
            let S3 = S2;
            let newPnLQC = tradeAmount * (Sm - price)
            let feesQC = Math.abs(tradeAmount) * fee *S2;
            return (Math.abs(tradeAmount) / leverage * Sm - newPnLQC + feesQC)/S3;
        }

        it("test leverage logic", async () => {
            
            let tradeAmount = 2;
            // get initial margin rate
            let perpetual = await manager.getPerpetual(perpetualId);
            let fInitialMarginRateAlpha = ABK64x64ToFloat(perpetual.fInitialMarginRateAlpha);
            let fMarginRateBeta = ABK64x64ToFloat(perpetual.fMarginRateBeta);
            let fMaintenanceMarginRateAlpha = ABK64x64ToFloat(perpetual.fMaintenanceMarginRateAlpha);
            let fInitialMarginRateCap = ABK64x64ToFloat(perpetual.fInitialMarginRateCap);
            let tau = calculateInitialMarginRate(fInitialMarginRateAlpha,
                fMaintenanceMarginRateAlpha, fInitialMarginRateCap, fMarginRateBeta, tradeAmount);
            // max leverage
            let lvg = 1/tau;
            let price = 60000;
            let s2 = 58000;
            let sm = 59000;
            let collExpected = getRequiredCollateralCC(tradeAmount, lvg, price, s2, sm, 0.0006)
            // check required collateral
            let balanceCC = tradeAmount * (sm - price)/s2 + collExpected - Math.abs(tradeAmount)*0.0006;
            
            let requiredInitialMgn = tau * Math.abs(tradeAmount) * sm/s2; 

            let lvgObtained = Math.abs(tradeAmount)*sm/s2/balanceCC;
            let isEqual = lvgObtained == lvg;
            if (lvgObtained != lvg) {
                console.log("requiredInitialMgn CC  = ", requiredInitialMgn);
                console.log("balanceCC  = ", balanceCC);
                console.log("lvgObtained = ", lvgObtained);
                console.log("lvg  = ", lvg);
            }
            expect(isEqual).to.be.true;
        });

        it("should withdraw from trader wallet to open pos", async () => {
            // 1st should fail because we set the leverage too high
            // 2nd opens a position (market order) - low leverage, so margin is large (expect deposit)
            // 3rd opens a position (limit order) - high leverage, but limit order so existing margin can't be used (expect deposit)
            // 4th partially closes (limit order) - expect cash to increase, leverage is not used
            let tradeAmounts = [1, 0.01, 0.01, -0.01];
            let referrerAcc = accounts[4];
            let traderAddr = trader.address;
            let params = await queryPerpParameters(manager, perpetualId);
            let feeRate = params.fTreasuryFeeRate + params.fPnLPartRate;
            let relativeLeverageFromMax = [1.2, 0.4, 0.9, 100];
            let flags = [MASK_MARKET_ORDER, MASK_MARKET_ORDER, MASK_LIMIT_ORDER, MASK_LIMIT_ORDER];

            let limitPrices = [60000, 60000, 60000, 30000];

            let balanceBefore = await marginToken.balanceOf(traderAddr);
            for(var k = 0; k < tradeAmounts.length; k++) {
                console.log("--- iteration ", k, "---");
                let tradeAmount = tradeAmounts[k];
                let limitPrice = limitPrices[k];
                let maxLvg = getMaxInitialLeverage(tradeAmount, params);
                let lvg = maxLvg * relativeLeverageFromMax[k];
                let flag = flags[k];
                // get price
                let sm = s2+premium;
                let perpParams = await queryPerpParameters(manager, perpetualId);
                let ammData = await queryAMMState(manager, perpetualId);
                let price = getPrice(tradeAmount, perpParams, ammData);
                let traderState = await queryTraderState(manager, perpetualId, traderAddr);
                //> console.log(traderState);
                let mgnAccountBefore = await manager.getMarginAccount(perpetualId, traderAddr);
                let oldPos = ABK64x64ToFloat(mgnAccountBefore.fPositionBC);
                let oldLockedIn = ABK64x64ToFloat(mgnAccountBefore.fLockedInValueQC);
                // deposit expected: depends on whether it's a limit or market order
                let depositExpected;
                let isOpen = Math.abs(oldPos + tradeAmount) > Math.abs(oldPos);
                if (flag == MASK_MARKET_ORDER && isOpen) {
                    let newPos = tradeAmount + ABK64x64ToFloat(mgnAccountBefore.fPositionBC);
                    let oldCash = ABK64x64ToFloat(mgnAccountBefore.fCashCC);
                    depositExpected = getRequiredCollateralCC(newPos, lvg, price, s2, sm, feeRate) - oldCash;
                } else if (flag == MASK_LIMIT_ORDER && isOpen) {
                    let Sm = getMarkPrice(ammData);
                    let depExpected = getDepositAmountForLvgTrade(0, 0, tradeAmount, lvg, 
                        price, ammData.indexS2PriceDataOracle, Sm);
                    depositExpected = depExpected + Math.abs(tradeAmount) * getTradingFeeRate(perpParams) 
                        + perpParams.fReferralRebateCC;
                    //depositExpected = getRequiredCollateralCC(tradeAmount, lvg, price, s2, sm, feeRate);
                } else if(!isOpen) {
                    depositExpected = 0;
                    maxLvg = Infinity;
                }
                console.log("depositExpected=", depositExpected);

                let systemCashBefore = await queryTotalCash();
                let managerCashBefore = await marginToken.balanceOf(manager.address);
                let referrerCashBefore = await marginToken.balanceOf(referrerAcc.address);
                if (lvg <= maxLvg) {
                    let referrerAddr = flag==MASK_LIMIT_ORDER ? referrerAcc.address : ZERO_ADDRESS;
                    console.log("targetlvg=", lvg);
                    await trade(
                        manager, 
                        perpetualId, 
                        floatToABK64x64(tradeAmount), 
                        floatToABK64x64(limitPrice), 
                        traderAddr, 
                        referrerAddr, 
                        null,
                        floatToABK64x64(lvg), 
                        flag);
                } else {
                    await manager.setGenericPriceData(perpetualId, "fCurrentTraderExposureEMA", floatToABK64x64(10));
                    await expect(trade(
                        manager, 
                        perpetualId, 
                        floatToABK64x64(tradeAmount), 
                        floatToABK64x64(limitPrice), 
                        traderAddr, 
                        ZERO_ADDRESS, 
                        null,
                        floatToABK64x64(lvg), 
                        flag)).to.revertedWith("margin not enough");
                    continue;
                }
                let systemCashAfter = await queryTotalCash();
                let managerCashAfter = await marginToken.balanceOf(manager.address);
                let referrerCashAfter = await marginToken.balanceOf(referrerAcc.address);
                let balanceAfter = await marginToken.balanceOf(traderAddr);
                let depositedAmount = dec18ToFloat(balanceBefore.sub(balanceAfter));
                let mgnAccount = await manager.getMarginAccount(perpetualId, traderAddr);
                
                let avgPrice = oldPos == 0? 0 : oldLockedIn / oldPos;
                let refPrice = isOpen? s2 : avgPrice;
                let perpetual = await manager.getPerpetual(perpetualId);
                let fundingPayment = oldPos * ABK64x64ToFloat(perpetual.fUnitAccumulatedFunding.sub(mgnAccountBefore.fUnitAccumulatedFundingStart));
                let referralFee = flag == MASK_LIMIT_ORDER ? perpParams.fReferralRebateCC : 0;
                let fees = Math.abs(tradeAmount) * feeRate + referralFee;
                // wallet after = wallet before - cash sent to margin account - cash sent to protocol
                // cash to protocol = fees +  k * (price - ref price) + funding payment
                // trader dust:
                let dustAfterDeposit = (
                    depositedAmount // -delta cash in wallet
                    - fees // |k| * fee rate + referral rebate
                    - ABK64x64ToFloat(mgnAccount.fCashCC.sub(mgnAccountBefore.fCashCC)) // margin account cash after trade - cash before trade
                    - tradeAmount * (price - refPrice) / s2 // when opening, protocol takes k *(price(k) - s2), when closing it takes  k *(price(k) - avg price)
                    - fundingPayment // funding payment (from trader to protocol)
                );
                let isNoDust = equalForPrecisionFloat(dustAfterDeposit, 0, 17);
                if (!isNoDust) {
                    console.log(
                        "iteration = ", k, 
                        "\ndepositedAmount=", depositedAmount,
                        "\nfees=", fees,
                        "\ncashBefore=", ABK64x64ToFloat(mgnAccountBefore.fCashCC),
                        "\ncashAfter=", ABK64x64ToFloat(mgnAccount.fCashCC),
                        "\nexpected cash from deposit and fees(cash_0 + deposit - fee)\n",
                        "- expected cash from trader account and trade",
                        "size@price(cash_1 + k(price - refPrice)/s3)\n=", dustAfterDeposit);
                }
                expect(isNoDust).to.be.true;
                // total dust: cash in protocol (df, amm, amm trader) + trader wallet + trader account + referrer account should be conserved (zero sum)
                let protocolDustAfterTrade = (
                    systemCashAfter + dec18ToFloat(balanceAfter) + dec18ToFloat(referrerCashAfter) + ABK64x64ToFloat(mgnAccount.fCashCC) - 
                    (systemCashBefore + dec18ToFloat(balanceBefore) + dec18ToFloat(referrerCashBefore) + ABK64x64ToFloat(mgnAccountBefore.fCashCC))
                );
                let isNoProtocolDust = equalForPrecisionFloat(protocolDustAfterTrade, 0, 9);
                if (!isNoProtocolDust) {
                    console.log(ABK64x64ToFloat(BN.from("0x800000000000000000")));
                    console.log("---- cash was " + (protocolDustAfterTrade > 0 ? "created" : "destroyed") + "! ----");
                    console.log("protocolDustAfterTrade=", protocolDustAfterTrade);
                    console.log("funding payment=", fundingPayment);
                    // before
                    console.log("managerWalletBefore=", dec18ToFloat(managerCashBefore));
                    console.log("totalBefore=", systemCashBefore + dec18ToFloat(balanceBefore) + ABK64x64ToFloat(mgnAccountBefore.fCashCC));
                    console.log("systemCashBefore=", systemCashBefore);
                    console.log("walletBalanceBefore=", dec18ToFloat(balanceBefore));
                    console.log("mgnAccountBefore.fCashCC=", ABK64x64ToFloat(mgnAccountBefore.fCashCC));
                    // after
                    console.log("managerWalletAfter=", dec18ToFloat(managerCashAfter));
                    console.log("totalAfter=", systemCashAfter + dec18ToFloat(balanceAfter) + ABK64x64ToFloat(mgnAccount.fCashCC));
                    console.log("systemCashAfter=", systemCashAfter);
                    console.log("walletBalanceAfter=", dec18ToFloat(balanceAfter));
                    console.log("mgnAccount.fCashCC=", ABK64x64ToFloat(mgnAccount.fCashCC));
                    // diff
                    console.log("diffProtocolCash=", systemCashAfter - systemCashBefore);
                    console.log("diffTraderAccount=", ABK64x64ToFloat(mgnAccount.fCashCC.sub(mgnAccountBefore.fCashCC)));
                    console.log("diffTraderWallet=", -depositedAmount);
                    console.log("diffManagerWallet=", dec18ToFloat(managerCashAfter.sub(managerCashBefore)));
                }
                expect(isNoProtocolDust).to.be.true;
                // check leverage is what we wanted
                let cashForLvg = depositExpected - fees - tradeAmount * (price - s2) / s2;//flag == MASK_MARKET_ORDER? ABK64x64ToFloat(mgnAccount.fCashCC) : ABK64x64ToFloat(mgnAccount.fCashCC) - ABK64x64ToFloat(mgnAccountBefore.fCashCC);
                let balanceCC = cashForLvg + tradeAmount * (sm - s2) / s2;
                let lvgObtained = (sm / s2) * tradeAmount / balanceCC;
                // we only check this for opening positions!
                let isLvgEqual = equalForPrecisionFloat(lvgObtained, lvg, 12) || !isOpen;
                if (!isLvgEqual) {
                    console.log("iteration =", k);
                    console.log("lvgObtained = ", lvgObtained);
                    console.log("lvg  = ", lvg);
                }
                expect(isLvgEqual).to.be.true;

                // check that the deposit is what we expected
                let isLvgAsConst : boolean = !isOpen && (flag == MASK_KEEP_POS_LEVERAGE || flag == MASK_LIMIT_ORDER || flag == MASK_STOP_ORDER);
                let isEqualDeposits = isLvgAsConst || equalForPrecisionFloat(depositedAmount, depositExpected, 13);
                if (!isEqualDeposits) {
                    console.log("iteration =", k);
                    console.log("depositedAmount = ", depositedAmount);
                    console.log("depositExpected = ", depositExpected);
                }
                expect(isEqualDeposits).to.be.true;
                
                // check that there is a withdrawal unless we're closing
                let isWithdraw = depositedAmount>0 || !isOpen;
                if( !isWithdraw) {
                    console.log("depositExpected = ", depositExpected);
                    console.log("cash = ", ABK64x64ToFloat(mgnAccount.fCashCC));
                    console.log("pos  = ", ABK64x64ToFloat(mgnAccount.fPositionBC));
                    console.log("L    = ", ABK64x64ToFloat(mgnAccount.fLockedInValueQC));
                    console.log("balance before = ", dec18ToFloat(balanceBefore));
                    console.log("balance after = ", dec18ToFloat(balanceAfter));
                    console.log("diff = ", depositedAmount);
                }
                expect(isWithdraw).to.be.true;

                balanceBefore = balanceAfter;
            }
            
            
        });
        it("it should fail to close with a limit order above price", async () => {
            let traderAddr = trader.address;
            let limitPrice = 80000;
            let mgnAccountBefore = await manager.getMarginAccount(perpetualId, traderAddr);
            let tradeAmount = -ABK64x64ToFloat(mgnAccountBefore.fPositionBC)/2;
            await expect(trade(manager, perpetualId, floatToABK64x64(tradeAmount), 
                floatToABK64x64(limitPrice), traderAddr, ZERO_ADDRESS, null,
                null, MASK_LIMIT_ORDER)).to.revertedWith("price exceeds limit");
        });

        it("should send to trader wallet when closing pos", async () => {
            let traderAddr = trader.address;
            let limitPrice = 30000;
            let balanceBefore = await marginToken.balanceOf(traderAddr);
            let mgnAccountBefore = await manager.getMarginAccount(perpetualId, traderAddr);
            let tradeAmount = -ABK64x64ToFloat(mgnAccountBefore.fPositionBC);
            await trade(manager, perpetualId, floatToABK64x64(tradeAmount), 
                floatToABK64x64(limitPrice), traderAddr, ZERO_ADDRESS, null,
                null, MASK_LIMIT_ORDER);
            let balanceAfter = await marginToken.balanceOf(traderAddr);
            let depositedAmount = dec18ToFloat(balanceAfter.sub(balanceBefore));
            let mgnAccount = await manager.getMarginAccount(perpetualId, traderAddr);
            let isDeposit = depositedAmount>0;
            if (!isDeposit) {
                console.log("cash = ", ABK64x64ToFloat(mgnAccount.fCashCC));
                console.log("pos  = ", ABK64x64ToFloat(mgnAccount.fPositionBC));
                console.log("L    = ", ABK64x64ToFloat(mgnAccount.fLockedInValueQC));
                console.log("trader addr=", trader.address);
                console.log("mgn token addr=", marginToken.address);
                console.log("balance before = ", dec18ToFloat(balanceBefore));
                console.log("balance after = ", dec18ToFloat(balanceAfter));
                console.log("diff = ", depositedAmount);
            }
            expect(isDeposit).to.be.true;
        });

        it("all remaining traders should be able to fully close their positions", async () => {
            // check that there's no open positions
            let activeAccounts = await manager.getActivePerpAccounts(perpetualId);
            expect(activeAccounts.length == 0).to.be.true;
            // open a small position
            let traderAddr = trader.address;
            let tradeAmount = 0.01;
            let tx1 = await trade(manager, perpetualId, floatToABK64x64(tradeAmount), 
                floatToABK64x64(100_000), traderAddr, ZERO_ADDRESS, null,
                floatToABK64x64(10), MASK_MARKET_ORDER);
            // close it
            let tx2 = await trade(manager, perpetualId, floatToABK64x64(-tradeAmount), 
                floatToABK64x64(1), traderAddr, ZERO_ADDRESS, null,
                floatToABK64x64(10), MASK_MARKET_ORDER);
            // double check
            let account = await manager.getMarginAccount(perpetualId, traderAddr);
            expect(account.fPositionBC == 0).to.be.true;
        });
    });

    async function trade(manager: Contract, perpetualId, tradeAmount, limitPrice, account, referrer = ZERO_ADDRESS, deadline = null,
        leverage = null, flags = null) {
        //trade
        type Order = {
            iPerpetualId: BytesLike;
            traderAddr: string;
            fAmount: BigNumberish;
            fLimitPrice: BigNumberish;
            fTriggerPrice: BigNumberish;
            iDeadline: BigNumberish;
            referrerAddr: string;
            flags: BigNumberish;
            fLeverage : BigNumberish;
            createdTimestamp: BigNumberish;
        };

        if (deadline == null) {
            deadline = Math.round(new Date() / 1000) + 86400;
        }
        if (leverage == null) {
            leverage = floatToABK64x64(0);
        }
        if (flags == null) {
            flags = MASK_MARKET_ORDER;
        }
        let order: Order = {
            iPerpetualId: perpetualId,
            traderAddr: account,
            fAmount: tradeAmount,
            fLimitPrice: limitPrice,
            fTriggerPrice: floatToABK64x64(0),
            iDeadline: deadline,
            referrerAddr: referrer,
            flags: flags,
            fLeverage: leverage,
            createdTimestamp: Date.now()
        };

        return await manager.trade(order);
    }

});
