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
import {getMaximalTradeSizeInPerpetual} from "../scripts/utils/perpUtils";
import {queryAMMState, queryPerpParameters, queryLiqPoolStateFromPerpetualId} from "../scripts/utils/perpQueries";
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

describe("PerpetualTradeClose", () => {
    

    beforeEach(async () => {
        accounts = await getAccounts();
        owner = accounts[0].address;

        manager = await createPerpetualManager();
        poolData = await createLiquidityPool(manager, owner);
        S2 = 60000;
        let S2Oracle = S2;
        let priceDrop = 0.98;
        let prices : BigNumber[] = [];
        for(var k = 0; k<40; k++) {
            prices.push(floatToABK64x64(S2Oracle));
            S2Oracle = S2Oracle * priceDrop;
            priceDrop = priceDrop * priceDrop;
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

    it("should open and close trade", async () => {

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
        // deposit amm-cash from governance to AMM vault & default fund
        let AMMFundCash = 1;
        let defaultFundAmount = 0.01;
        await manager.connect(governanceAccount).addAMMLiquidityToPerpetual(perpetualIds[0], floatToABK64x64(AMMFundCash));
        await manager.connect(accounts[0]).depositToDefaultFund(poolId, floatToABK64x64(defaultFundAmount));
        // deposit to mgn account
        await manager.connect(accounts[3]).deposit(perpetualIds[0], floatToABK64x64(2));
        // trade 
        let tradeVec = [0.1, 0.02, -0.005, -0.006, 0.06, 0.1, 0.5];
        let randomTradeVec = [0.01, 0.01, -0.01, -0.01, 0, 0.01, 0, 0, -0.01, 0, 0, 0, 0, 0];
        let fLeverage = floatToABK64x64(9);
        let count = 0;
        for(var kk=0; kk<2; kk++) {
            for(var k = 0; k<tradeVec.length; k++) {
                for(var j = 0; j < 2; j++) {
                    let tradeAmt = (-1)**j * tradeVec[k];
                    let noise = 0.0001;
                    tradeAmt=tradeAmt+Math.sign(tradeAmt) * noise;
                    let fTradeAmount = floatToABK64x64(tradeAmt);
                    let ammData = await queryAMMState(manager, perpetualIds[0]);
                    let perpParams = await queryPerpParameters(manager, perpetualIds[0]);
                    let liqPool = await queryLiqPoolStateFromPerpetualId(manager, perpetualIds[0]);
                    let maxLong = getMaximalTradeSizeInPerpetual(0, 1, ammData,liqPool,perpParams);
                    let maxShort = getMaximalTradeSizeInPerpetual(0, -1, ammData,liqPool,perpParams);
                    //console.log("maxLong and short =", maxLong, maxShort);
                    let tx = await cTTrade(manager, perpetualIds[0], fTradeAmount, getLimitPrice(fTradeAmount), accounts[1], ZERO_ADDRESS, null, fLeverage);
                    // the random trader sets up trade
                    let tradeAmtRnd = randomTradeVec[count++ % randomTradeVec.length];
                    //console.log("random trader trade ", tradeAmtRnd)
                    if (tradeAmtRnd!=0) {
                        let fTradeAmountRnd = floatToABK64x64(tradeAmtRnd);
                        await cTTrade(manager, perpetualIds[0], fTradeAmountRnd, getLimitPrice(fTradeAmountRnd), accounts[3], ZERO_ADDRESS, null, fLeverage);
                    }
                    
                    //let perp = await manager.getPerpetual(perpetualIds[0]);
                    //console.log("Max=", ABK64x64ToFloat(perp.fMaxTradeShort), ABK64x64ToFloat(perp.fMaxTradeLong));
                    let mgnAccount = await manager.connect(accounts[1]).getMarginAccount(perpetualIds[0], accounts[1].address);
                    let pos = ABK64x64ToFloat(mgnAccount.fPositionBC);
                    let isPassed = (j==0 && pos!=0) || (j==1 && pos==0);
                    if (!isPassed)  {
                        console.log("trade amount = ", tradeAmt);
                        console.log("Position = ", pos);
                    }
                    expect(isPassed).to.be.true;
                } 
            }
        }
        
    });


    // place a market order
    async function cTTrade(manager, perpetualId, tradeAmount, limitPrice, account, referrer?, deadline?,
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

