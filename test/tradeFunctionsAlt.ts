// @ts-nocheck
import { expect } from "chai";
const { ethers } = require("hardhat");
const abi = require("ethereumjs-abi");
import { floatToABK64x64, toDec18, COLLATERAL_CURRENCY_QUANTO, COLLATERAL_CURRENCY_BASE, PerpetualStateINITIALIZING, 
        floatToDec18, dec18ToFloat } from "../scripts/utils/perpMath";
const BN = ethers.BigNumber;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const MASK_CLOSE_ONLY = BN.from("0x80000000");
export const MASK_MARKET_ORDER = BN.from("0x40000000");
export const MASK_STOP_ORDER = BN.from("0x20000000");
export const MASK_KEEP_POS_LEVERAGE = BN.from("0x08000000");
export const MASK_LIMIT_ORDER = BN.from("0x04000000");
import { keccak256 } from "ethereumjs-util";
const ONE_DEC18 = BN.from(10).pow(BN.from(18));

export async function createLimitOrder(limitOrderBook: Contract, perpetualId, tradeAmount, limitPrice, account, signer, managerAddr : string, deadline, 
    createdTimestamp, referrer = ZERO_ADDRESS, leverage = null, executeOrder=false) : Array<Object>
{
    let order = createOrder(perpetualId, tradeAmount, limitPrice, account, deadline, createdTimestamp, referrer, leverage); 
    let signature = await createSignature(order, true, signer, managerAddr);
    let tx1 = await limitOrderBook.createLimitOrder(order, signature);
    
    if (executeOrder) {
        // await hre.ethers.provider.send('evm_increaseTime', [1500]); // Increasing block.timestamp
        // tx1 = await limitOrderBook.executeLimitOrder(order);
        tx1 = await executeLimitOrder(limitOrderBook, order);
    }
    return [tx1, order];
}

export async function postLimitOrder(marginToken, limitOrderBook: Contract, order: Order, signer, managerAddr : string, executeOrder=false, allowance : number=0) : Object
{
    let signature = await createSignature(order, true, signer, managerAddr);
    let fAllowance;
    if (allowance==0) {
        fAllowance = floatToDec18(2);
    } else {
        fAllowance = floatToDec18(allowance);
    }
    await marginToken.connect(signer).approve(managerAddr, ONE_DEC18);
    //await poolData.marginToken.connect(trader1).approve(manager.address, ONE_DEC18.mul(depositAmount));
    let tx1 = await limitOrderBook.connect(signer).createLimitOrder(order, signature);
    if (executeOrder) {
        // await hre.ethers.provider.send('evm_increaseTime', [1500]); // Increasing block.timestamp
        // tx1 = await limitOrderBook.executeLimitOrder(order);
        tx1 = await executeLimitOrder(limitOrderBook, order);
    }
    return tx1;
}


export function createOrder(perpetualId, fTradeAmount, fLimitPrice, accountAddr, 
    deadline, createdTimestamp, referrer = null, fLeverage = null) : Order 
{
    if (createdTimestamp == null) {
        createdTimestamp = Math.round(new Date() / 1000);
    }

    if (deadline == null) {
        deadline = createdTimestamp + 86400;
    }

    if (referrer == null) {
        referrer = accountAddr;
    }

    if (fLeverage == null) {
        fLeverage = floatToABK64x64(0);
    }

    let order: Order = {
        iPerpetualId: perpetualId,
        traderAddr: accountAddr,
        fAmount: fTradeAmount.toString(),
        fLimitPrice: fLimitPrice.toString(),
        fTriggerPrice: floatToABK64x64(0).toString(),
        iDeadline: deadline,
        referrerAddr: referrer,
        flags: MASK_LIMIT_ORDER.toNumber(),
        fLeverage: fLeverage.toString(),
        createdTimestamp: createdTimestamp,
    };
    return order;
}

export async function executeLimitOrder(limitOrderBook : Contract, order : Order, digest = null) : Object {
    await hre.ethers.provider.send('evm_increaseTime', [1500]); // Increasing block.timestamp
    let r;
    if (digest != null) {
        let refAddr = order == null ? ZERO_ADDRESS : order.referrerAddr;
        r = await limitOrderBook.executeLimitOrderByDigest(digest, refAddr);
    } else {
        r = await limitOrderBook.executeLimitOrder(order);
    }
    await hre.ethers.provider.send('evm_increaseTime', [-1500]); // reset block.timestamp
    return r;
}

export async function getLastTradeDigest(account, orderbook) {
    
    let numDigest = await orderbook.numberOfDigestsOfTrader(account);
    let digestContract = await orderbook.limitDigestsOfTrader(account, numDigest-1, 1);
    return digestContract.toString();
}

export function contractOrderToOrder(orderStrObj : object) : Order {
    let order : Order = {
        iPerpetualId: orderStrObj.iPerpetualId,
        traderAddr: orderStrObj.traderAddr,
        fAmount: orderStrObj.fAmount.toString(),
        fLimitPrice: orderStrObj.fLimitPrice.toString(),
        fTriggerPrice: orderStrObj.fTriggerPrice.toString(),
        iDeadline: parseInt((orderStrObj.iDeadline).toString()),
        referrerAddr: orderStrObj.referrerAddr,
        flags: parseInt((orderStrObj.flags).toString()),
        fLeverage: orderStrObj.fLeverage.toString(),
        createdTimestamp: parseInt((orderStrObj.createdTimestamp).toString()),
    };
    return order;
}

export function combineFlags(f1 : BN, f2 : BN) : BN {
    return BN.from(parseInt(f1.toString()) | parseInt(f2.toString()));
}

export async function createSignature(order : Order, isNewOrder : boolean, signer : object, managerAddress : string) {
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