// @ts-nocheck
import { expect, use, util } from "chai";
const { ethers } = require("hardhat");
import { waffleChai } from "@ethereum-waffle/chai";
import { toWei, createContract, getAccounts } from "../scripts/utils/utils";
import {
    equalForPrecision,
    add64x64,
    sub64x64,
    mul64x64,
    div64x64,
    abs64x64,
    floatToABK64x64,
    ABK64x64ToFloat,
    fractionToABDK64x64,
    toDec18,
    PerpetualStateNORMAL,
    COLLATERAL_CURRENCY_QUOTE,
    COLLATERAL_CURRENCY_BASE,
    COLLATERAL_CURRENCY_QUANTO,
    equalForPrecisionFloat,
} from "../scripts/utils/perpMath";
import { getBTCBaseParams } from "./TestFactory";
import { deployMockContract } from "ethereum-waffle";
import * as fs from "fs";
import { BigNumber, BigNumberish } from "ethers";
import { BytesLike } from "@ethersproject/bytes";
//import { MockPerpetualBaseFunctionsInterface } from "../typechain/MockPerpetualBaseFunctions";
import { createOracle, createLiquidityPool, createPerpetual, createPerpetualManager, createMockPerpetual } from "./TestFactory";
import { runLiquidityPool } from "../scripts/deployment/deploymentUtil";
const ONE_64x64 = BigNumber.from("0x10000000000000000");
const ONE_DEC18 = BigNumber.from(10).pow(BigNumber.from(18));

let accounts, perpetual, poolData, owner, manager, perpetualId, mockMarginViewLogic;
let baseParamsBTC: BigNumber[];
let s2: number, s3: number, premiumrate: number;

async function initPerp(_perpetualId) {
    s2 = 47200;
    s3 = 3600;
    premiumrate = 5 / s2;

    manager.setGenericPriceData(_perpetualId, "indexS2PriceData", floatToABK64x64(s2));
    manager.setGenericPriceData(_perpetualId, "indexS3PriceData", floatToABK64x64(s3));
    manager.setGenericPriceData(_perpetualId, "currentMarkPremiumRate", floatToABK64x64(premiumrate));
    manager.setPerpetualState(_perpetualId, PerpetualStateNORMAL);
    perpetual = await manager.getPerpetual(_perpetualId);
}

/*
    _getLiquidityPoolFromPerpetual
    _getPoolIdFromPerpetual
    _getPerpetual
    _isEmptyAccount
    _updateTraderMargin
    _transferFromUserToVault
    _transferFromVaultToUser
    _getAveragePrice
    _getAvailableCash
    _getBaseToCollateralConversionMultiplier
    _getPerpetualMarkPrice
    _getCollateralToQuoteConversionMultiplier
    _updateMarkPrice
    _updatePremiumMarkPrice
    _updateInsurancePremium
    _prepareAMMAndMarketData
    _getAMMPerpLogic
    _checkWhitelist
    _checkMaxTotalTraderFundsExceeded
    _getRebalanceLogic
    _getTotalTraderFunds
*/

describe("PerpetualBaseFunctions", () => {
    before(async () => {
        accounts = await getAccounts();
        owner = accounts[0].address;

        manager = await createPerpetualManager();
        baseParamsBTC = getBTCBaseParams();
        mockMarginViewLogic = await createContract("MockPerpetualMarginViewLogic");

    });

    it("Margin Rate", async () => {
        //syntax: https://www.typescripttutorial.net/typescript-tutorial/typescript-object-type/

        /**/
        poolData = await createLiquidityPool(manager, owner);
        perpetualId = await createPerpetual(manager, poolData.id, baseParamsBTC, null, null, COLLATERAL_CURRENCY_BASE);
        perpetual = await manager.getPerpetual(perpetualId);
        let pos;
        let alphaInit = ABK64x64ToFloat(baseParamsBTC[0]);
        let alphaMaint = ABK64x64ToFloat(baseParamsBTC[2]);
        let beta = ABK64x64ToFloat(baseParamsBTC[1]);
        let marginCap = ABK64x64ToFloat(baseParamsBTC[3]);

        let posArray = [0.01, 0.1, 0.4, 0.5, 1, 4];
        for (var i = 0; i < posArray.length; i++) {
            pos = posArray[i];
            let positionSizeBC: BigNumber = floatToABK64x64(pos);

            let initRateExpected = floatToABK64x64(Math.min(marginCap, alphaInit + beta * pos));
            let maintRateExpected = floatToABK64x64(Math.min(marginCap - alphaInit + alphaMaint, alphaMaint + beta * pos));

            let margin1 = await mockMarginViewLogic.getInitialMarginRate(positionSizeBC, perpetual);
            let margin2 = await mockMarginViewLogic.getMaintenanceMarginRate(positionSizeBC, perpetual);
            let isEqual = equalForPrecision(margin1, initRateExpected, 16);
            if (!isEqual) {
                console.log("Initial Margin for pos=", pos);
                console.log("Expected=", ABK64x64ToFloat(margin1));
                console.log("Received=", ABK64x64ToFloat(initRateExpected));
            }
            expect(isEqual).to.be.true;

            isEqual = equalForPrecision(margin2, maintRateExpected, 16);
            if (!isEqual) {
                console.log("Maintenance Margin for pos=", pos);
                console.log("Expected=", ABK64x64ToFloat(margin2));
                console.log("Received=", ABK64x64ToFloat(maintRateExpected));
            }
            expect(isEqual).to.be.true;
        }
    });

    describe("Conversions", () => {
        it("BaseToCollateralConversion CollateralBase: no markprice", async () => {
            poolData = await createLiquidityPool(manager, owner);
            perpetualId = await createPerpetual(manager, poolData.id, baseParamsBTC, null, null, COLLATERAL_CURRENCY_BASE);
            await initPerp(perpetualId);
            let isMarkPrice = false;
            let value = await manager.getBaseToCollateralConversionMultiplier(perpetualId, isMarkPrice);
            let isEqual = equalForPrecision(value, floatToABK64x64(1), 16);
            if (!isEqual) {
                console.log("Value=", ABK64x64ToFloat(value));
                console.log("Expected=", floatToABK64x64(1));
            }
            expect(isEqual).to.be.true;
        });

        it("BaseToCollateralConversion CollateralBase: at markprice", async () => {
            let isMarkPrice = true;
            let value = await manager.getBaseToCollateralConversionMultiplier(perpetualId, isMarkPrice);
            let resExpected = premiumrate + 1;
            let isEqual = equalForPrecision(value, floatToABK64x64(resExpected), 16);
            if (!isEqual) {
                console.log("Test failed:");
                console.log("Value=", ABK64x64ToFloat(value));
                console.log("Expected=", resExpected);
            }
            expect(isEqual).to.be.true;
        });

        it("CollateralToQuoteConversion CollateralBase", async () => {
            let value = await manager.getCollateralToQuoteConversionMultiplier(perpetualId);
            let resExpected = s2;
            let isEqual = equalForPrecision(value, floatToABK64x64(resExpected), 16);
            if (!isEqual) {
                console.log("Test failed:");
                console.log("Value=", ABK64x64ToFloat(value));
                console.log("Expected=", resExpected);
            }
            expect(isEqual).to.be.true;
        });

        it("BaseToCollateralConversion CollateralQuote: no MarkPrice", async () => {
            poolData = await createLiquidityPool(manager, owner);
            perpetualId = await createPerpetual(manager, poolData.id, baseParamsBTC, null, null, COLLATERAL_CURRENCY_QUOTE);
            await initPerp(perpetualId);
            let isMarkPrice = false;
            let value = await manager.getBaseToCollateralConversionMultiplier(perpetualId, isMarkPrice);
            let isEqual = equalForPrecision(value, floatToABK64x64(s2), 16);
            if (!isEqual) {
                console.log("Value=", ABK64x64ToFloat(value));
                console.log("Expected=", s2);
            }
            expect(isEqual).to.be.true;
        });

        it("BaseToCollateralConversion CollateralQuote: at MarkPrice", async () => {
            let isMarkPrice = true;
            let value = await manager.getBaseToCollateralConversionMultiplier(perpetualId, isMarkPrice);
            let isEqual = equalForPrecisionFloat(ABK64x64ToFloat(value), s2 * (1 + premiumrate), 14);
            if (!isEqual) {
                console.log("Value=", ABK64x64ToFloat(value));
                console.log("Expected=", s2 * (1 + premiumrate));
            }
            expect(isEqual).to.be.true;
        });

        it("CollateralToQuoteConversion CollateralQuote", async () => {
            let value = await manager.getCollateralToQuoteConversionMultiplier(perpetualId);
            let resExpected = 1;
            let isEqual = equalForPrecision(value, floatToABK64x64(resExpected), 16);
            if (!isEqual) {
                console.log("Test failed:");
                console.log("Value=", ABK64x64ToFloat(value));
                console.log("Expected=", resExpected);
            }
            expect(isEqual).to.be.true;
        });

        it("BaseToCollateralConversion CollateralQuanto: no MarkPrice", async () => {
            poolData = await createLiquidityPool(manager, owner);
            perpetualId = await createPerpetual(manager, poolData.id, baseParamsBTC, null, null, COLLATERAL_CURRENCY_QUANTO);
            await manager.runLiquidityPool(poolData.id);
            await initPerp(perpetualId);
            let isMarkPrice = false;
            let valueExpected = s2 / s3;
            let value = await manager.getBaseToCollateralConversionMultiplier(perpetualId, isMarkPrice);
            let isEqual = equalForPrecision(value, floatToABK64x64(valueExpected), 15);
            if (!isEqual) {
                console.log("Value=", ABK64x64ToFloat(value));
                console.log("Expected=", valueExpected);
            }
            expect(isEqual).to.be.true;
        });

        it("BaseToCollateralConversion CollateralQuanto: at MarkPrice", async () => {
            let isMarkPrice = true;
            let valueExpected = (s2 * (1 + premiumrate)) / s3;
            let value = await manager.getBaseToCollateralConversionMultiplier(perpetualId, isMarkPrice);
            let isEqual = equalForPrecision(value, floatToABK64x64(valueExpected), 15);
            if (!isEqual) {
                console.log("Value=", ABK64x64ToFloat(value));
                console.log("Expected=", valueExpected);
            }
            expect(isEqual).to.be.true;
        });

        it("CollateralToQuoteConversion CollateralQuanto", async () => {
            let value = await manager.getCollateralToQuoteConversionMultiplier(perpetualId);
            let resExpected = s3;
            let isEqual = equalForPrecision(value, floatToABK64x64(resExpected), 16);
            if (!isEqual) {
                console.log("Test failed:");
                console.log("Value=", ABK64x64ToFloat(value));
                console.log("Expected=", resExpected);
            }
            expect(isEqual).to.be.true;
        });
    });

    describe("Margin", () => {
        let lockedInValueQC: BigNumber = floatToABK64x64(47000);
        let posBC: BigNumber = ONE_64x64;
        let cashCC: BigNumber;
        it("Margin: Base currency collateral 1", async () => {
            // test margin for margin/liquidity pool funds held in base currency (BTCUSD held in BTC)
            poolData = await createLiquidityPool(manager, owner);
            perpetualId = await createPerpetual(manager, poolData.id, baseParamsBTC, null, null, COLLATERAL_CURRENCY_BASE);
            await initPerp(perpetualId);

            let ratioMM = await mockMarginViewLogic.getMaintenanceMarginRate(posBC, perpetual);

            let ratioIM = await mockMarginViewLogic.getInitialMarginRate(posBC, perpetual);
            cashCC = mul64x64(ratioIM, posBC);

            await manager.setMarginAccount(perpetualId, manager.address, lockedInValueQC, cashCC, posBC);
            let conversion = 1; //(s2 + 0*premium) / s2; // conversion at spot price

            let mm = await manager.getMaintenanceMargin(perpetualId, manager.address);
            let mmExpected = ABK64x64ToFloat(mul64x64(ratioMM, posBC)) * conversion;
            let isEqual = equalForPrecisionFloat(ABK64x64ToFloat(mm), mmExpected, 16);
            if (!isEqual) {
                console.log("Test failed 1:");
                console.log("Value=", ABK64x64ToFloat(mm));
                console.log("Expected=", mmExpected);
            }
            expect(isEqual).to.be.true;

            let im = await manager.getInitialMargin(perpetualId, manager.address);
            let imExpected = ABK64x64ToFloat(mul64x64(ratioIM, posBC)) * conversion;
            isEqual = equalForPrecision(im, floatToABK64x64(imExpected), 16);
            if (!isEqual) {
                console.log("Test failed 2:");
                console.log("ratio im = ", ABK64x64ToFloat(ratioIM));
                console.log("Value=", ABK64x64ToFloat(im));
                console.log("Expected=", imExpected);
            }
            expect(isEqual).to.be.true;
        });

        it("Margin Balance: Base currency collateral 2", async () => {
            let balance = await manager.getMarginBalance(perpetualId, manager.address);
            let base2coll = ONE_64x64; // at index price
            let lockedInValueCC = div64x64(mul64x64(lockedInValueQC, ONE_64x64), floatToABK64x64(s2));

            let avail_margin = add64x64(sub64x64(mul64x64(posBC, base2coll), lockedInValueCC), cashCC);
            let isEqual = equalForPrecision(balance, avail_margin, 16);
            if (!isEqual) {
                console.log("Test margin balance failed:");
                console.log("Value=", ABK64x64ToFloat(balance));
                console.log("Expected=", ABK64x64ToFloat(avail_margin));
            }
            expect(isEqual).to.be.true;
        });

        it("Available Margin: Base currency collateral, pos!=0", async () => {
            // initial margin
            let availMgn = await manager.getAvailableMargin(perpetualId, manager.address, true);
            let balance = await manager.getMarginBalance(perpetualId, manager.address);
            let marginRate1 = await mockMarginViewLogic.getInitialMarginRate(posBC, perpetual);
            let base2coll = ONE_64x64; // at index price
            let initMargin = mul64x64(base2coll, mul64x64(marginRate1, abs64x64(posBC)));
            let im = await manager.getInitialMargin(perpetualId, manager.address);
            let avMgn1 = sub64x64(balance, initMargin);
            let isEqual = equalForPrecision(availMgn, avMgn1, 16);
            if (!isEqual) {
                console.log("Test available initial margin failed:");
                console.log("Value=", ABK64x64ToFloat(availMgn));
                console.log("Expected=", ABK64x64ToFloat(avMgn1));
            }
            expect(isEqual).to.be.true;

            // maintenance margin
            availMgn = await manager.getAvailableMargin(perpetualId, manager.address, false);
            let marginRate2 = await mockMarginViewLogic.getMaintenanceMarginRate(posBC, perpetual);
            let maintMargin = mul64x64(base2coll, mul64x64(marginRate2, abs64x64(posBC)));
            let avMgn2 = sub64x64(balance, maintMargin);
            isEqual = equalForPrecision(availMgn, avMgn2, 16);
            if (!isEqual) {
                console.log("Test available maintenance margin failed:");
                console.log("Value=", ABK64x64ToFloat(availMgn));
                console.log("Expected=", ABK64x64ToFloat(avMgn2));
            }
            expect(isEqual).to.be.true;
        });

        it("Available Margin: Base currency collateral, pos=0", async () => {
            await manager.setMarginAccount(perpetualId, manager.address, 0, cashCC, 0);
            let availMgn = await manager.getAvailableMargin(perpetualId, manager.address, true);
            let balance = await manager.getMarginBalance(perpetualId, manager.address);
            let initMargin = await manager.getInitialMargin(perpetualId, manager.address);
            let MgnExpt = sub64x64(balance, initMargin);
            let isEqual = equalForPrecision(availMgn, MgnExpt, 16);
            if (!isEqual) {
                console.log("Test available maintenance margin failed:");
                console.log("Value=", ABK64x64ToFloat(availMgn));
                console.log("Expected=", ABK64x64ToFloat(MgnExpt));
            }
            expect(isEqual).to.be.true;
        });

        it("Margin: Quote currency collateral 1", async () => {
            // restore margin account values
            await manager.setMarginAccount(perpetualId, manager.address, lockedInValueQC, cashCC, posBC);

            // test margin for margin/liquidity pool funds held in QUOTE currency (BTCUSDC held in USDC)
            // this time calculate with numbers in ABDK64x64 format for a change
            poolData = await createLiquidityPool(manager, owner);
            perpetualId = await createPerpetual(manager, poolData.id, baseParamsBTC, null, null, COLLATERAL_CURRENCY_QUOTE);
            await initPerp(perpetualId);
            lockedInValueQC = floatToABK64x64(47000);
            posBC = fractionToABDK64x64(3, 10);
            let ratioMM = await mockMarginViewLogic.getMaintenanceMarginRate(posBC, perpetual);
            let ratioIM = await mockMarginViewLogic.getInitialMarginRate(posBC, perpetual);
            cashCC = mul64x64(ratioIM, posBC);

            await manager.setMarginAccount(perpetualId, manager.address, lockedInValueQC, cashCC, posBC);
            let conversion = floatToABK64x64(s2);
            let mm = await manager.getMaintenanceMargin(perpetualId, manager.address);
            let mmExpected = mul64x64(mul64x64(ratioMM, posBC), conversion);
            let isEqual = equalForPrecision(mm, mmExpected, 15);
            if (!isEqual) {
                console.log("Test MM failed:");
                console.log("Value=", ABK64x64ToFloat(mm));
                console.log("Expected=", ABK64x64ToFloat(mmExpected));
            }
            expect(isEqual).to.be.true;

            let im = await manager.getInitialMargin(perpetualId, manager.address);
            let imExpected = mul64x64(mul64x64(ratioIM, posBC), conversion);
            isEqual = equalForPrecision(im, imExpected, 14);
            if (!isEqual) {
                console.log("Test IM failed:");
                console.log("Value=", ABK64x64ToFloat(im));
                console.log("Expected=", ABK64x64ToFloat(imExpected));
            }
            expect(isEqual).to.be.true;
        });

        it("Margin Balance: Quote currency collateral 2", async () => {
            let balance = await manager.getMarginBalance(perpetualId, manager.address);
            let base2coll = floatToABK64x64(s2);
            let lockedInValueCC = lockedInValueQC;
            let avail_margin = add64x64(sub64x64(mul64x64(posBC, base2coll), lockedInValueCC), cashCC);
            let isEqual = equalForPrecision(balance, avail_margin, 18);
            if (!isEqual) {
                console.log("Test margin balance failed:");
                console.log("Value=", ABK64x64ToFloat(balance));
                console.log("Expected=", ABK64x64ToFloat(avail_margin));
            }
            expect(isEqual).to.be.true;
        });
    }); //margin

    describe("Update MarkPrice", () => {
        let newEWMAPremium;
        let lockedInValueQC, posBC, cashCC;
        before(async () => {
            poolData = await createLiquidityPool(manager, owner);
            perpetualId = await createPerpetual(manager, poolData.id, baseParamsBTC, null, null, COLLATERAL_CURRENCY_QUOTE);
            await initPerp(perpetualId);

            // set margin account of AMM
            lockedInValueQC = floatToABK64x64(-47000);
            posBC = fractionToABDK64x64(-3, 10);
            cashCC = floatToABK64x64(((47000 * 3) / 10) * 0.2);

            await manager.setMarginAccount(perpetualId, manager.address, lockedInValueQC, cashCC, posBC);
        });

        it("_prepareAMMAndMarketData must not fail", async () => {
            let tx = await manager.prepareAMMAndMarketData(perpetualId, 0);
        });

        it("EWMA must be updated", async () => {
            await manager.updateMarkPrice(perpetualId);
            let EWMAstart = perpetual.currentMarkPremiumRate.fPrice;
            // check updated numbers
            perpetual = await manager.getPerpetual(perpetualId);

            //let currentPremium = BigNumber.from(0);
            let lxEMA = mul64x64(perpetual.fMarkPriceEMALambda, EWMAstart);
            let EMAUpdate = mul64x64(sub64x64(ONE_64x64, perpetual.fMarkPriceEMALambda), perpetual.fCurrentPremiumRate);
            newEWMAPremium = add64x64(lxEMA, EMAUpdate);

            let isEqual = equalForPrecision(newEWMAPremium, perpetual.premiumRatesEMA, 18);
            if (!isEqual) {
                console.log("Test EWMA update failed:");
                console.log("Value=", ABK64x64ToFloat(perpetual.premiumRatesEMA));
                console.log("Expected=", ABK64x64ToFloat(newEWMAPremium));
            }
            expect(isEqual).to.be.true;
        });
    });
    describe("Token transfer", () => {
        it("User to vault", async () => {
            let amount = 2;
            let amountDec18 = ONE_DEC18.mul(amount);
            let amount64x64 = ONE_64x64.mul(amount);
            let marginToken = poolData.marginToken;
            await marginToken.approve(manager.address, ONE_64x64.mul(1000));

            let traderBalanceBefore = await marginToken.balanceOf(owner);
            //console.log(traderBalanceBefore.toString());
            //console.log(amountDec18.toString());
            let vaultBalanceBefore = await marginToken.balanceOf(manager.address);
            await manager.transferFromUserToVault(marginToken.address, owner, amount64x64);
            let traderBalanceAfter = await marginToken.balanceOf(owner);
            let vaultBalanceAfter = await marginToken.balanceOf(manager.address);
            expect(traderBalanceAfter == traderBalanceBefore - amountDec18);
            expect(vaultBalanceAfter - amountDec18 == vaultBalanceBefore);
        });
        it("Vault to user", async () => {
            let amount = 2;
            let amountDec18 = ONE_DEC18.mul(amount);
            let amount64x64 = ONE_64x64.mul(amount);
            let marginToken = poolData.marginToken;
            await marginToken.approve(manager.address, ONE_64x64.mul(1000));

            let traderBalanceBefore = await marginToken.balanceOf(owner);
            //console.log(traderBalanceBefore.toString());
            //console.log(amountDec18.toString());
            let vaultBalanceBefore = await marginToken.balanceOf(manager.address);
            await manager.transferFromVaultToUser(marginToken.address, owner, amount64x64);
            let traderBalanceAfter = await marginToken.balanceOf(owner);
            let vaultBalanceAfter = await marginToken.balanceOf(manager.address);
            expect(traderBalanceAfter == traderBalanceBefore + amountDec18);
            expect(vaultBalanceAfter + amountDec18 == vaultBalanceBefore);
        });
    });
});
