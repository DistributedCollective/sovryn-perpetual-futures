const { ethers } = require("hardhat");

export function toWei(n) {
    return ethers.utils.parseEther(n);
}
export function fromWei(n) {
    return ethers.utils.formatEther(n);
}
export function toBytes32(s) {
    return ethers.utils.formatBytes32String(s);
}
export function fromBytes32(s) {
    return ethers.utils.parseBytes32String(s);
}

var defaultSigner = null;

export function setDefaultSigner(signer) {
    defaultSigner = signer;
}

export async function getAccounts(): Promise<any[]> {
    const accounts = await ethers.getSigners();
    const users: any = [];
    accounts.forEach((element: any) => {
        users.push(element.address);
    });
    return accounts;
}

export async function createFactory(path, libraries = {}) {
    const parsed = {};
    for (var name in libraries) {
        parsed[name] = libraries[name].address;
    }
    return await ethers.getContractFactory(path, { libraries: parsed });
}

export async function createContract(path, args = [], libraries = {}) {
    const factory = await createFactory(path, libraries);
    if (defaultSigner != null) {
        return await factory.connect(defaultSigner).deploy(...args);
    } else {
        return await factory.deploy(...args);
    }
}

export async function createLiquidityPoolFactory(name = "LiquidityPool") {
    const AMMModule = await createContract("AMMModule"); // 0x7360a5370d5654dc9d2d9e365578c1332b9a82b5
    const CollateralModule = await createContract("CollateralModule"); // 0xdea04ead9bce0ba129120c137117504f6dfaf78f
    const OrderModule = await createContract("OrderModule"); // 0xf8781589ae61610af442ffee69d310a092a8d41a
    const PerpetualModule = await createContract("PerpetualModule"); // 0x07315f8eca5c349716a868150f5d1951d310c53e
    const LiquidityPoolModule = await createContract("LiquidityPoolModule", [], {
        CollateralModule,
        AMMModule,
        PerpetualModule,
    }); // 0xbd7bfceb24108a9adbbcd4c57bacdd5194f3be68
    const TradeModule = await createContract("TradeModule", [], {
        AMMModule,
        LiquidityPoolModule,
    }); // 0xbe884fecccbed59a32c7185a171223d1c07c446b
    return await createFactory(name, {
        AMMModule,
        LiquidityPoolModule,
        OrderModule,
        TradeModule,
    });
}

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
