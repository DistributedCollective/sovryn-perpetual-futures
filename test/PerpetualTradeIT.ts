// @ts-nocheck
import {expect} from "chai";
import {createContract, getAccounts, toBytes32} from "../scripts/utils/utils";
import {createLiquidityPool, createOracle, createPerpetualForIT, createPerpetualManagerForIT} from "./TestFactory";
import {ABK64x64ToFloat, floatToABK64x64, floatToDec18, shrinkToLot, equalForPrecision, getMaxLeveragePosition, 
        PerpetualStateNORMAL, PerpetualStateCLEARED, PerpetualStateEMERGENCY, cdfNormalStd} from "../scripts/utils/perpMath";
import {queryAMMState, queryPerpParameters, queryTraderState, queryLiqPoolStateFromPerpetualId} from "../scripts/utils/perpQueries";
import {calculateSlippagePrice, getMaximalTradeSizeInPerpetual, getTradingFeeRate, getBase2CollateralFX} from "../scripts/utils/perpUtils";

import {addAMMLiquidityToPerpetual, addLiquidity, depositToDefaultFund, trade} from "../scripts/deployment/deploymentUtil";
import {BigNumberish, Contract} from "ethers";
import {BytesLike} from "@ethersproject/bytes";
import {ITParameters, ITScheduleTraders, TestScenarioReader} from "./test_scenarios/TestScenarioReader";

const {ethers} = require("hardhat");
const abi = require("ethereumjs-abi");
const ethUtil = require("ethereumjs-util");

const BN = ethers.BigNumber;

const ONE_DEC18 = BN.from(10).pow(BN.from(18));
const ONE_64x64 = BN.from("0x010000000000000000");
const DOT_ONE_64x64 = ONE_64x64.div(BN.from("10")); //BN.from("0x016345785d8a0000");

const DECIMALS = BN.from(10).pow(BN.from(18));

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const LOT_SIZE = 0.0001
const BTC = toBytes32("BTC");
const USD = toBytes32("USD");
const ETH = toBytes32("ETH");

const MASK_CLOSE_ONLY = BN.from("0x80000000");
const MASK_MARKET_ORDER = BN.from("0x40000000");
const MASK_STOP_ORDER = BN.from("0x20000000");
const MASK_USE_TARGET_LEVERAGE = BN.from("0x08000000");

const COLLATERAL_CURRENCY_QUOTE = 0;
const COLLATERAL_CURRENCY_BASE = 1;
const COLLATERAL_CURRENCY_QUANTO = 2;

type InitialData = {
    fPnLparticipantsCashCC: number;
    fDefaultFundCashCC: number;
    fAMMFundCashCC: number;
    marginCashCC: number;
    depositAmount: number;
};

type TestData = {
    params: ITParameters[];
    initialData: InitialData;
    prices: [];
    scheduleTraders: Map<number, ITScheduleTraders[]>;
    results: Map<number, ITScheduleTraders>;
};

describe("PerpetualTradeIT", () => {
    let accounts, owner, baseTraders, quantoTraders;

    let manager;
    let poolId, perpetualId, perpetualId2;
    let marginToken;

    let oracleBTCUSD;
    let oracleETHUSD;

    let testData: TestData;

    before(async () => {
        accounts = await getAccounts();
        
        owner = accounts[0].address;
        baseTraders = [accounts[1], accounts[2], accounts[3]];
        quantoTraders = [accounts[4], accounts[5], accounts[6]];
        
        testData = await loadTestData("scenario1");
        
        manager = await createPerpetualManagerForIT();
        await manager.addAmmGovernanceAddress(owner);
        let poolData = await createLiquidityPool(manager, owner, testData.params);
        poolId = poolData.id;
        marginToken = poolData.marginToken;
        
        oracleBTCUSD = await createContract("MockPriceScenarioOracle", [BTC, USD, testData.prices]);
        oracleETHUSD = await createContract("MockPriceScenarioOracle", [BTC, USD, testData.prices]); //await createOracle(ETH, USD);
        let oracles = [oracleBTCUSD.address, oracleETHUSD.address];

        perpetualId = await createPerpetualForIT(manager, poolId, oracles, testData.params, COLLATERAL_CURRENCY_BASE);
        perpetualId2 = await createPerpetualForIT(manager, poolId, oracles, testData.params, COLLATERAL_CURRENCY_QUANTO);
        
        await addAMMLiquidityToPerpetual(manager, marginToken, perpetualId, floatToABK64x64(testData.initialData.fAMMFundCashCC));
        await addAMMLiquidityToPerpetual(manager, marginToken, perpetualId2, floatToABK64x64(testData.initialData.fAMMFundCashCC));

        await manager.activatePerpetual(perpetualId);
        await manager.activatePerpetual(perpetualId2);

        await manager.runLiquidityPool(poolId);

        if (testData.initialData.fPnLparticipantsCashCC != 0) {
            await addLiquidity(manager, marginToken, poolId, floatToABK64x64(testData.initialData.fPnLparticipantsCashCC));
        }
        if (testData.initialData.fDefaultFundCashCC != 0) {
            await depositToDefaultFund(manager, marginToken, poolId, floatToABK64x64(testData.initialData.fDefaultFundCashCC));
        }
        
        await manager.setTraderFCashCC(perpetualId, manager.address, floatToABK64x64(testData.initialData.marginCashCC));
        await manager.setTraderFCashCC(perpetualId2, manager.address, floatToABK64x64(testData.initialData.marginCashCC));

        await marginToken.transfer(manager.address, floatToDec18(testData.initialData.marginCashCC));
        
        await depositByTraders(manager, perpetualId, marginToken, baseTraders, testData.initialData.depositAmount);
        await depositByTraders(manager, perpetualId2, marginToken, quantoTraders, testData.initialData.depositAmount);
    });

    describe("trade", () => {

        it("schedule traders", async () => {
            let perpParams = await queryPerpParameters(manager, perpetualId);
            let perpetual = await manager.getPerpetual(perpetualId);
            let isPerpNormal = perpetual.state == PerpetualStateNORMAL;
            for (let i = 0; i < testData.prices.length; i++) {
                if (!isPerpNormal) {
                    let isScenarioBust = testData.results.get(i) == null;
                    expect(isScenarioBust).to.be.true;
                    break;
                }
                await liquidate(manager, perpetualId, owner);

                let price = (await oracleBTCUSD.getSpotPrice())[0];
                expect(price).equal(testData.prices[i]);

                console.log("time:", i);
                console.log("price =", ABK64x64ToFloat(price));
                let trades: ITScheduleTraders[] = testData.scheduleTraders.get(i.toString());
                if (trades != null) {
                    for (let jj = 0; jj < 2 * trades.length; jj++) {
                        let j = (jj / 2) >> 0;
                        let tradeData: ITScheduleTraders = trades[j];
                        // base trader goes first
                        let trader;
                        if (j % 2 == 0) {
                            trader = baseTraders[tradeData.traderNo];
                        } else {
                            trader = quantoTraders[tradeData.traderNo];
                        }
                        let marginAccount = await manager.getMarginAccount(perpetualId, trader.address);
                        // determine trade size
                        let dir = tradeData.tradePos;
                        let tradeAmount = await calculateTradeAmount(marginAccount, dir, manager, perpetual, perpetualId, trader, perpParams, price);
                        let limitPrice = calculateSlippagePrice(ABK64x64ToFloat(price), 0.02, dir);
                        console.log("Spot=", ABK64x64ToFloat(price));
                        console.log("limitPrice=", limitPrice);
                        if (Math.abs(tradeAmount) > 0) {
                            let accountBefore = await manager.getMarginAccount(perpetualId, trader.address);
                            console.log("======= trading =======");
                            console.log("--- before ---")
                            console.log("fPositionBC=", ABK64x64ToFloat(accountBefore.fPositionBC));
                            console.log("fCashCC=", ABK64x64ToFloat(accountBefore.fCashCC));
                            console.log("tradeAmount (input)=", tradeAmount);
                            console.log("fLockedInValueQC=", ABK64x64ToFloat(accountBefore.fLockedInValueQC));
                            let perp = await manager.getPerpetual(perpetualId);
                            console.log("fUnitAccumulatedFundingStart=", ABK64x64ToFloat(accountBefore.fUnitAccumulatedFundingStart));
                            console.log("perp.fUnitAccumulatedFunding=", ABK64x64ToFloat(perp.fUnitAccumulatedFunding));
                            console.log("accumulated - start =", ABK64x64ToFloat(perp.fUnitAccumulatedFunding) - ABK64x64ToFloat(accountBefore.fUnitAccumulatedFundingStart));
                            if (perp.state == PerpetualStateEMERGENCY) {
                                await settlePerpetualAndTraders(manager, perpetualId);
                                isPerpNormal = false;
                                continue;
                            } else if (perp.state == PerpetualStateNORMAL) {
                                try {
                                    await trade(manager, perpetualId, floatToABK64x64(tradeAmount), floatToABK64x64(limitPrice), trader);
                                    console.log("--- simulated ---")
                                    console.log(testData.results.get(i).trades);
                                    console.log("--- --- ---")
                                } catch(err) {
                                    console.log("tx failed and caught: ", err);
                                    let isScenarioBust = testData.results.get(i) == null;
                                    expect(isScenarioBust).to.be.true;
                                    console.log("=======================");
                                    isPerpNormal = false;
                                    let perp = await manager.getPerpetual(perpetualId);
                                    if (perp.state == PerpetualStateEMERGENCY) {
                                        await settlePerpetualAndTraders(manager, perpetualId);
                                    }
                                    continue;                                
                                }
                            } else {
                                console.log("Not trading, perp state = ", perp.state );
                                continue;
                            }
                            
                            let accountAfter = await manager.getMarginAccount(perpetualId, trader.address);
                            console.log("--- after ---")
                            console.log("fPositionBC=", ABK64x64ToFloat(accountAfter.fPositionBC));
                            console.log("fCashCC=", ABK64x64ToFloat(accountAfter.fCashCC));
                            console.log("fLockedInValueQC=", ABK64x64ToFloat(accountAfter.fLockedInValueQC));
                            perp = await manager.getPerpetual(perpetualId);
                            console.log("fUnitAccumulatedFundingStart=", ABK64x64ToFloat(accountAfter.fUnitAccumulatedFundingStart));
                            console.log("perp.fUnitAccumulatedFunding=", ABK64x64ToFloat(perp.fUnitAccumulatedFunding));
                            let fNewFundingRate = ABK64x64ToFloat(perp.fUnitAccumulatedFunding) - ABK64x64ToFloat(accountAfter.fUnitAccumulatedFundingStart);
                            console.log("accumulated - start =", fNewFundingRate);
                            expect(equalForPrecision(perp.fUnitAccumulatedFunding, accountAfter.fUnitAccumulatedFundingStart, 8, false)).to.be.true;
                            // check that trade expected == trade executed
                            let accountDeltaPosition = ABK64x64ToFloat(accountAfter.fPositionBC.sub(accountBefore.fPositionBC));
                            console.log("tradeAmount (effective)=", accountDeltaPosition);
                            expect(equalForPrecision(floatToABK64x64(accountDeltaPosition), floatToABK64x64(tradeAmount), 3, false)).to.be.true;
                            
                            await checkMarginAccountState(manager, perpetualId, trader, testData, i, tradeData);
                            await checkMarginAccountState(manager, perpetualId, manager, testData, i, tradeData);
                            console.log("--- --- ---")
                        } else {
                            console.log("===== not trading =====");
                        }
                        console.log("=======================");
                    }
                    await checkPoolState(manager, poolId, testData.results, i);
                }

                if (i < testData.prices.length - 1) {
                    await oracleBTCUSD.updatePriceIndex();
                }
            }
        });

    });

    //{timeindex, number of active traders, [traderno/AMM, cash, lockedIn, position], defaultfund, ammfund, participationFund}

    // Integration testing:
    //     - Please clone https://github.com/DistributedCollective/PerpetualSimulation
    //     - The script https://github.com/DistributedCollective/PerpetualSimulation/blob/main/integrationTests.py contains a test-case, I suggest trying to replicate this first.
    //     - Perpetual parameters and AMM fundings are in the script.
    // - the S2-Oracle price is represented by idx_px which is printed to the console when running the script
    // - there are 3 traders and they trade according to ScheduleTraders.csv. -1 means they enter a max position (given their cash) short, 1 the same long
    // - Script output should be sufficient to tell you what should be happening when mocking the oracle and trading according to ScheduleTraders.csv
    // - I guess we need to mock the liquidators too

});

async function trade(manager: Contract, perpetualId, tradeAmount, limitPrice, account, referrer = ZERO_ADDRESS, deadline = null,
    leverage = null) {
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
        createdTimestamp: BigNumberish;
    };

    if (deadline == null) {
        deadline = Math.round(new Date() / 1000) + 86400;
    }
    if (leverage == null) {
        leverage = floatToABK64x64(0);
    }
    let order: Order = {
        iPerpetualId: perpetualId,
        traderAddr: account.address,
        fAmount: tradeAmount,
        fLimitPrice: limitPrice,
        fTriggerPrice: floatToABK64x64(0),
        iDeadline: deadline,
        referrerAddr: referrer,
        flags: MASK_MARKET_ORDER,
        fLeverage: leverage,
        createdTimestamp: Date.now()
    };

    return await manager.connect(account).trade(order);
}

function getMaxLeveragePositionIT(ammStateData, perpParams, traderStateData) {
    let cashCC = traderStateData.marginAccountCashCC;
    if (cashCC < 0) {
        // trader should have been liquidated
        return 0;
    }
    let beta = perpParams.fMarginRateBeta;
    let alpha = perpParams.fInitialMarginRateAlpha;
    let cashBC = cashCC / getBase2CollateralFX(ammStateData, false);
    let targetPremiumRate = cdfNormalStd(perpParams.fAMMTargetDD_1);
    let feeRate = getTradingFeeRate(perpParams);
    let maxPos = getMaxLeveragePosition(cashBC, targetPremiumRate, alpha, beta, feeRate);
    return shrinkToLot(maxPos, perpParams.fLotSizeBC);
}

async function getMaxTrade(manager, perpetualId, dir, traderAddr, perpParams, price) {
    let traderStateData = await queryTraderState(manager, perpetualId, traderAddr);
    let ammStateData = await queryAMMState(manager, perpetualId);
    ammStateData.indexS2PriceData = price;
    // max trade size from perp:
    let traderPos = traderStateData.marginAccountPositionBC;
    let maxTradeSize = await manager.getMaxSignedTradeSizeForPos(perpetualId, floatToABK64x64(traderPos), floatToABK64x64(dir));
    maxTradeSize = ABK64x64ToFloat(maxTradeSize);
    // max trade size for leverage:
    let lvgPos = dir * getMaxLeveragePositionIT(ammStateData, perpParams, traderStateData);
    let maxLvgTrade = lvgPos - traderPos;
    console.log("maxLvgTrade=", maxLvgTrade);
    console.log("maxAMMTrade=", maxTradeSize);
    // get the smaller of the max pos given cash/leverage and one tenth of the amm's allowed max trade size:
    let deltaPos = Math.sign(dir) * Math.min(Math.abs(maxLvgTrade), Math.abs(maxTradeSize) / 10);
    deltaPos = shrinkToLot(deltaPos, perpParams.fLotSizeBC);
    return deltaPos;
}

async function liquidate(manager, perpetualId, owner) {
    let activeAccountNumber = await manager.countActivePerpAccounts(perpetualId);
    let activeAccounts = await manager.getActivePerpAccountsByChunks(perpetualId, 0, activeAccountNumber);
    let count = 0;
    for (let i in activeAccounts) {
        let trader = activeAccounts[i];
        let isTraderMarginSafe = await manager.isTraderMaintenanceMarginSafe(perpetualId, trader);
        if (!isTraderMarginSafe) {
            console.log("=== liquidateByAMM =================================================");
            await manager.liquidateByAMM(perpetualId, owner, trader);
            console.log("liquidated trader #", i);
            console.log("====================================================================");
            count++;
        }
    }
    console.log("activeTraders =", activeAccountNumber.toString());
    if (count > 0) {
        console.log("liquidated " + count + " trader(s)");
    }
}

async function calculateTradeAmount(marginAccount: any, dir: number, manager, perpetual: any, perpetualId, trader, perpParams: PerpParameters, price) {
    let currentPos = ABK64x64ToFloat(marginAccount.fPositionBC);
    if (currentPos != 0 && Math.sign(dir) != Math.sign(currentPos)) {
        // close
        return -currentPos;
    } else {
        let maxTrade = await getMaxTrade(manager, perpetualId, dir, trader.address, perpParams, ABK64x64ToFloat(price)); 
        return Math.abs(maxTrade) < ABK64x64ToFloat(perpetual.fLotSizeBC) ? 0 : maxTrade;
    }
}

async function depositByTraders(manager, perpetualId, marginToken, traders, depositAmount) {
    for (let i = 0; i < traders.length; i++) {
        let trader = traders[i];
        await marginToken.mint(trader.address, floatToDec18(depositAmount));

        await marginToken.connect(trader).approve(manager.address, floatToDec18(depositAmount));
        await manager.connect(trader).deposit(perpetualId, floatToABK64x64(depositAmount));
    }
}

function getInitialData(params: ITParameters[]) {
    let initialData: InitialData = {};
    for (let param of params) {
        if (param.parameter_name == "initial_staker_cash") {
            initialData.fPnLparticipantsCashCC = param.value1;
        } else if (param.parameter_name == "initial_default_fund_cash_cc") {
            initialData.fDefaultFundCashCC = param.value1;
        } else if (param.parameter_name == "initial_amm_cash") {
            initialData.fAMMFundCashCC = param.value1;
        } else if (param.parameter_name == "initial_margin_cash") {
            initialData.marginCashCC = param.value1;
        } else if (param.parameter_name == "trader_collateral_cc") {
            initialData.depositAmount = param.value1;
        }
    }
    console.log("fPnLparticipantsCashCC =", initialData.fPnLparticipantsCashCC);
    console.log("fDefaultFundCashCC =", initialData.fDefaultFundCashCC);
    console.log("fAMMFundCashCC =", initialData.fAMMFundCashCC);
    console.log("depositAmount =", initialData.depositAmount);
    return initialData;
}

async function loadTestData(scenarioName) {
    let testData = {};
    testData.prices = [];

    const tsreader = new TestScenarioReader();
    tsreader.setScenarioFolderName(scenarioName);
    testData.params = await tsreader.readParams();
    const scenario = await tsreader.readScenario();
    testData.scheduleTraders = await tsreader.readScheduleTraders();
    scenario.forEach(priceData => {
        testData.prices.push(floatToABK64x64(priceData.priceIndex));
    });

    let tempResults = tsreader.readResult("./" + scenarioName + "/ResultData.json");
    testData.results = new Map();
    tempResults.forEach(result => {
        testData.results.set(result.timeindex, result);
    });

    testData.initialData = getInitialData(testData.params);
    return testData;
}

async function checkMarginAccountState(manager, perpetualId, trader, testData: TestData, i: number, tradeData: ITScheduleTraders) {
    let account = await manager.getMarginAccount(perpetualId, trader.address);

    console.log("account.fCashCC = ", ABK64x64ToFloat(account.fCashCC));
    console.log("account.fLockedInValueQC = ", ABK64x64ToFloat(account.fLockedInValueQC));
    console.log("account.fPositionBC = ", ABK64x64ToFloat(account.fPositionBC));

    let currentTrade = getCurrentTrade(testData.results, i, tradeData.traderNo);

    if (currentTrade == null) {
        console.log("Trader", tradeData.traderNo, "is not active at time=", i);
    } else {

        console.log(tradeData.traderNo);
        console.log("currentTrade =", currentTrade);

        expect(equalForPrecision(account.fCashCC, floatToABK64x64(currentTrade.cash), 16, false)).to.be.true;
        expect(equalForPrecision(account.fLockedInValueQC, floatToABK64x64(currentTrade.lockedIn), 16, false)).to.be.true;
        expect(equalForPrecision(account.fPositionBC, floatToABK64x64(currentTrade.position), 16, false)).to.be.true;
    }
}

function getCurrentTrade(results: Map<number, ITScheduleTraders>, resultIndex: number, traderNo: number) {
    let result = results.get(resultIndex);
    for (let i = 0; i < result.trades.length; i++) {
        let trade = result.trades[i];
        if (trade.traderNoAMM == traderNo) {
            return trade;
        }
    }
    return null;
}

async function checkPoolState(manager, poolId, results: Map<number, ITScheduleTraders>, i: number) {
    let result = results.get(i);
    if (result != null) {
        console.log("=== expected result ============================");
        console.log(result);
        console.log("=== actual result ==============================");
        let pool = await manager.getLiquidityPool(poolId);
        console.log("pool.fDefaultFundCashCC =", ABK64x64ToFloat(pool.fDefaultFundCashCC));
        console.log("pool.fAMMFundCashCC =", ABK64x64ToFloat(pool.fAMMFundCashCC));
        console.log("pool.fPnLparticipantsCashCC =", ABK64x64ToFloat(pool.fPnLparticipantsCashCC));
        console.log("================================================");

        expect(equalForPrecision(pool.fDefaultFundCashCC, floatToABK64x64(result.defaultfund), 2, false)).to.be.true;
        expect(equalForPrecision(pool.fAMMFundCashCC, floatToABK64x64(result.ammfund), 4, false)).to.be.true;
        expect(equalForPrecision(pool.fPnLparticipantsCashCC, floatToABK64x64(result.participationFund), 3, false)).to.be.true;
    }
}

async function settlePerpetualAndTraders(manager, perpetualId) {
    // settle the perpetual
    console.log("Settlement of perpetual...");
    let accounts = await manager.getActivePerpAccounts(perpetualId);
    let isSettled = await settlePerpetual(manager, perpetualId);
    if ( isSettled ) {
        console.log("clear all traders...");
        await settleAllTraders(manager, perpetualId, accounts);
    }
}

async function settlePerpetual(manager, perpetualId) {
    let perp;
    perp = await manager.getPerpetual(perpetualId);
    let thisInEmergency = perp.state == PerpetualStateEMERGENCY;
    while (thisInEmergency) {
        await manager.settleNextTraderInPool(perp.poolId);
        perp = await manager.getPerpetual(perpetualId);  
        thisInEmergency = perp.state == PerpetualStateEMERGENCY
    }
    let isClear = perp.state == PerpetualStateCLEARED;
    if (isClear) {
        console.log("Cleared perpetual id=", perpetualId);
    }
    return isClear;
}

async function settleAllTraders(manager, perpetualId, accounts) {
    
    console.log("Clearing ", accounts.length, " traders.")
    for (var k = 0; k<accounts.length; k++) {
        console.log("Settle trader ", k, " : ", accounts[k])
        await manager.settle(perpetualId, accounts[k]);
    }
}
