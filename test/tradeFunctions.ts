// @ts-nocheck
import { expect } from "chai";
const { ethers } = require("hardhat");
const abi = require("ethereumjs-abi");
import * as fs from "fs";
import { getAccounts, createContract, toBytes32 } from "../scripts/utils/utils";
import { createLiquidityPool, createPerpetual, getBTCBaseParams, createOracle, createPerpetualManagerForIT } from "./TestFactory";
import {
    floatToABK64x64, toDec18, COLLATERAL_CURRENCY_QUANTO, COLLATERAL_CURRENCY_BASE, PerpetualStateINITIALIZING,
    floatToDec18, dec18ToFloat
} from "../scripts/utils/perpMath";
import { BigNumberish, Contract } from "ethers";
import { BytesLike } from "@ethersproject/bytes";
import { keccak256 } from "ethereumjs-util";
import { number } from "mathjs";
const BN = ethers.BigNumber;
const ONE_64x64 = BN.from("0x010000000000000000");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MASK_LIMIT_ORDER = BN.from("0x04000000");
const MASK_MARKET_ORDER = BN.from("0x40000000");
const ONE_DEC18 = BN.from(10).pow(BN.from(18));


export function createOrder(manager, perpetualId, tradeAmount, limitPrice, triggerPrice, account, referrer = ZERO_ADDRESS,
    deadline = null, leverage = null, flags = null) {
    type Order = {
        iPerpetualId: BytesLike;
        traderAddr: string;
        fAmount: BigNumberish;
        fLimitPrice: BigNumberish;
        fTriggerPrice: BigNumberish;
        iDeadline: BigNumberish;
        referrerAddr: string;
        flags: BigNumberish;
        fLeverage: BigNumberish;
        createdTimestamp: BigNumberish;
    };

    if (deadline == null) {
        deadline = Math.round(new Date() / 1000) + 86400;
    }
    if (leverage == null) {
        leverage = floatToABK64x64(0);
    }
    if (flags == null) {
        if (triggerPrice > 0)
            flags = MASK_STOP_ORDER;
        else
            flags = MASK_MARKET_ORDER;
    }

    let order: Order = {
        iPerpetualId: perpetualId,
        traderAddr: account,
        fAmount: tradeAmount,
        fLimitPrice: limitPrice,
        fTriggerPrice: triggerPrice,
        iDeadline: deadline,
        referrerAddr: referrer,
        flags: flags,
        fLeverage: leverage,
        createdTimestamp: Date.now(),
    };
    return order;
}

export async function trade(manager: Contract, perpetualId, tradeAmount, limitPrice, account, referrer = ZERO_ADDRESS,
    deadline = null, leverage = null, flags = null, triggerPrice = 0) {

    let order: Order = createOrder(manager, perpetualId, tradeAmount, limitPrice, triggerPrice, account.address, referrer, deadline, leverage, flags);
    return await manager.connect(account).trade(order);
}

export async function tradeBySig(
    manager: Contract,
    perpetualId,
    tradeAmount,
    limitPrice,
    account,
    referrer = ZERO_ADDRESS,
    deadline = null,
    signSecondTime = false,
    cancelOrder = false,
    leverage = null,
    signer = accounts[0],
    flags = null,
    triggerPrice = null
) {
    const NAME = "Perpetual Trade Manager";

    let currentChainId = (await ethers.provider.getNetwork()).chainId;

    let createdTimestamp = Math.round(new Date() / 1000);
    if (deadline == null) {
        deadline = createdTimestamp + 86400;
    }
    if (leverage == null) {
        leverage = floatToABK64x64(0);
    }
    if (flags == null) {
        flags = MASK_MARKET_ORDER;
    }
    if (triggerPrice == null) {
        triggerPrice = floatToABK64x64(0);
    }
    let order = {
        iPerpetualId: perpetualId,
        traderAddr: account,
        fAmount: tradeAmount.toString(),
        fLimitPrice: limitPrice.toString(),
        fTriggerPrice: triggerPrice.toString(),
        iDeadline: deadline,
        referrerAddr: referrer,
        flags: flags.toNumber(),
        fLeverage: leverage.toString(),
        createdTimestamp: createdTimestamp,
    };

    let signature = createSignature(order, true, signer, manager.address);

    if (signSecondTime) {
        await manager.tradeBySig(order, signature);
    }
    if (cancelOrder) {
        let signatureCancel = createSignature(order, false, signer, manager.address);
        await manager.cancelOrder(order, signatureCancel);
    }

    return await manager.tradeBySig(order, signature);
}


export async function createSignature(order: Order, isNewOrder: boolean, signer: object, managerAddress: string) {
    const NAME = "Perpetual Trade Manager";
    let currentChainId = (await ethers.provider.getNetwork()).chainId;
    const DOMAIN_TYPEHASH = keccak256(Buffer.from("EIP712Domain(string name,uint256 chainId,address verifyingContract)"));
    let domainSeparator = keccak256(
        abi.rawEncode(["bytes32", "bytes32", "uint256", "address"], [DOMAIN_TYPEHASH, keccak256(Buffer.from(NAME)), currentChainId, managerAddress])
    );
    const TRADE_ORDER_TYPEHASH = keccak256(
        Buffer.from(
            "Order(bytes32 iPerpetualId,address traderAddr,int128 fAmount,int128 fLimitPrice,int128 fTriggerPrice,uint256 iDeadline,uint32 flags,int128 fLeverage,uint256 createdTimestamp)"
        )
    );
    let structHash = keccak256(
        abi.rawEncode(
            ["bytes32", "bytes32", "address", "int128", "int128", "int128", "uint256", "uint32", "int128", "uint256"],
            [
                TRADE_ORDER_TYPEHASH,
                order.iPerpetualId,
                order.traderAddr,
                order.fAmount,
                order.fLimitPrice,
                order.fTriggerPrice,
                order.iDeadline,
                order.flags,
                order.fLeverage,
                order.createdTimestamp,
            ]
        )
    );
    let digest = keccak256(abi.rawEncode(["bytes32", "bytes32", "bool"], [domainSeparator, structHash, isNewOrder]));
    return signer.signMessage(digest);
}