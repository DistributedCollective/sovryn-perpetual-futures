// @ts-nocheck
import { expect } from "chai";
const { ethers } = require("hardhat");
import { BigNumberish, BigNumber} from "ethers";
import { getAccounts, toBytes32,createContract } from "../scripts/utils/utils";
import { createLiquidityPool, createPerpetual, createPerpetualManager,createOracle } from "./TestFactory";
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
    dec18ToFloat,
    floatToDec18,
    calculateFundingRate,
    PerpetualStateNORMAL,
    calculateAMMTargetSize,
    getDFTargetSize,
    COLLATERAL_CURRENCY_BASE,
    COLLATERAL_CURRENCY_QUOTE,
    COLLATERAL_CURRENCY_QUANTO,
    fromDec18,
} from "../scripts/utils/perpMath";
import {getBTCBaseParams} from "./TestFactory";
import { isEvmStep } from "hardhat/internal/hardhat-network/stack-traces/message-trace";
import { trade } from "./tradeFunctions";


const BN = ethers.BigNumber;
const ONE_DEC18 = BN.from(10).pow(BN.from(18));
let accounts, perpetual, poolData, owner, manager, perpetualId;
let governanceAccount;
let oracles;
let perpetualIds : BigNumber[];
let baseParamsBTC: BigNumber[];
let S2, S3;
const MASK_MARKET_ORDER = BN.from("0x40000000");
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PerpetualStateINVALID = 0;
const PerpetualStateINITIALIZING = 1;
const PerpetualStateNORMAL = 2;
const PerpetualStateEMERGENCY = 3;
const PerpetualStateCLEARED = 4;
const numPerpetuals = 3;
/* 
    Test whether amount of tokens in contracts is zero
    after settling and paying out all traders & treasury
*/

describe("PerpetualSettlementIntegration", () => {
    

    beforeEach(async () => {
        accounts = await getAccounts();
        owner = accounts[0].address;

        manager = await createPerpetualManager();
        poolData = await createLiquidityPool(manager, owner);
        S2 = 60000;
        let S2Oracle = S2;
        let prices : BigNumber[] = [];
        for(var k = 0; k<20; k++) {
            prices.push(floatToABK64x64(S2Oracle));
        }
        const BTC = toBytes32("BTC");
        const USD = toBytes32("USD");
        const ETH = toBytes32("ETH");
        let oracleBTCUSD = await createContract("MockPriceScenarioOracle", [BTC, USD, prices]);
        oracles = [oracleBTCUSD.address, await createOracle(ETH, USD)];
        governanceAccount = accounts[2];
        await manager.addAmmGovernanceAddress(governanceAccount.address);
        await poolData.marginToken.connect(governanceAccount).approve(manager.address, ONE_DEC18.mul(1000));

        perpetualIds = new Array();
        for (let i = 0; i < numPerpetuals; i++) {
            let id = await createPerpetual(manager, poolData.id, getBTCBaseParams(), null, null, COLLATERAL_CURRENCY_BASE, oracles);
            perpetualIds.push(id);
            // remove mock cash value
            await manager.setGenericPerpInt128(id, "fAMMFundCashCC", floatToABK64x64(0));
            // add proper cash
            await poolData.marginToken.mint(governanceAccount.address, ONE_DEC18.mul(1));
            await manager.connect(governanceAccount).addAMMLiquidityToPerpetual(id, floatToABK64x64(0.5));
        }
        let pool = await manager.getLiquidityPool(poolData.id);
        let fTotalPoolFunds = (pool.fDefaultFundCashCC).add(pool.fPnLparticipantsCashCC).add(pool.fAMMFundCashCC);

        await manager.runLiquidityPool(poolData.id);
        pool = await manager.getLiquidityPool(poolData.id);
        fTotalPoolFunds = (pool.fDefaultFundCashCC).add(pool.fPnLparticipantsCashCC).add(pool.fAMMFundCashCC);

        for (var j = 0; j<numPerpetuals; j++) {
            await manager.setGenericPriceData(perpetualIds[j], "indexS2PriceData", floatToABK64x64(S2));
            await manager.setGenericPriceData(perpetualIds[j], "settlementS2PriceData", floatToABK64x64(S2));
        }
    });

    async function fundAndApprove(manager) {
        await manager.addAmmGovernanceAddress(governanceAccount.address);
        await poolData.marginToken.mint(governanceAccount.address, ONE_DEC18.mul(100));
        await poolData.marginToken.mint(accounts[0].address, ONE_DEC18.mul(5));
        await poolData.marginToken.mint(accounts[1].address, ONE_DEC18.mul(5));
        await poolData.marginToken.mint(accounts[3].address, ONE_DEC18.mul(5));
        await poolData.marginToken.connect(governanceAccount).approve(manager.address, ONE_DEC18.mul(1000));
        await poolData.marginToken.connect(accounts[0]).approve(manager.address, ONE_DEC18.mul(1000));
        await poolData.marginToken.connect(accounts[1]).approve(manager.address, ONE_DEC18.mul(1000));
        await poolData.marginToken.connect(accounts[3]).approve(manager.address, ONE_DEC18.mul(1000));
    }

    it("front to back settlement", async () => {

        let doLog = false;

        function consolelog(...args) {
            if (doLog)
                console.log(...args);
        }
        function getLimitPrice(tradeAmt) {
            return tradeAmt<BigNumber.from(0) ? floatToABK64x64(1) : floatToABK64x64(100000);
        }
        async function getMngrMarginCash() {
            let traderStateArr = await manager.getTraderState(perpetualIds[0], manager.address);
            return traderStateArr[2];
        }
        function printPoolCash(pool) {
            consolelog("DF cash = ", ABK64x64ToFloat(pool.fDefaultFundCashCC));
            consolelog("PnL cash = ", ABK64x64ToFloat(pool.fPnLparticipantsCashCC));
            consolelog("AMM cash = ", ABK64x64ToFloat(pool.fAMMFundCashCC));
        }
        let poolId = 1;
        let fTotalPoolFunds, pool;
        await fundAndApprove(manager);

        pool = await manager.getLiquidityPool(poolId);
        fTotalPoolFunds = (pool.fDefaultFundCashCC).add(pool.fPnLparticipantsCashCC).add(pool.fAMMFundCashCC);
        printPoolCash(pool);
        let tmp0 = await poolData.marginToken.balanceOf(manager.address);
        consolelog("manager tokens =", dec18ToFloat(tmp0),"\n-----");
        // deposit amm-cash from governance to AMM vault & default fund
        let AMMFundCash = 10;
        let defaultFundAmount = 10;
        await manager.connect(governanceAccount).addAMMLiquidityToPerpetual(perpetualIds[0], floatToABK64x64(AMMFundCash));
        await manager.connect(accounts[0]).depositToDefaultFund(poolId, floatToABK64x64(defaultFundAmount));
        
        // trade from two accounts
        let tradeAmount = floatToABK64x64(-0.010);
        let fLeverage = floatToABK64x64(1);
        let tx = await sttlTestTrade(manager, perpetualIds[0], tradeAmount, getLimitPrice(tradeAmount), accounts[0], ZERO_ADDRESS, null, fLeverage);
        tradeAmount = floatToABK64x64(0.006);
        tx = await sttlTestTrade(manager, perpetualIds[0], tradeAmount, getLimitPrice(tradeAmount), accounts[0], ZERO_ADDRESS, null, fLeverage);
        tradeAmount = floatToABK64x64(-0.002);
        tx = await sttlTestTrade(manager, perpetualIds[0], tradeAmount, getLimitPrice(tradeAmount), accounts[1], ZERO_ADDRESS, null, fLeverage);
        // deposit to mgn account
        tx = await manager.connect(accounts[3]).deposit(perpetualIds[0], floatToABK64x64(2));
        // check funds before settling
        pool = await manager.getLiquidityPool(poolId);
        let fCash = await sttlCountTraderCash(manager, perpetualIds[0])
        consolelog("fCash =", ABK64x64ToFloat(fCash));
        fTotalPoolFunds = (pool.fDefaultFundCashCC).add(pool.fPnLparticipantsCashCC).add(pool.fAMMFundCashCC).add(fCash);
        consolelog("fTotalPoolFunds+cash =", ABK64x64ToFloat(fTotalPoolFunds));
        let tmp=await poolData.marginToken.balanceOf(manager.address);
        consolelog("manager tokens =", dec18ToFloat(tmp));
        tmp = await getMngrMarginCash();
        consolelog("manager margin cash=", ABK64x64ToFloat(tmp));
        consolelog("--");
        let active_addr = await manager.getActivePerpAccounts(perpetualIds[0]);
        // mgn balance
        let traderMgnBalance = floatToABK64x64(0);
        for(var k=0; k<active_addr.length; k++) {
            tmp = await manager.getMarginBalance(perpetualIds[0], active_addr[k]);
            traderMgnBalance = traderMgnBalance.add(tmp);
        }
        tmp = await manager.getMarginBalance(perpetualIds[0], manager.address);
        consolelog("Mgn balance mngr =", ABK64x64ToFloat(tmp));
        consolelog("Mgn balance all trdrs =", ABK64x64ToFloat(traderMgnBalance));
        
        // settle
        let mngBlncBeforeD18 = await poolData.marginToken.balanceOf(manager.address);
        let acc0BlncBeforeD18 = await poolData.marginToken.balanceOf(accounts[0].address);
        let acc1BlncBeforeD18 = await poolData.marginToken.balanceOf(accounts[1].address);
        
        await sttlTestSettle(manager, perpetualIds[1], poolId, false);
        await sttlTestSettle(manager, perpetualIds[2], poolId, false);
        await sttlTestSettle(manager, perpetualIds[0], poolId, false);
        
        let perp = await manager.getPerpetual(perpetualIds[0]);
        consolelog("Mgn balance all trdrs [perp] =", ABK64x64ToFloat(perp.fTotalMarginBalance));

        consolelog("-----\nafter settle")
        pool = await manager.getLiquidityPool(poolId);
        fCash = await sttlCountTraderCash(manager, perpetualIds[0])
        consolelog("fCash =", ABK64x64ToFloat(fCash));
        fTotalPoolFunds = (pool.fDefaultFundCashCC).add(pool.fPnLparticipantsCashCC).add(pool.fAMMFundCashCC);
        consolelog("fTotalPoolFunds =", ABK64x64ToFloat(fTotalPoolFunds) );
        perp = await manager.getPerpetual(perpetualIds[0]);
        consolelog("fTotalMarginBalance+fTotalPoolFunds =", ABK64x64ToFloat(perp.fTotalMarginBalance.add(fTotalPoolFunds)));
        tmp=await poolData.marginToken.balanceOf(manager.address);
        consolelog("manager tokens =", dec18ToFloat(tmp));
        consolelog("diff (should be zero)=", ABK64x64ToFloat(perp.fTotalMarginBalance.add(fTotalPoolFunds))-dec18ToFloat(tmp));
        consolelog("mngr tokens - fTotalPoolFunds (should be trader mgn)=", dec18ToFloat(tmp)-ABK64x64ToFloat(fTotalPoolFunds));
        //
        consolelog("--------\nPay traders:");
        await sttlSettleTraders(manager, perpetualIds[0], poolId, active_addr, governanceAccount, false);
        // token management
        let acc0BlncAfterD18 = await poolData.marginToken.balanceOf(accounts[0].address);
        let acc1BlncAfterD18 = await poolData.marginToken.balanceOf(accounts[1].address);
        let mngBlncAfterD18 = await poolData.marginToken.balanceOf(manager.address);
        consolelog("Manager tokens  = ", dec18ToFloat(mngBlncAfterD18));
        pool = await manager.getLiquidityPool(poolId);
        fTotalPoolFunds = (pool.fDefaultFundCashCC).add(pool.fPnLparticipantsCashCC).add(pool.fAMMFundCashCC);
        consolelog("fTotalPoolFunds =", ABK64x64ToFloat(fTotalPoolFunds));
        consolelog("Manager balance - fTotalPoolFunds (=mngr margin at mark)= ", dec18ToFloat(mngBlncAfterD18)- ABK64x64ToFloat(fTotalPoolFunds));
        consolelog("Manager balance change (=payment to traders)= ", dec18ToFloat(mngBlncAfterD18.sub(mngBlncBeforeD18)));
        let totalAccDiff = acc0BlncAfterD18.sub(acc0BlncBeforeD18).add(acc1BlncAfterD18.sub(acc1BlncBeforeD18));
        consolelog("Trader wallets diff = ", dec18ToFloat(totalAccDiff));
        pool = await manager.getLiquidityPool(poolId);
        expect(ABK64x64ToFloat(pool.fTargetDFSize)).to.be.equal(0);
        expect(ABK64x64ToFloat(pool.fTargetAMMFundSize)).to.be.equal(0);
        fTotalPoolFunds = (pool.fDefaultFundCashCC).add(pool.fPnLparticipantsCashCC).add(pool.fAMMFundCashCC);
        consolelog("fTotalPoolFunds =", ABK64x64ToFloat(fTotalPoolFunds));
        consolelog("----\nwithdraw earnings:");
        await manager.setTreasury(poolId, accounts[0].address);
        await manager.transferEarningsToTreasury(poolId, floatToABK64x64(999));
        let acc0BlncAfterWD18= await poolData.marginToken.balanceOf(accounts[0].address);
        let mngBlncAfterWD18 = await poolData.marginToken.balanceOf(manager.address);
        consolelog("Manager balance after earnings withdrawal = ", dec18ToFloat(mngBlncAfterWD18));
        consolelog("treasury wallet diff  = ", dec18ToFloat(acc0BlncAfterWD18.sub(acc0BlncAfterD18)));
        let isZero = equalForPrecisionFloat(dec18ToFloat(mngBlncAfterWD18), 0, 17);
        expect(isZero).to.be.true;
    });
    
    async function sttlCountTraderCash(manager, perpId) {
        let activeTraderAddresses = await manager.getActivePerpAccounts(perpId);
        let fTotalTraderCash = floatToABK64x64(0);
        for (var k = 0; k<activeTraderAddresses.length; k++) {
            let traderAddr = activeTraderAddresses[k];
            let traderStateArr = await manager.getTraderState(perpId, traderAddr);
            fTotalTraderCash = fTotalTraderCash.add(traderStateArr[2]);
        }
        let managerStateArr = await manager.getTraderState(perpId, manager.address);
        fTotalTraderCash = fTotalTraderCash.add(managerStateArr[2]);
        return fTotalTraderCash;
    }

    async function sttlCountTotalFunds(manager, marginToken, pool, perpetualIds, active_addr) : Promise<number[]> {
        let fTotalPoolFunds = BigNumber.from(0);
        let fTotalTraderCash = BigNumber.from(0);
        fTotalPoolFunds = fTotalPoolFunds.add(pool.fDefaultFundCashCC).add(pool.fPnLparticipantsCashCC).add(pool.fAMMFundCashCC);
        // loop through margin accounts
        for (var k = 0; k < perpetualIds.length; k++) {
            let perpId = perpetualIds[k];
            for (var k = 0; k<active_addr.length; k++) {
                let traderAddr = active_addr[k];
                let traderStateArr = await manager.getTraderState(perpId, traderAddr);
                fTotalTraderCash = fTotalTraderCash.add(traderStateArr[2]);
            }
            let managerStateArr = await manager.getTraderState(perpId, manager.address);
            fTotalTraderCash = fTotalTraderCash.add(managerStateArr[2]);
        }
        
        // get manager token amount
        let tokenAmountDec10 = await marginToken.balanceOf(manager.address);
        console.log("Trader Cash = ", ABK64x64ToFloat(fTotalTraderCash));
        console.log("Pool Cash = ", ABK64x64ToFloat(fTotalPoolFunds));
        let totalMngrFunds = fTotalPoolFunds.add(fTotalTraderCash);
        console.log("Total Accounting Funds = ", ABK64x64ToFloat(totalMngrFunds));
        console.log("Total Token Mngr Funds = ", dec18ToFloat(tokenAmountDec10));
        console.log("Accounting Diff = ", ABK64x64ToFloat(totalMngrFunds)-dec18ToFloat(tokenAmountDec10));
        return [dec18ToFloat(tokenAmountDec10), ABK64x64ToFloat(totalMngrFunds)];
    }

    // settle perpetual
    // @addresses : settle
    async function sttlTestSettle(manager, perpetualId, poolID, doLog) {
        let  perpStateStr = ["INVALID","INITIALIZING","NORMAL","EMERGENCY","CLEARED"];
        let perpetual = await manager.getPerpetual(perpetualId);
        if(doLog)
            console.log("perpetual.state: " + perpetual.state + " - " + perpStateStr[perpetual.state]);

        if (perpetual.state == 2) {
            // state normal, set emergency state
            let tx = await manager.setEmergencyState(perpetualId);
            //console.log("tx", tx)
            await tx.wait();
            perpetual = await manager.getPerpetual(perpetualId);
            if (doLog)
                console.log("perpetual.state: " + perpetual.state + " - " + perpStateStr[perpetual.state]);
        }
        if (perpetual.state == 3) {
            // state emergency, need to settle traders
            let count = await manager.countActivePerpAccounts(perpetualId);
            if(doLog)
                console.log("count =", count.toString());
            let num = 0;
            while (count.toNumber() > 0 || num==0) {
                let tx = await manager.settleNextTraderInPool(poolID);
                await tx.wait();
                count = await manager.countActivePerpAccounts(perpetualId);
                if(doLog)
                    console.log("count active =", count.toString());
                num++;
            }
            perpetual = await manager.getPerpetual(perpetualId);
            if(doLog)
                console.log("perpetual.state: " + perpetual.state + " - " + perpStateStr[perpetual.state]);
        }

        if (perpetual.state != 4) {
            throw new Error("Perpetual state should be cleared at this point: check active traders");
        }

    }
    async function sttlSettleTraders(manager, perpetualId, poolID, traderAddresses, govAccount, doLog=false) {
        if(doLog)
            console.log("=== manager.settle ===");
        let poolData = await manager.getLiquidityPool(poolID);
        let marginToken = await ethers.getContractAt("ERC20", poolData.marginTokenAddress);
        for (let i = 0; i < traderAddresses.length; i++) {
            let balanceBefore = await marginToken.balanceOf(traderAddresses[i]);
            let tx = await manager.connect(govAccount).settle(perpetualId, traderAddresses[i]);
            await tx.wait();
            let balanceAfter = await marginToken.balanceOf(traderAddresses[i]);
            let balanceDiff = dec18ToFloat(balanceAfter.sub(balanceBefore));
            if(doLog)
                console.log("trader addr=", traderAddresses[i], ", balance diff=", balanceDiff);
        }
        if(doLog)
            console.log("--- done ---");
    }

    // place a market order
    async function sttlTestTrade(manager, perpetualId, tradeAmount, limitPrice, account, referrer?, deadline?,
        leverage?, flags?) {
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
            deadline = Math.round((new Date()).valueOf() / 1000) + 86400;
        }
        if (leverage == null) {
            leverage = floatToABK64x64(0);
        }
        if (flags == null) {
            flags = MASK_MARKET_ORDER;
        }
        if (referrer == null) {
            referrer = ZERO_ADDRESS;
        }
        let order: Order = {
            iPerpetualId: perpetualId,
            traderAddr: account.address,
            fAmount: tradeAmount,
            fLimitPrice: limitPrice,
            fTriggerPrice: floatToABK64x64(0),
            iDeadline: deadline,
            referrerAddr: referrer,
            flags: flags,
            fLeverage: leverage,
            createdTimestamp: Date.now()
        };

        return await manager.connect(account).trade(order, { gasLimit: 2_500_000 });
    }
    
});

