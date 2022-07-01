// @ts-nocheck
import { getAccounts, toBytes32, createContract } from "../scripts/utils/utils";
import {
    createLiquidityPool,
    createOracle,
    createOracleForIT,
    createPerpetual,
    createPerpetualForIT,
    createPerpetualManager,
    createPerpetualWithOracles,
} from "./TestFactory";
import { floatToABK64x64, COLLATERAL_CURRENCY_BASE } from "../scripts/utils/perpMath";
import {deposit, trade, withdraw} from "../scripts/deployment/deploymentUtil";
import { PERPETUAL_ID } from "../scripts/deployment/contracts";
import {getBTCBaseParams} from "./TestFactory";

const { ethers } = require("hardhat");

const BN = ethers.BigNumber;

const ONE_DEC18 = BN.from(10).pow(BN.from(18));
const ONE_64x64 = BN.from("0x010000000000000000");
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MASK_MARKET_ORDER = BN.from("0x40000000");
const BTC = toBytes32("BTC");
const USD = toBytes32("USD");
const ETH = toBytes32("ETH");

describe("PerpetualGasUsage", () => {
    let accounts, owner;
    let manager;
    let poolId, perpetualId, perpetualId2;
    let marginToken;

    before(async () => {
        accounts = await getAccounts();
        owner = accounts[0].address;

        manager = await createPerpetualManager();
        let poolData = await createLiquidityPool(manager, owner);
        poolId = poolData.id;
        

        let S2 = 60000;
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
        let oracles = [oracleBTCUSD.address, await createOracle(ETH, USD)];
        perpetualId = await createPerpetual(manager, poolData.id, getBTCBaseParams(), null, null, COLLATERAL_CURRENCY_BASE, oracles);
        perpetualId2 = await createPerpetual(manager, poolData.id, getBTCBaseParams(), null, null, COLLATERAL_CURRENCY_BASE, oracles);
        let perpetualId3 = await createPerpetual(manager, poolData.id, getBTCBaseParams(), null, null, COLLATERAL_CURRENCY_BASE, oracles);
        let perpetualId4 = await createPerpetual(manager, poolData.id, getBTCBaseParams(), null, null, COLLATERAL_CURRENCY_BASE, oracles);
        let perpetualId5 = await createPerpetual(manager, poolData.id, getBTCBaseParams(), null, null, COLLATERAL_CURRENCY_BASE, oracles);
        await manager.runLiquidityPool(poolId);

        marginToken = poolData.marginToken;
        await marginToken.mint(accounts[0].address, ONE_DEC18.mul(100));
        await marginToken.mint(accounts[1].address, ONE_DEC18.mul(100));
        //await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));
        await poolData.marginToken.connect(accounts[0]).approve(manager.address, ONE_DEC18.mul(1000));
        await poolData.marginToken.connect(accounts[1]).approve(manager.address, ONE_DEC18.mul(1000));

    });

    describe("trade", () => {
        it("gas usage", async () => {
            let depositAmount = floatToABK64x64(0.02);
            await deposit(manager, marginToken, perpetualId, depositAmount, owner);
            let tradeVec = [0.1, 0.02, -0.005, -0.006, 0.06, 0.1, 0.5];
            let gasSum = BN.from(0);
            let count = 0;
            for(var k = 0; k<tradeVec.length; k++) {
                for(var j = 0; j < 2; j++) {
                    let tradeAmount = (-1)**j * tradeVec[k];
                    let fLimitPrice = tradeAmount<0 ? floatToABK64x64(0) : floatToABK64x64(100_000);
                    let fLeverage = floatToABK64x64(3); 
                    let tx = await gmTrade(manager, perpetualId, floatToABK64x64(tradeAmount), fLimitPrice, 
                        accounts[1], ZERO_ADDRESS, null, fLeverage);
                    //let tx = await trade(manager, perpetualId, floatToABK64x64(tradeAmount), fLimitPrice, owner);
                    await tx.wait();
                    let receipt = await ethers.provider.getTransactionReceipt(tx.hash);
                    gasSum = gasSum.add(receipt.gasUsed);
                    count ++;
                    //>console.log("trade: gasUsed = " + receipt.gasUsed);
                }
            }
            console.log("trade: avg gasUsed = " + gasSum.div(BN.from(count)));
            let withdrawAmount = floatToABK64x64(0.01);
            await withdraw(manager, marginToken, perpetualId, withdrawAmount, owner);
        });
    });

     // place a market order
     async function gmTrade(manager, perpetualId, tradeAmount, limitPrice, account, referrer?, deadline?,
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

        return await manager.connect(account).trade(order, { gasLimit: 3_500_000 });
    }
});
