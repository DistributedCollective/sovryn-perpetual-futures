// @ts-nocheck
import { ethers, waffle } from "hardhat";
import { BigNumber, Signer } from "ethers";
import { expect, assert } from "chai";
import { fromBytes32, toBytes32, createContract, getAccounts } from "../scripts/utils/utils";
import { deployMockContract } from "ethereum-waffle";
import * as fs from "fs";
import { createOracle, createLiquidityPool, createPerpetual, createPerpetualManager, createMockPerpetual, getBTCBaseParams } from "./TestFactory";
import { addAMMLiquidityToPerpetual, runLiquidityPool, addLiquidity, deposit } from "../scripts/deployment/deploymentUtil";
import { trade, MASK_MARKET_ORDER } from "./tradeFunctions";
import { IMockPerpetualManager, PerpetualManagerProxy } from "../typechain";
import {
    ABK64x64ToFloat,
    COLLATERAL_CURRENCY_BASE,
    COLLATERAL_CURRENCY_QUANTO,
    COLLATERAL_CURRENCY_QUOTE,
    div64x64,
    equalForPrecision,
    floatToABK64x64,
    mul64x64,
    add64x64,
    toDec18,
    growToLot,
    calculateLiquidationPriceCollateralBase,
    calculateMaintenanceMarginRate,
    equalForPrecisionFloat,
    getMarginBalanceCC,isMarginSafe,calculateLiquidationAmount
} from "../scripts/utils/perpMath";

const BN = BigNumber;

const ONE_DEC18 = BN.from(10).pow(BN.from(18));
const ONE_64x64 = BN.from("0x010000000000000000");
const DOT_ONE_64x64 = ONE_64x64.div(BN.from("10")); // 0.1
const DOT_ZERO_ONE_64x64 = ONE_64x64.div(BN.from("100")); // 0.01

const ZERO_ADDRESS = ethers.constants.AddressZero;

// constants based on enums
const PerpetualStateINVALID = 0;
const PerpetualStateINITIALIZING = 1;
const PerpetualStateNORMAL = 2;
const PerpetualStateEMERGENCY = 3;
const PerpetualStateCLEARED = 4;

let s2: number, s3: number, premium: number;
let baseParamsBTC: BigNumber[];
let accounts, owner, trader, trader1, trader2, trader3, trader4, governanceAccount;
let manager: IMockPerpetualManager;
let perpetualId, perpetual, poolData, poolId, marginToken;
let S2Oracle : MockPriceScenarioOracle;
let oracleBTCUSD;

async function initPerp(_perpetualId) {
    s2 = 47200;
    s3 = 3600;
    premium = 5/s2;

    manager.setGenericPriceData(_perpetualId, "indexS2PriceData", floatToABK64x64(s2));
    manager.setGenericPriceData(_perpetualId, "indexS3PriceData", floatToABK64x64(s3));
    manager.setGenericPriceData(_perpetualId, "currentMarkPremiumRate", floatToABK64x64(premium));
    manager.setPerpetualState(_perpetualId, PerpetualStateNORMAL);
    perpetual = await manager.getPerpetual(_perpetualId);
}

// A way to log ABK64x64 negative numbers
export function myLog(key, value) {
    console.log("(negative)", key, "=", ABK64x64ToFloat(value.sub(value).sub(value)));
}

export function myLogPositive(key, value) {
    console.log("(positive)", key, "=", ABK64x64ToFloat(value));
}

const initialize = async () => {
    accounts = await ethers.getSigners();
    owner = accounts[0].address;
    trader = accounts[1].address;
    governanceAccount = accounts[2];
    trader1 = accounts[3];
    trader2 = accounts[4];
    trader3 = accounts[5];
    trader4 = accounts[6];
    
    manager = (await createPerpetualManager());
    baseParamsBTC = getBTCBaseParams();
    poolData = await createLiquidityPool(manager, owner);
    poolId = poolData.id;
    marginToken = poolData.marginToken;
    await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));

    const BTC = toBytes32("BTC");
    const USD = toBytes32("USD");
    const ETH = toBytes32("ETH");
    S2Oracle = 60000
    let prices = [];
    for(var k = 0; k<20; k++) {
        prices.push(floatToABK64x64(S2Oracle));
    }
    oracleBTCUSD = await createContract("MockPriceScenarioOracle", [BTC, USD, prices]);
    let oracles = [oracleBTCUSD.address, await createOracle(ETH, USD)];
    perpetualId = await createPerpetual(manager, poolData.id, baseParamsBTC, null, null, COLLATERAL_CURRENCY_BASE, oracles);
    await initPerp(perpetualId);
};

describe("PerpetualLiquidator", () => {
    before(async () => {
        await initialize();
    });
/*
    describe("isMaintenanceMarginSafe", () => {
        // function isMaintenanceMarginSafe(bytes32 _iPerpetualId, address _traderAddr) external view returns (bool);

        it("returns true for healthy positions with maintenance margin < position margin", async () => {
            let positionSize = floatToABK64x64(3.0);
            const tx = await manager.setTraderPosition(perpetualId, trader, positionSize);
            await tx.wait();
            //await manager.setTraderPosition(perpetualId, trader, positionSize); //ONE_64x64.mul(3));
            const isMaintenanceMarginSafe = await manager.isMaintenanceMarginSafe(perpetualId, trader);
            expect(isMaintenanceMarginSafe).to.be.true;
        });

        it("returns true for account with zero position margin", async () => {
            const tx = await manager.setTraderPosition(perpetualId, trader, 0); // floatToABK64x64(0));
            await tx.wait();
            let isMaintenanceMarginSafe = await manager.isMaintenanceMarginSafe(perpetualId, trader);
            expect(isMaintenanceMarginSafe).to.be.true;
        });

        it("returns false for unhealthy positions with maintenance margin > position margin", async () => {
            let positionSize = floatToABK64x64(-1.0);
            //let positionSize = floatToABK64x64(10.0);
            let tx = await manager.setTraderPosition(perpetualId, trader, positionSize); //ONE_64x64.mul(3));
            await tx.wait();
            let fCashCC = floatToABK64x64(-0.00000000000001);
            await manager.setTraderFCashCC(perpetualId, trader, fCashCC);
            //await tx.wait();
            let marginAccount = await manager.getMarginAccount(perpetualId, trader);

            // 1. threshold - getTraderPosition == 0
            // return - getMarginBalance should be < threshold -> getMarginBalance must be negative
            await manager.setTraderPosition(perpetualId, trader, 0);

            let isMaintenanceMarginSafe = await manager.isMaintenanceMarginSafe(perpetualId, trader);
            expect(isMaintenanceMarginSafe).to.be.true;

            // 2. threshold - getTraderPosition != 0 => _getMaintenanceMargin(_perpetual, _traderAddress)
            //    return - getMarginBalance should be < _getMaintenanceMargin(_perpetual, _traderAddress)
            await manager.setTraderPosition(perpetualId, trader, floatToABK64x64(-0.1));
            await manager.setTraderFCashCC(perpetualId, trader, floatToABK64x64(0.1));

            isMaintenanceMarginSafe = await manager.isMaintenanceMarginSafe(perpetualId, trader);
            expect(isMaintenanceMarginSafe).to.be.false;
        });
    });

    describe("getBaseToQuoteConversionMultiplier", async () => {
        let isMarkPrice: boolean;
        before(async () => {
            await initialize();
            let positionSize = floatToABK64x64(10.0);
            const tx = await manager.setTraderPosition(perpetualId, trader, positionSize);
            await tx.wait();
        });
        it("returns perpetual mark price on isMarkPriceRequest == true", async () => {
            isMarkPrice = true;
            const price = await manager.getBaseToQuoteConversionMultiplier(perpetualId, isMarkPrice);
            let markprice = s2*(1+premium);
            let isEqual = equalForPrecisionFloat(markprice, ABK64x64ToFloat(price), 17);
            if (!isEqual) {
                console.log("Mark Price expected = ", markprice)
                console.log("Mark Price received = ",ABK64x64ToFloat(price))
            }
            expect(isEqual, "Wrong price").to.be.true;
        });

        it("returns spot price on isMarkPriceRequest == false", async () => {
            isMarkPrice = false;
            const spotPrice = await manager.getBaseToQuoteConversionMultiplier(perpetualId, isMarkPrice);
            let isEqual = equalForPrecisionFloat(s2, ABK64x64ToFloat(spotPrice), 17);
            if (!isEqual) {
                console.log("Mark Price expected = ", s2)
                console.log("Mark Price received = ",ABK64x64ToFloat(spotPrice))
            }
            expect(isEqual, "Wrong spot price").to.be.true;
        });

        //function _getBaseToQuoteConversionMultiplier(PerpetualData storage _perpetual, bool _isMarkPriceRequest) internal view returns (int128) {
    });
*/
    describe("getPositionAmountToLiquidate", async () => {
        // function getPositionAmountToLiquidate(bytes32 _iPerpetualId, address _traderAddr) external view returns (int128);
        let pos = 1;
        let L = 40005;
        let cash = 0.005;
        let s2 = 40000;
        let s3 = s2;
        let premium = 5;
        let sm = s2 + premium
        const fCashCC = floatToABK64x64(cash); //.00000000000000000000001);
        const fPositionBC = floatToABK64x64(pos);
        let fLockedInValueQC = ONE_64x64.mul(L);
        
        before(async () => {
            await initialize();
            await manager.setMarginAccount(perpetualId, trader, fLockedInValueQC, fCashCC, fPositionBC);
            await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(s2));
            await manager.setGenericPriceData(perpetualId, "currentPremiumRate", floatToABK64x64(premium/s2));
            await manager.setGenericPriceData(perpetualId, "currentMarkPremiumRate", floatToABK64x64(premium/s2));
            await manager.setGenericPriceData(perpetualId, "fCurrentTraderExposureEMA", floatToABK64x64(5));
            await manager.setGenericPriceData(perpetualId, "fLotSize", floatToABK64x64(0.0001));
        });
        it("returns amount to liquidate for unhealthy positions correctly", async () => {
            const amount: BigNumber = await manager.getPositionAmountToLiquidate(perpetualId, trader);
            let perp = await manager.getPerpetual(perpetualId);
            let fee = ABK64x64ToFloat(add64x64(add64x64(perp.fTreasuryFeeRate, perp.fPnLPartRate), perp.fLiquidationPenaltyRate));
            let lotSize = ABK64x64ToFloat(perp.fLotSizeBC);
            let fInitialMarginRateCap= 0.1;
            let tau = fInitialMarginRateCap
            let b0 = (pos * sm - L)/s3 + cash
            let amt = (Math.abs(pos) * tau * sm - b0 * s3)/(Math.sign(sm) * (sm * tau - s2 * fee));
            let amt_rounded = growToLot(amt, lotSize);
            let amountFlt = ABK64x64ToFloat(amount);
            let isEqual = equalForPrecisionFloat(amountFlt, amt_rounded, 14);
            if (!isEqual) {
                console.log("amt expected =", amt_rounded);
                console.log("amt rec =", amountFlt)
            }
            expect(isEqual).to.be.true;
        });
        it("full liquidation if liq amount below lot size", async () => {
            //tweak lot size
            let perp = await manager.getPerpetual(perpetualId);
            let lotSizeInitial = perp.fLotSizeBC;
            let newLotSize = floatToABK64x64(pos*2);
            await manager.setGenericPerpInt128(perpetualId, "fLotSizeBC", newLotSize);
            const amount: BigNumber = await manager.getPositionAmountToLiquidate(perpetualId, trader);
            let amountFlt = ABK64x64ToFloat(amount);
            let isEqual = equalForPrecisionFloat(amountFlt, pos, 10);
            if (!isEqual) {
                console.log("amt expected =", pos);
                console.log("amt rec =", amountFlt)
            }
            expect(isEqual).to.be.true;
            await manager.setGenericPerpInt128(perpetualId, "fLotSizeBC", lotSizeInitial);
        });
        it("returns amount 0 for trader without position", async () => {
            await manager.setMarginAccount(perpetualId, trader, 0, ONE_64x64, 0);
            const amount: BigNumber = await manager.getPositionAmountToLiquidate(perpetualId, trader);
            expect(amount).equal(BN.from(0));
        });

    });

    const logPairs = async (keys: any[], values: any[]) => {
        const pairs = [keys, values];
        console.log(pairs);
        const objFromPairs = values.reduce(function (result, field, index) {
            result[keys[index]] = field;
            return result;
        }, {});
        console.log(objFromPairs);
    };
 
    describe("liquidateByAMM", async () => {
        
        let poolCount;
        before(async () => {
            let governanceAccount = accounts[2];
            manager = (await createPerpetualManager()) as IMockPerpetualManager;
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
            await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));
            
            const BTC = toBytes32("BTC");
            const USD = toBytes32("USD");
            const ETH = toBytes32("ETH");
            S2Oracle = 60000
            let prices = [];
            for(var k = 0; k<20; k++) {
                prices.push(floatToABK64x64(S2Oracle));
            }
            oracleBTCUSD = await createContract("MockPriceScenarioOracle", [BTC, USD, prices]);
            let oracles = [oracleBTCUSD.address, await createOracle(ETH, USD)];
            perpetualId = await createPerpetual(manager, poolData.id, baseParamsBTC, null, null, COLLATERAL_CURRENCY_BASE, oracles);
            await initPerp(perpetualId);
            let tokenAmount = floatToABK64x64(9);
            // transfer 'some' tokens to governance
            await poolData.marginToken.mint(governanceAccount.address, ONE_DEC18.mul(100));
            //let balance = await poolData.marginToken.balanceOf(governanceAccount.address);
            await poolData.marginToken.connect(governanceAccount).approve(manager.address, ONE_DEC18.mul(1000));
            await manager.addAmmGovernanceAddress(governanceAccount.address);
            await manager.setPerpetualState(perpetualId, PerpetualStateINITIALIZING);
            await manager.connect(governanceAccount).addAMMLiquidityToPerpetual(perpetualId, tokenAmount);
            await manager.runLiquidityPool(poolId);
        });

        it("should not liquidate if position is healthy", async () => {
            let mgn1 = await manager.getMarginAccount(perpetualId, trader);
            let tx = await manager.liquidateByAMM(perpetualId, owner, trader);
            let mgn2 = await manager.getMarginAccount(perpetualId, trader);
            expect(mgn1.fPositionBC).to.be.equal(mgn2.fPositionBC);
        });


        
        it("should liquidate unhealthy position correctly", async () => {
            // see also test_liquidations.py
            let traderPositionBC = -1;
            let S2_0 = 35000;
            let L = S2_0*traderPositionBC;
            let cashCC = 0.5;
            let fCashCC = ONE_64x64.div(2);
            let S2 = S2Oracle;//<-- fixed with oracle
            let S3 = S2;
            let premiumRateEMA = 0.05;
            let Sm = S2*(1+premiumRateEMA);
            const collateralCurrencyIndex = COLLATERAL_CURRENCY_BASE
            const fInitialMarginRateAlpha = ABK64x64ToFloat(perpetual.fInitialMarginRateAlpha);
            const fMaintenanceMarginRateAlpha = ABK64x64ToFloat(perpetual.fMaintenanceMarginRateAlpha);
            const fInitialMarginRateCap = ABK64x64ToFloat(perpetual.fInitialMarginRateCap);
            const fMarginRateBeta = ABK64x64ToFloat(perpetual.fMarginRateBeta);
            const liquidationFee = ABK64x64ToFloat(perpetual.fLiquidationPenaltyRate);
            const tradingFee = ABK64x64ToFloat(perpetual.fTreasuryFeeRate.add(perpetual.fPnLPartRate));
            const lotSize = ABK64x64ToFloat(perpetual.fLotSizeBC);
            
            const mntncMarginRate = calculateMaintenanceMarginRate(fInitialMarginRateAlpha, 
                fMaintenanceMarginRateAlpha, 
                fInitialMarginRateCap, 
                fMarginRateBeta, 
                traderPositionBC);
            const targetMarginRate = fInitialMarginRateCap;
            
            // expected
            // BTCUSD drops from 60000 to 30000, user has $2000 left, or $2000/30000 BTC 
            let marginBalanceCC = getMarginBalanceCC(traderPositionBC, L, S2, S3, premiumRateEMA*S2, cashCC, collateralCurrencyIndex);
            let marginSafeBefore = isMarginSafe(traderPositionBC, L, cashCC, S2, S3, premiumRateEMA*S2, collateralCurrencyIndex, mntncMarginRate);
            let liqAmt = calculateLiquidationAmount(marginBalanceCC, mntncMarginRate, targetMarginRate, traderPositionBC, liquidationFee, tradingFee, lotSize, S3, S2, Sm);

            let liqAmtAfterRebalance = -0.6999; // from contract via console log
            let SmAfterRebalance = 63000.000000000000179543; // from contract via console log
            let newpos = traderPositionBC - liqAmtAfterRebalance;
            let newL = L - liqAmtAfterRebalance * L/traderPositionBC 
            let dCash = (SmAfterRebalance - L/traderPositionBC) * liqAmtAfterRebalance/S3;
            let newCashCC = cashCC + dCash - Math.abs(liqAmtAfterRebalance)*(tradingFee+liquidationFee)
            let penalty = Math.abs(liqAmtAfterRebalance) * (S2 / S3) * liquidationFee;
           
            // set contract values
            await manager.setMarginAccount(perpetualId, trader, floatToABK64x64(L), fCashCC, floatToABK64x64(traderPositionBC));
            let unitAccumulatedFunding = ONE_64x64.mul(0);
            await manager.setUnitAccumulatedFunding(perpetualId, unitAccumulatedFunding);
            await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(S2));
            await manager.setGenericPriceData(perpetualId, "currentMarkPremiumRate", floatToABK64x64(premiumRateEMA));
            await manager.setGenericPerpInt128(perpetualId, "fCurrentFundingRate", floatToABK64x64(0));
            // realized values
            let liqAmount64x64 = await manager.getPositionAmountToLiquidate(perpetualId, trader);
            let isEqual1 = equalForPrecisionFloat(ABK64x64ToFloat(liqAmount64x64), liqAmt, 13);
            if (!isEqual1) {
                console.log("wrong liqAmount");
                console.log("received = ", ABK64x64ToFloat(liqAmount64x64));
                console.log("expected = ", liqAmt);
                console.log("expeted marginSafeBefore=",marginSafeBefore);
                console.log("mntncMarginRate=",mntncMarginRate)
                console.log("targetMarginRate=",targetMarginRate)
                console.log("liquidationFee=",liquidationFee)
                console.log("tradingFee=",tradingFee)
            }
            let isSafeBefore = await manager.isMaintenanceMarginSafe(perpetualId, trader);
            //console.log("isSafeBefore =", isSafeBefore);
            let marginBalanceBefore64x64 = await manager.getMarginBalance(perpetualId, trader); 
            let mgnAccntBefore = await manager.getMarginAccount(perpetualId, trader);
            let poolBefore = await manager.getLiquidityPool(poolId);

            await manager.liquidateByAMM(perpetualId, owner, trader);
            let marginBalanceAfter64x64 = await manager.getMarginBalance(perpetualId, trader);  
            
            // markPremium from contract after rebalance (testing mark-adjustment is out of scope for this test)
            let perpData = await manager.getPerpetual(perpetualId);
            let poolAfter = await manager.getLiquidityPool(poolId);
            // get margin account
            let mgnAccnt = await manager.getMarginAccount(perpetualId, trader);
            let markPremiumAfter = ABK64x64ToFloat(perpData.currentMarkPremiumRate.fPrice)*S2;
            let marginSafeAfter = isMarginSafe(newpos, newL, newCashCC, S2, S3, markPremiumAfter, collateralCurrencyIndex, mntncMarginRate)
            let marginTargetSafeAfter = isMarginSafe(newpos, newL, newCashCC, S2, S3, markPremiumAfter, collateralCurrencyIndex, targetMarginRate)     
            let marginBalanceAfterCC = getMarginBalanceCC(newpos, newL, S2, S3, markPremiumAfter, newCashCC, collateralCurrencyIndex);

            let isEqual2 = equalForPrecisionFloat(ABK64x64ToFloat(marginBalanceBefore64x64), marginBalanceCC, 13);
            let isEqual3 = equalForPrecisionFloat(ABK64x64ToFloat(marginBalanceAfter64x64), marginBalanceAfterCC, 13);
            let isEqual4 = penalty > 0 && equalForPrecisionFloat(ABK64x64ToFloat(poolAfter.fDefaultFundCashCC.sub(poolBefore.fDefaultFundCashCC)), penalty/2, 13);
            if (!isEqual2 || !isEqual3 || !isEqual4) {
                console.log("wrong margin balance after");
                console.log("mgn before received = ", ABK64x64ToFloat(marginBalanceBefore64x64));
                console.log("mgn before expected = ", marginBalanceCC);
                console.log("margin acc before received ");
                console.log("------ margin cash: ", ABK64x64ToFloat(mgnAccntBefore.fCashCC));
                console.log("------ margin L: ", ABK64x64ToFloat(mgnAccntBefore.fLockedInValueQC));
                console.log("------ margin pos: ", ABK64x64ToFloat(mgnAccntBefore.fPositionBC));
                console.log("liq amnt received = ", ABK64x64ToFloat(liqAmount64x64));
                console.log("liq amnt expected = ", liqAmt);
                console.log("dCash expected = ", dCash);
                console.log("mark premium after rec = ", markPremiumAfter);
                console.log("mgn after received = ", ABK64x64ToFloat(marginBalanceAfter64x64));
                console.log("mgn after expected = ", marginBalanceAfterCC);
                console.log("> margin account")
                console.log("------ margin cash: ", ABK64x64ToFloat(mgnAccnt.fCashCC));
                console.log("------ margin L: ", ABK64x64ToFloat(mgnAccnt.fLockedInValueQC));
                console.log("------ margin pos: ", ABK64x64ToFloat(mgnAccnt.fPositionBC));
                console.log("----exp margin cash: ", newCashCC);
                console.log("----exp margin L: ", newL);
                console.log("----exp margin pos: ", newpos);
                console.log("penalty paid")
                console.log("------ delta DF=", ABK64x64ToFloat(poolAfter.fDefaultFundCashCC.sub(poolBefore.fDefaultFundCashCC)));
                console.log("------ half penalty=", penalty/2);
            }
            expect(isEqual1, "wrong liqAmount").to.be.true;
            expect(isEqual2, "wrong margin balance before").to.be.true;
            expect(isEqual3, "wrong margin balance after").to.be.true;
            expect(isEqual4, "wrong penalty paid").to.be.true;
        });
        it("should set position id to zero after liquidation", async () => {
            let S2_0 = 35000
            let L = -S2_0*2

            //let accs = await manager.getActivePerpAccounts(perpetualId);
            //expect(accs.length).to.greaterThan(0);

            await manager.setMarginAccount(perpetualId, trader, floatToABK64x64(L), floatToABK64x64(0), floatToABK64x64(-2));
            let poolBefore = await manager.getLiquidityPool(poolId);
            let ammAccountBefore = await manager.getMarginAccount(perpetualId, manager.address);
            await manager.liquidateByAMM(perpetualId, owner, trader);
            let poolAfter = await manager.getLiquidityPool(poolId);
            let ammAccountAfter = await manager.getMarginAccount(perpetualId, manager.address);
            let marginAccount = await manager.getMarginAccount(perpetualId, trader);
            let posIdAfterLiq = marginAccount.positionId;
            let posAfterLiq = marginAccount.fPositionBC;
            let cashAfterLiq = marginAccount.fCashCC;
            let isEqual = posIdAfterLiq == 0 && cashAfterLiq >= 0; 
            let isEqual2 = equalForPrecisionFloat(ABK64x64ToFloat(poolAfter.fDefaultFundCashCC.sub(poolBefore.fDefaultFundCashCC)), 0, 13);
            let isPaidByAMM = ABK64x64ToFloat(poolAfter.fAMMFundCashCC.sub(poolBefore.fAMMFundCashCC)) < 0;
            if (!isEqual || !isEqual2 || !isPaidByAMM) {
                console.log("Pos after liq = ", ABK64x64ToFloat(posAfterLiq));
                console.log("Cash after liq = ", ABK64x64ToFloat(cashAfterLiq));
                console.log("Pos Id after liq = ", posIdAfterLiq);
            }
            expect(isEqual).to.be.true;
            expect(isEqual2).to.be.true;
            expect(isPaidByAMM).to.be.true;
        });
       
    });
    describe("AMM loop through active accounts to liquidate", () => {
        let poolData1, poolId1, marginToken1, manager;
        let poolData2, poolId2, marginToken2;
        let perpetualId1, perpetualId2;
        beforeEach(async () => {
            manager = (await createPerpetualManager()) as IMockPerpetualManager;

            //pool 1
            poolData1 = await createLiquidityPool(manager, owner);
            poolId1 = poolData1.id;
            marginToken1 = poolData1.marginToken;
            await marginToken1.transfer(manager.address, ONE_DEC18.mul(100000));
            perpetualId1 = await createPerpetual(manager, poolId1);

            await marginToken1.mint(governanceAccount.address, ONE_DEC18.mul(10000));

            await marginToken1.connect(governanceAccount).approve(manager.address, ONE_DEC18.mul(100));

            await manager.addAmmGovernanceAddress(governanceAccount.address);
            await manager.connect(governanceAccount).addAMMLiquidityToPerpetual(perpetualId1, floatToABK64x64(100));
            let perpetual = await manager.getPerpetual(perpetualId);

            // await manager.activatePerpetual(perpetualId1);

            await manager.runLiquidityPool(poolId1);

            //pool2
            poolData2 = await createLiquidityPool(manager, owner);
            poolId2 = poolData2.id;
            marginToken2 = poolData2.marginToken;
            await marginToken2.transfer(manager.address, ONE_DEC18.mul(100000));
            perpetualId2 = await createPerpetual(manager, poolId2);
            await marginToken2.mint(governanceAccount.address, ONE_DEC18.mul(10000));
            await marginToken2.connect(governanceAccount).approve(manager.address, ONE_DEC18.mul(100));
            await manager.addAmmGovernanceAddress(governanceAccount.address);
            await manager.connect(governanceAccount).addAMMLiquidityToPerpetual(perpetualId2, floatToABK64x64(100));
            // await manager.activatePerpetual(perpetualId2);
            await manager.runLiquidityPool(poolId2);
        });

        it("liquidator should get active positions", async () => {
            let fLockedInValueQC = ONE_64x64.mul(40000);
            let fCashCC = floatToABK64x64(100); //.00000000000000000000001);
            let fPositionBC = floatToABK64x64(10);
            await manager.setMarginAccount(perpetualId1, trader1.address, fLockedInValueQC, fCashCC, fPositionBC);
            await manager.setMarginAccount(perpetualId2, trader2.address, fLockedInValueQC, fCashCC, fPositionBC);
            await manager.setMarginAccount(perpetualId2, trader3.address, fLockedInValueQC, fCashCC, fPositionBC);
            let depositAmount = floatToABK64x64(100.0);

            await marginToken1.connect(trader1).approve(manager.address, ONE_DEC18.mul(1000));
            await marginToken2.connect(trader2).approve(manager.address, ONE_DEC18.mul(1000));
            await marginToken2.connect(trader3).approve(manager.address, ONE_DEC18.mul(1000));

            await marginToken1.transfer(trader1.address, ONE_DEC18.mul(10000));
            await marginToken2.transfer(trader2.address, ONE_DEC18.mul(10000));
            await marginToken2.transfer(trader3.address, ONE_DEC18.mul(10000));

            const targetAMMPoolSize = floatToABK64x64(1000);
            await manager.setGenericPerpInt128(perpetualId1, "fTargetAMMFundSize", targetAMMPoolSize);
            await manager.setGenericPerpInt128(perpetualId2, "fTargetAMMFundSize", targetAMMPoolSize);

            await manager.connect(trader1).addLiquidity(poolId1, depositAmount);
            await manager.connect(trader1).deposit(perpetualId1, depositAmount);
            await manager.connect(trader2).addLiquidity(poolId2, depositAmount);
            await manager.connect(trader2).deposit(perpetualId2, depositAmount);
            await manager.connect(trader3).addLiquidity(poolId2, depositAmount);
            await manager.connect(trader3).deposit(perpetualId2, depositAmount);

            //await deposit(manager, marginToken1, perpetualId1, depositAmount, trader);

            let traderPos = ONE_64x64.mul(2);
            /*await manager.setMarginAccount(perpetualId1, trader1.address, fLockedInValueQC, fCashCC, traderPos);
            await manager.setMarginAccount(perpetualId1, trader2.address, fLockedInValueQC, fCashCC, traderPos);
            await manager.setMarginAccount(perpetualId2, trader2.address, fLockedInValueQC, fCashCC, traderPos);*/

            expect(await manager.getActivePerpAccounts(perpetualId1)).to.eql([trader1.address]);
            expect(await manager.getActivePerpAccounts(perpetualId2)).to.eql([trader2.address, trader3.address]);

            expect(await manager.getActivePerpAccountsByChunks(perpetualId1, 0, 1)).to.eql([trader1.address]);
            expect(await manager.getActivePerpAccountsByChunks(perpetualId2, 0, 2)).to.eql([trader2.address, trader3.address]);
            expect(await manager.getActivePerpAccounts(perpetualId1)).to.eql([trader1.address]);
        });

        it("liquidated trader with no cash no longer in active list", async () => {

            // 1) make sure trader is in active trader list by depositing to margin account
            let depositAmount = floatToABK64x64(1.0);
            await marginToken1.connect(trader1).approve(manager.address, ONE_DEC18.mul(1000));
            await marginToken1.transfer(trader1.address, ONE_DEC18.mul(10000));
            const targetAMMPoolSize = floatToABK64x64(1000);
            await manager.setGenericPerpInt128(perpetualId1, "fTargetAMMFundSize", targetAMMPoolSize);
            await manager.connect(trader1).deposit(perpetualId1, depositAmount);
            
            expect(await manager.getActivePerpAccounts(perpetualId1)).to.eql([trader1.address]);

            // 2) make sure trader can be liquidated
            let fLockedInValueQC = ONE_64x64.mul(40000);
            let fCashCC = floatToABK64x64(0.5);
            let fPositionBC = floatToABK64x64(10);
            await manager.setMarginAccount(perpetualId1, trader1.address, fLockedInValueQC, fCashCC, fPositionBC);
            await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(30000));

            expect(await manager.getActivePerpAccounts(perpetualId1)).to.eql([trader1.address]);
            let accs0 = await manager.getActivePerpAccounts(perpetualId1);
            //console.log("before = ", accs0);
            let l0 = accs0.length;

            // 3) liquidate trader
            await manager.liquidateByAMM(perpetualId1, owner, trader1.address);
            let accs = await manager.getActivePerpAccounts(perpetualId1);
            //console.log("active accounts before = ", l0);
            //console.log("active accounts after = ", accs.length);
            expect(accs0.length).to.greaterThan(0);
            expect(accs.length).to.lessThan(l0);
        }); 

    });

});
