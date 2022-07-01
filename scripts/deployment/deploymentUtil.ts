// @ts-nocheck
import { createContract, toBytes32 } from "../utils/utils";
import { ethers } from "hardhat";
import { ABK64x64ToFloat, floatToABK64x64, floatToDec18, toDec18 } from "../utils/perpMath";
import { BigNumberish, Contract } from "ethers";
import { BytesLike } from "@ethersproject/bytes";
import { deployMockToken } from "./helpers/contracts";
import fs from "fs";

const BN = ethers.BigNumber;

const ONE_DEC18 = BN.from(10).pow(BN.from(18));
const ONE_64x64 = BN.from("0x010000000000000000");
const DOT_ONE_64x64 = floatToABK64x64(0.1);

const COLLATERAL_CURRENCY_QUOTE = 0;
const COLLATERAL_CURRENCY_BASE = 1;
const COLLATERAL_CURRENCY_QUANTO = 2;

const BTC = toBytes32("BTC");
const USD = toBytes32("USD");

const BATCH_SIZE = 100;

const MASK_MARKET_ORDER = BN.from("0x40000000");
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const CONTRACTS_FILE_NAME = "scripts/deployment/deployed_contracts.json";

export async function createPerpetualManager() {
    const CONTRACTS = [
        { name: "PerpetualDepositManager" },
        { name: "MockPerpetualFactory" },
        { name: "PerpetualPoolFactory" },
        { name: "PerpetualGetter" },
        { name: "PerpetualLiquidator" },
        { name: "PerpetualSettlement" },
        { name: "PerpetualTradeLogic" },
        { name: "PerpetualTradeManager" },
        { name: "PerpetualLimitTradeManager" },
        { name: "PerpetualOrderManager" },
        { name: "PerpetualTreasury" },
        { name: "PerpetualUpdateLogic" },
        { name: "PerpetualWithdrawManager" },
        { name: "PerpetualMarginViewLogic" },
        { name: "MockPerpetualSetter" }, 
    ];

    let manager = await deployPerpetualManager(CONTRACTS);

    let AMMPerpLogic = await createContract("AMMPerpLogic");
    console.log("AMMPerpLogic: ", AMMPerpLogic.address);
    let tx = await manager.setAMMPerpLogic(AMMPerpLogic.address);
    await tx.wait();
    console.log("manager.setAMMPerpLogic");

    console.log("PerpetualManager: " + manager.address);
    return manager;
}

export async function deployPerpetualManager(contracts: any, replaceOtherModulesFuncs: boolean = true) {
    let perpetualManagerProxy = await createContract("PerpetualManagerProxy");

    for (const contractData of contracts) {
        let contract = await createContract(contractData.name);
        let tx = replaceOtherModulesFuncs
            ? await perpetualManagerProxy.setImplementationCrossModules(contract.address)
            : await perpetualManagerProxy.setImplementation(contract.address);
        await tx.wait();
    }

    let manager = await ethers.getContractAt("IMockPerpetualManager", perpetualManagerProxy.address);
    // console.log("manager: ", manager.address);

    let shareTokenFactory = await createContract("ShareTokenFactory");
    // console.log("shareTokenFactory: ", shareTokenFactory.address);

    let tx = await manager.setPerpetualPoolFactory(shareTokenFactory.address);
    await tx.wait();
    // console.log("manager.setPerpetualPoolFactory");

    return manager;
}

export async function createLiquidityPool(
    manager,
    owner,
    token: any = null,
    iTargetPoolSizeUpdateTime = 10800,
    iPnLparticipantWithdrawalPeriod = 86400 / 3,
    fPnLparticipantWithdrawalPercentageLimit: any = 0.1,
    fPnLparticipantWithdrawalMinAmountLimit: any = 5,
    treasuryAddress: any = null,
    fMaxTotalTraderFunds: any = -1
) {
    if (treasuryAddress == null) {
        treasuryAddress = owner;
    }

    let marginToken;
    if (token == null) {
        marginToken = await deployMockToken();
        await marginToken.mint(owner, ONE_DEC18.mul(100));
    } else {
        marginToken = await ethers.getContractAt("IERC20", token);
    }

    console.log("treasuryAddress:", treasuryAddress);
    console.log("marginToken.address:", marginToken.address);

    let tx = await manager.createLiquidityPool(
        treasuryAddress,
        marginToken.address,
        iTargetPoolSizeUpdateTime,
        iPnLparticipantWithdrawalPeriod,
        floatToABK64x64(fPnLparticipantWithdrawalPercentageLimit),
        floatToABK64x64(fPnLparticipantWithdrawalMinAmountLimit),
        floatToABK64x64(fMaxTotalTraderFunds)
    );
    await tx.wait();
    let receipt = await ethers.provider.getTransactionReceipt(tx.hash);
    console.log("createLiquidityPool: gasUsed = " + receipt.gasUsed);

    let id = await manager.getPoolCount();
    console.log("poolId =", id.toString());
    console.log("marginToken:", marginToken.address);
    return { id, marginToken };
}

export async function createOracle(oracleFactory, baseCurrency, quoteCurrency, priceFeeds, isChainLink) {
    let route = await oracleFactory.getRoute(baseCurrency, quoteCurrency);
    if (route.length == 0) {
        let tx = await oracleFactory.createOracle(baseCurrency, quoteCurrency, priceFeeds, isChainLink);
        await tx.wait();
        route = await oracleFactory.getRoute(baseCurrency, quoteCurrency);
    } else {
        console.log("Oracle already created.")
    }
    return route[0].oracle;
}

export async function createPerpetual(
    manager,
    poolId,
    oracles,
    _baseParams: BigNumberish[] | null = null,
    _riskParams: BigNumberish[] | null = null,
    _defaultFundParams: BigNumberish[] | null = null,
    eCollateralCurrency
) {

    let baseParams = _baseParams;
    if (_baseParams == null) {
        throw new Error("_baseParams is null");
    }
    let underlyingRiskParams = _riskParams;
    if (underlyingRiskParams == null) {
        throw new Error("_riskParams is null");
    }
    let defaultFundRiskParams = _defaultFundParams;
    if (defaultFundRiskParams == null) {
        throw new Error("_defaultFundParams is null");
    }

    let tx = await manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency);
    await tx.wait();
    let receipt = await ethers.provider.getTransactionReceipt(tx.hash);
    console.log("createPerpetual: gasUsed = " + receipt.gasUsed);

    let pool = await manager.getLiquidityPool(poolId);
    let perpetualCount = pool.iPerpetualCount;
    let perpetualId = await manager.getPerpetualId(poolId, perpetualCount - 1);
    console.log("perpetualId =", perpetualId);
    return perpetualId;
}

export async function runLiquidityPool(manager: Contract, poolId: any) {
    let pool = await manager.getLiquidityPool(poolId);
    console.log("pool.isRunning =", pool.isRunning);
    if (!pool.isRunning) {
        let tx = await manager.runLiquidityPool(poolId);
        await tx.wait();
        let receipt = await ethers.provider.getTransactionReceipt(tx.hash);
        console.log("runLiquidityPool: gasUsed = " + receipt.gasUsed);
    }
}

export async function addLiquidity(manager: Contract, marginToken: Contract, poolId, amount) {
    let tx = await marginToken.approve(manager.address, toDec18(amount));
    await tx.wait();
    tx = await manager.addLiquidity(poolId, amount);
    await tx.wait();
    let receipt = await ethers.provider.getTransactionReceipt(tx.hash);
    console.log("addLiquidity: gasUsed = " + receipt.gasUsed);

    let pool = await manager.getLiquidityPool(poolId);
    console.log("pool.fPnLparticipantsCashCC =", ABK64x64ToFloat(pool.fPnLparticipantsCashCC));
}

export async function depositToDefaultFund(manager: Contract, marginToken: Contract, poolId: any, amount) {
    let tx = await marginToken.approve(manager.address, toDec18(amount));
    await tx.wait();
    tx = await manager.depositToDefaultFund(poolId, amount);
    await tx.wait();
    let receipt = await ethers.provider.getTransactionReceipt(tx.hash);
    console.log("depositToDefaultFund: gasUsed = " + receipt.gasUsed);

    let pool = await manager.getLiquidityPool(poolId);
    console.log("pool.fDefaultFundCashCC =", ABK64x64ToFloat(pool.fDefaultFundCashCC));
}

export async function addAMMLiquidityToPerpetual(manager: Contract, marginToken: Contract, perpetualId: any, amount) {
    let tx = await marginToken.approve(manager.address, toDec18(amount));
    await tx.wait();
    tx = await manager.addAMMLiquidityToPerpetual(perpetualId, amount);
    await tx.wait();
    let receipt = await ethers.provider.getTransactionReceipt(tx.hash);
    console.log("addAMMLiquidityToPerpetual: gasUsed = " + receipt.gasUsed);

    let perpetual = await manager.getPerpetual(perpetualId);
    console.log("perpetual.fAMMFundCashCC =", ABK64x64ToFloat(perpetual.fAMMFundCashCC));
}

export async function deposit(manager: Contract, marginToken: Contract, perpetualId: any, amount, account) {
    let tx = await marginToken.approve(manager.address, toDec18(amount));
    await tx.wait();
    tx = await manager.deposit(perpetualId, amount);
    await tx.wait();
    let receipt = await ethers.provider.getTransactionReceipt(tx.hash);
    console.log("deposit: gasUsed = " + receipt.gasUsed);

    let marginAccount = await manager.getMarginAccount(perpetualId, account);
    console.log("marginAccount.fCashCC = ", ABK64x64ToFloat(marginAccount.fCashCC));
}

export async function withdraw(manager: Contract, marginToken: Contract, perpetualId: any, amount, account) {
    let tx = await manager.withdraw(perpetualId, amount);
    await tx.wait();
    let receipt = await ethers.provider.getTransactionReceipt(tx.hash);
    console.log("withdraw: gasUsed = " + receipt.gasUsed);

    let marginAccount = await manager.getMarginAccount(perpetualId, account);
    console.log("marginAccount.fCashCC = ", ABK64x64ToFloat(marginAccount.fCashCC));
}

export async function trade(manager: Contract, perpetualId, tradeAmount, limitPrice, account, leverage = null) {
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
        leverage: BigNumberish;
        createdTimestamp: BigNumberish;
    };
    if (leverage == null) {
        leverage = floatToABK64x64(0);
    }
    const timestamp = Math.round(new Date() / 1000) + 86400;
    let order: Order = {
        iPerpetualId: perpetualId,
        traderAddr: account,
        fAmount: tradeAmount,
        fLimitPrice: limitPrice,
        fTriggerPrice: floatToABK64x64(0),
        iDeadline: timestamp,
        referrerAddr: ZERO_ADDRESS,
        flags: MASK_MARKET_ORDER,
        fLeverage: leverage,
        createdTimestamp: Date.now(),
    };

    let tx = await manager.trade(order);
    await tx.wait();
    let receipt = await ethers.provider.getTransactionReceipt(tx.hash);
    console.log("trade: gasUsed = " + receipt.gasUsed);

    let marginAccount = await manager.getMarginAccount(perpetualId, account);
    console.log("marginAccount.fPositionBC = ", ABK64x64ToFloat(marginAccount.fPositionBC));
}

function getCommitInfo() {
    let branch = fs.readFileSync(".git/HEAD").toString();
    let commit = "";
    if (branch.indexOf(":") === -1) {
    } else {
        branch = branch.split(":")[1].trim();
        commit = fs
            .readFileSync(".git/" + branch)
            .toString()
            .trim();
    }
    return { branch, commit };
}
