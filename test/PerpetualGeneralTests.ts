// @ts-nocheck
import { expect } from "chai";
const { ethers } = require("hardhat");
import { getAccounts } from "../scripts/utils/utils";
import { createLiquidityPool, createPerpetual, createPerpetualManager } from "./TestFactory";
import {
    equalForPrecision,
    equalForPrecisionFloat,
    add64x64,
    sub64x64,
    mul64x64,
    div64x64,
    abs64x64,
    floatToABK64x64,
    ABK64x64ToFloat,
    fractionToABDK64x64,
    toDec18,
    calcKStar,
    calculateFundingRate,
    PerpetualStateNORMAL,
    calculateAMMTargetSize,
    getDFTargetSize,
    COLLATERAL_CURRENCY_BASE,
    COLLATERAL_CURRENCY_QUOTE,
    COLLATERAL_CURRENCY_QUANTO,
} from "../scripts/utils/perpMath";
import { lup } from "mathjs";
import { getBTCBaseParams, createPerpetual, createPerpetualManager, createLiquidityPool } from "./TestFactory";

const BN = ethers.BigNumber;

let accounts, perpetual, poolData, owner, manager, perpetualId;
let baseParamsBTC: BigNumber[];
let S2, S3;

const PerpetualStateINVALID = 0;
const PerpetualStateINITIALIZING = 1;
const PerpetualStateNORMAL = 2;
const PerpetualStateEMERGENCY = 3;
const PerpetualStateCLEARED = 4;

describe("Spin up perpetuals", () => {
    it("quanto", async () => {
        console.log(floatToABK64x64(0.75));
        accounts = await getAccounts();
        owner = accounts[0].address;

        manager = await createPerpetualManager();
        poolData = await createLiquidityPool(manager, owner);
        perpetualId = await createPerpetual(manager, poolData.id, null, null, null, COLLATERAL_CURRENCY_QUANTO);
        await manager.runLiquidityPool(poolData.id);
    });
    it("quote", async () => {
        poolData = await createLiquidityPool(manager, owner);
        perpetualId = await createPerpetual(manager, poolData.id, null, null, null, COLLATERAL_CURRENCY_QUOTE);
        await manager.runLiquidityPool(poolData.id);
        /*
        console.log("12");
        lp = await manager.getLiquidityPool(poolData.id);
        let isR = lp.isRunning;
        console.log("running=",isR);
        let L1 = 1000;
        let cash = 5;
        let K2 = 2;

        await manager.setMarginAccount(perpetualId, manager.address,
            floatToABK64x64(-L1),
            floatToABK64x64(cash),
            floatToABK64x64(-K2));*/
    });
    it("deposit and withdraw", async () => {
        let traderAcc = accounts[0]; //owner
        let amount = 19.957582281727312;
        await poolData.marginToken.connect(traderAcc).approve(manager.address, floatToABK64x64(1000));
        await poolData.marginToken.mint(traderAcc.address, floatToABK64x64(100));
        await manager.connect(traderAcc).deposit(perpetualId, floatToABK64x64(amount));
        let marginAccount = await manager.getMarginAccount(perpetualId, traderAcc.address);
        console.log("Amount available = ", ABK64x64ToFloat(marginAccount.fCashCC));
        await manager.connect(traderAcc).withdraw(perpetualId, floatToABK64x64(amount));
    });
    it("should not leave dust when withdrawing", async () => {
        let traderAcc = accounts[0]; //owner
        let amount = 19.957582281727312;
        await poolData.marginToken.connect(traderAcc).approve(manager.address, floatToABK64x64(1000));
        await manager.connect(traderAcc).deposit(perpetualId, floatToABK64x64(amount));
        let marginAccount = await manager.getMarginAccount(perpetualId, traderAcc.address);
        console.log("Amount available = ", ABK64x64ToFloat(marginAccount.fCashCC));
        perpetual = await manager.getPerpetual(perpetualId);
        let minAmount = ABK64x64ToFloat(perpetual.fReferralRebateCC);
        let dustWithdrawal = ABK64x64ToFloat(marginAccount.fCashCC) - minAmount/2;
        await manager.connect(traderAcc).withdraw(perpetualId, floatToABK64x64(dustWithdrawal));
        // dust?
        marginAccount = await manager.getMarginAccount(perpetualId, traderAcc.address);
        let isEqual = marginAccount.fCashCC.toString()=="0";
        if (!isEqual) {
            console.log("margin account cash = ", marginAccount.fCashCC.toString());
            console.log("margin account cash expected 0");
        }
        expect(isEqual).to.be.true;
    });
});
