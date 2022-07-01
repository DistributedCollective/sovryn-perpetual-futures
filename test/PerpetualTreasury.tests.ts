// @ts-nocheck
import { expect, use, util } from "chai";
const { ethers } = require("hardhat");
import { waffleChai } from "@ethereum-waffle/chai";
import { fromBytes32, toBytes32, createContract, getAccounts } from "../scripts/utils/utils";
import { deployMockContract } from "ethereum-waffle";
import * as fs from "fs";
import {
    createOracle,
    createLiquidityPool,
    createPerpetual,
    createPerpetualManager,
    getBTCBaseParams,
    getBTCRiskParams,
    getBTCFundRiskParams,
} from "./TestFactory";
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
} from "../scripts/utils/perpMath";
import { BigNumber } from "@ethersproject/bignumber";
import { float } from "hardhat/internal/core/params/argumentTypes";
const BN = ethers.BigNumber;

const ONE_DEC18 = BN.from(10).pow(BN.from(18));
const ONE_64x64 = BN.from("0x010000000000000000");

const BTC = toBytes32("BTC");
const USD = toBytes32("USD");
const ETH = toBytes32("ETH");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const COLLATERAL_CURRENCY_QUOTE = 0;
const COLLATERAL_CURRENCY_BASE = 1;
const COLLATERAL_CURRENCY_QUANTO = 2;

const PERPETUAL_STATE_INVALID = 0;
const PERPETUAL_STATE_INITIALIZING = 1;
const PERPETUAL_STATE_NORMAL = 2;
const PERPETUAL_STATE_EMERGENCY = 3;
const PERPETUAL_STATE_CLEARED = 4;

const numPerpetuals = 3;
/*
    More tests in PerpetualTreasury.tests.ts

*/
describe("PerpetualTreasury", () => {
    let accounts, owner;
    let manager;
    let poolId, poolIdEmpty;
    let perpetualIds;
    let marginToken;

    async function createOracles() {
        const BTC = toBytes32("BTC");
        const USD = toBytes32("USD");
        const ETH = toBytes32("ETH");
        let prices : BigNumber[] = [];
        for(var k = 0; k<20; k++) {
            prices.push(floatToABK64x64(40000));
        }
        let oracleBTCUSD = await createContract("MockPriceScenarioOracle", [BTC, USD, prices]);
        let oracles = [oracleBTCUSD.address, await createOracle(ETH, USD)];
        return oracles
    }

    async function getPoolAndPerpCash(poolId, perpetualId) {
        let pool = await manager.getLiquidityPool(poolId); 
        let perp = await manager.getPerpetual(perpetualId);
        let fAMMFundCash = perp.fAMMFundCashCC;
        let fAMMPoolCash = pool.fAMMFundCashCC;
        return [fAMMFundCash, fAMMPoolCash];
    }

    before(async () => {
        accounts = await getAccounts();
        owner = accounts[0].address;
        manager = await createPerpetualManager();
        let poolData = await createLiquidityPool(manager, owner);
        poolId = poolData.id;
        marginToken = poolData.marginToken;

        let oracles = await createOracles();
        perpetualIds = new Array();
        for (let i = 0; i < numPerpetuals; i++) {
            let id = await createPerpetual(manager, poolData.id, getBTCBaseParams(), null, null, COLLATERAL_CURRENCY_BASE, oracles);
            perpetualIds.push(id);
        }
        await marginToken.approve(manager.address, ONE_64x64.mul(1000));
        await manager.addAmmGovernanceAddress(accounts[0].address);
    });

    describe("Pool not running", async () => {
        it("add AMM funds to perpetuals when pool not running", async () => {
            for (let i = 0; i < numPerpetuals; i++) {
                let fAMMCashBefore, fAMMPoolCashBefore, fAMMCashAfter, fAMMPoolCashAfter;
                [fAMMCashBefore, fAMMPoolCashBefore] = await getPoolAndPerpCash(poolId, perpetualIds[i]);
                await manager.connect(accounts[0]).addAMMLiquidityToPerpetual(perpetualIds[i], floatToABK64x64(2));
                [fAMMCashAfter, fAMMPoolCashAfter] = await getPoolAndPerpCash(poolId, perpetualIds[i]);
                expect(fAMMCashAfter.sub(fAMMCashBefore)).to.be.equal(floatToABK64x64(2));
                expect(fAMMPoolCashAfter).to.be.equal(fAMMPoolCashBefore);
            }
        }); 
        it("shouldn't add LP funds when pool not running", async () => {
            await expect(manager.connect(accounts[0]).addLiquidity(poolId, floatToABK64x64(1))).to.be.revertedWith("pool not running");
        });
        it("shouldn't add LP funds to non existent pool", async () => {
            await expect(manager.connect(accounts[0]).addLiquidity(poolId * 2, floatToABK64x64(1))).to.be.revertedWith("no perp in pool");
        });
    });

    describe("PerpetualTreasury for running pool", async () => {
        before(async () => {
            await manager.runLiquidityPool(poolId);
        });
        
        it("only governance can add AMM funds", async () => {
            await expect(manager.connect(accounts[3]).addAMMLiquidityToPerpetual(perpetualIds[1], floatToABK64x64(2))).to.be.revertedWith("onlyGovernance address allowed");
        });

        it("add AMM funds when pool running", async () => {
            let fAMMCashBefore, fAMMPoolCashBefore, fAMMCashAfter, fAMMPoolCashAfter;
            [fAMMCashBefore, fAMMPoolCashBefore] = await getPoolAndPerpCash(poolId, perpetualIds[1]);

            await manager.connect(accounts[0]).addAMMLiquidityToPerpetual(perpetualIds[1], floatToABK64x64(2));

            [fAMMCashAfter, fAMMPoolCashAfter] = await getPoolAndPerpCash(poolId, perpetualIds[1]);
            expect(fAMMCashAfter.sub(fAMMCashBefore)).to.be.equal(floatToABK64x64(2));
            expect(fAMMPoolCashAfter.sub(fAMMPoolCashBefore)).to.be.equal(floatToABK64x64(2));
        });

        it("add LP funds", async () => {
            let pool = await manager.getLiquidityPool(poolId);
            let fundsBefore = pool.fPnLparticipantsCashCC;
            let LPBalanceBeforeDC18 = await marginToken.balanceOf(accounts[0].address);
            let amountToAdd = 4;
            await manager.connect(accounts[0]).addLiquidity(poolId, floatToABK64x64(amountToAdd));

            let LPBalanceAfterDC18 = await marginToken.balanceOf(accounts[0].address);
            pool = await manager.getLiquidityPool(poolId);
            let fundsafter = pool.fPnLparticipantsCashCC;
            /*
            console.log("LP balance before=", (LPBalanceBeforeDC18));
            console.log("LP balance after =", (LPBalanceAfterDC18));
            console.log("PnL fund before=", ABK64x64ToFloat(fundsBefore));
            console.log("PnL fund after =", ABK64x64ToFloat(fundsafter));*/
            expect(fundsafter.sub(fundsBefore)).to.be.equal(floatToABK64x64(amountToAdd));
            expect(LPBalanceBeforeDC18.sub(LPBalanceAfterDC18)).to.be.equal(BN.from(10).pow(18).mul(amountToAdd));

        });

        it("remove LP funds", async () => {
            let pool = await manager.getLiquidityPool(poolId);
            let fundsBefore = pool.fPnLparticipantsCashCC;
            let LPBalanceBeforeDC18 = await marginToken.balanceOf(accounts[0].address);
            let amountToRemove = 2;
            await manager.connect(accounts[0]).removeLiquidity(poolId, floatToABK64x64(amountToRemove));
            
            let LPBalanceAfterDC18 = await marginToken.balanceOf(accounts[0].address);
            pool = await manager.getLiquidityPool(poolId);
            let fundsafter = pool.fPnLparticipantsCashCC;
            expect(fundsBefore.sub(fundsafter)).to.be.equal(floatToABK64x64(amountToRemove));
            expect(LPBalanceAfterDC18.sub(LPBalanceBeforeDC18)).to.be.equal(BN.from(10).pow(18).mul(amountToRemove));
        });
        
    });

    describe("Running pool, 1 perps emergency", async () => {
        before(async () => {
            await manager.setEmergencyState(perpetualIds[1]);
        });
        it("add LP funds when some active perpetuals", async () => {
            let pool = await manager.getLiquidityPool(poolId);
            let fundsBefore = pool.fPnLparticipantsCashCC;
            await manager.connect(accounts[0]).addLiquidity(poolId, floatToABK64x64(0.2));
            pool = await manager.getLiquidityPool(poolId);
            let fundsafter = pool.fPnLparticipantsCashCC;
            expect(fundsafter.sub(fundsBefore)).to.be.equal(floatToABK64x64(0.2));
        });
        it("shouldn't remove LP funds when emergency", async () => {
            await expect(manager.connect(accounts[0]).removeLiquidity(poolId, floatToABK64x64(1))).to.be.revertedWith("no withdraw in emergency");
        });
    });
    describe("Running pool, 1 perps settled", async () => {
        before(async () => {
            // settle perp
            let perp = await manager.getPerpetual(perpetualIds[1]);
            let state = perp.state;
            while (state != PERPETUAL_STATE_CLEARED) {
                await manager.settleNextTraderInPool(poolId);
                perp = await manager.getPerpetual(perpetualIds[1]);
                state = perp.state;
            }
            

        });
        
        it("can remove LP funds when settled", async () => {
            let pool = await manager.getLiquidityPool(poolId);
            let fundsBefore = pool.fPnLparticipantsCashCC;
            let LPBalanceBeforeDC18 = await marginToken.balanceOf(accounts[0].address);
            let amountToRemove = 2;

            await manager.connect(accounts[0]).removeLiquidity(poolId, floatToABK64x64(amountToRemove));
            
            let LPBalanceAfterDC18 = await marginToken.balanceOf(accounts[0].address);
            pool = await manager.getLiquidityPool(poolId);
            let fundsafter = pool.fPnLparticipantsCashCC;
            
            let isEqual = equalForPrecision(fundsBefore.sub(fundsafter), floatToABK64x64(amountToRemove), 12);
            isEqual = isEqual && equalForPrecision(LPBalanceAfterDC18.sub(LPBalanceBeforeDC18), BN.from(10).pow(18).mul(amountToRemove), 12);
            expect(isEqual).to.be.true;
        });

        it("can call remove LP funds with more than available", async () => {
            let amountToRemove = 2;
            let amountToAdd = 1;
            let pool = await manager.getLiquidityPool(poolId);
            let minAmt = pool.fPnLparticipantWithdrawalMinAmountLimit;
            let withdrawPeriod = pool.iPnLparticipantWithdrawalPeriod
            // console.log("minAmt = ", ABK64x64ToFloat(minAmt));
            // console.log("time = ", withdrawPeriod.toString());
            await manager.connect(accounts[0]).addLiquidity(poolId, floatToABK64x64(amountToAdd));
            // Increasing block.timestamp to avoid withdraw limit exceeded
            await hre.ethers.provider.send('evm_increaseTime', [29800]); 
            await manager.connect(accounts[0]).removeLiquidity(poolId, minAmt);
            // undo increase
            await hre.ethers.provider.send('evm_increaseTime', [-29800]); 
        });  
    });    
});
    