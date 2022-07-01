// @ts-nocheck
import {getAccounts, toBytes32} from "../scripts/utils/utils";
import {
    createLiquidityPool,
    createOracle,
    createOracleForIT,
    createPerpetual,
    createPerpetualForIT,
    createPerpetualManager,
    createPerpetualWithOracles
} from "./TestFactory";
import { floatToABK64x64 } from "../scripts/utils/perpMath";
import { deposit, trade } from "../scripts/deployment/deploymentUtil";
import { PERPETUAL_ID } from "../scripts/deployment/contracts";
import {expect} from "chai";

const { ethers } = require("hardhat");

const BN = ethers.BigNumber;

const ONE_DEC18 = BN.from(10).pow(BN.from(18));
const ONE_64x64 = BN.from("0x010000000000000000");

const BTC = toBytes32("BTC");
const USD = toBytes32("USD");
const ETH = toBytes32("ETH");

describe("PerpetualTradeLimits", () => {
    let accounts, owner;
    let manager;
    let poolId, perpetualId;
    let marginToken;

    before(async () => {
        accounts = await getAccounts();
        owner = accounts[0].address;

        manager = await createPerpetualManager();
        let poolData = await createLiquidityPool(manager, owner);
        poolId = poolData.id;
        marginToken = poolData.marginToken;
        await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));

        let oracles = [await createOracleForIT(BTC, USD), await createOracleForIT(ETH, USD)];
        perpetualId = await createPerpetualWithOracles(manager, poolId, oracles);

        await manager.runLiquidityPool(poolId);
    });

    describe("setWhitelistActive", () => {
        it("should fail if not an owner", async () => {
            await expect(
                manager.connect(accounts[1]).setWhitelistActive(true)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should set flag", async () => {
            let isWhitelistActive = await manager.isWhitelistActive();
            expect(isWhitelistActive).to.be.false;

            await manager.setWhitelistActive(true);
            isWhitelistActive = await manager.isWhitelistActive();
            expect(isWhitelistActive).to.be.true;

            await manager.setWhitelistActive(false);
            isWhitelistActive = await manager.isWhitelistActive();
            expect(isWhitelistActive).to.be.false;
        });
    });

    describe("addToWhitelist", () => {
        it("should fail if not an owner", async () => {
            await expect(
                manager.connect(accounts[1]).addToWhitelist([])
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should add to whitelist", async () => {
            let users = [accounts[0].address, accounts[1].address];
            expect(await manager.isWhitelisted(users[0])).to.be.false;
            expect(await manager.isWhitelisted(users[1])).to.be.false;

            let whitelisted = await manager.getWhitelistedAddresses();
            expect(whitelisted.length).equal(0);

            await manager.addToWhitelist(users);

            expect(await manager.isWhitelisted(users[0])).to.be.true;
            expect(await manager.isWhitelisted(users[1])).to.be.true;

            whitelisted = await manager.getWhitelistedAddresses();
            expect(whitelisted.length).equal(users.length);
            for (let i = 0; i < users.length; i++) {
                expect(whitelisted[i]).equal(users[i]);
            }

            await manager.addToWhitelist(users);
        });
    });

    describe("removeFromWhitelist", () => {
        it("should fail if not an owner", async () => {
            await expect(
                manager.connect(accounts[1]).removeFromWhitelist([])
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should add to whitelist", async () => {
            let users = [accounts[0].address, accounts[1].address];

            let whitelisted = await manager.getWhitelistedAddresses();

            await manager.addToWhitelist(users);

            expect(await manager.isWhitelisted(users[0])).to.be.true;
            expect(await manager.isWhitelisted(users[1])).to.be.true;

            whitelisted = await manager.getWhitelistedAddresses();
            expect(whitelisted.length).equal(users.length);
            for (let i = 0; i < users.length; i++) {
                expect(whitelisted[i]).equal(users[i]);
            }

            await manager.removeFromWhitelist(users);

            expect(await manager.isWhitelisted(users[0])).to.be.false;
            expect(await manager.isWhitelisted(users[1])).to.be.false;

            whitelisted = await manager.getWhitelistedAddresses();
            expect(whitelisted.length).equal(0);
        });
    });

    describe("setMaxPosition", () => {
        it("should fail if not an owner", async () => {
            await expect(
                manager.connect(accounts[1]).setMaxPosition(perpetualId, ONE_64x64)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should set flag", async () => {
            let maxPosition = await manager.getMaxPosition(perpetualId);
            expect(maxPosition).equal(0);

            let newMaxPosition = floatToABK64x64(123);
            await manager.setMaxPosition(perpetualId, newMaxPosition);
            maxPosition = await manager.getMaxPosition(perpetualId);
            expect(maxPosition).equal(newMaxPosition);
        });
    });

});
