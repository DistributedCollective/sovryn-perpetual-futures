// @ts-nocheck
import { createContract, getAccounts } from "../scripts/utils/utils";
import { expect } from "chai";
import { ZERO_ADDRESS } from "../scripts/deployment/deploymentUtil";
const { ethers } = require("hardhat");

const BN = ethers.BigNumber;

describe("PerpetualManagerProxy", () => {
    let accounts, owner;
    let manager, impl1, impl2;

    before(async () => {
        accounts = await getAccounts();
        owner = accounts[0].address;

        manager = await createContract("PerpetualManagerProxy");
        impl1 = await createContract("PerpetualTradeManager");
        impl2 = await createContract("PerpetualDepositManager");
    });

    describe("setImplementation", () => {
        it("should fail if not proxy owner", async () => {
            await expect(manager.connect(accounts[1]).setImplementation(impl1.address)).to.be.revertedWith("Proxy:access denied");
        });

        it("should fail if an implementation address is zero", async () => {
            await expect(manager.connect(accounts[0]).setImplementation(ZERO_ADDRESS)).to.be.revertedWith("Proxy::setImplementation: invalid address");
        });

        it("should set an implementation", async () => {
            await manager.setImplementation(impl1.address);

            let functionList = (await impl1.getFunctionList())[0];
            for (let i = 0; i < functionList.length; i++) {
                let implementation = await manager.getImplementation(functionList[i]);
                expect(implementation).equal(impl1.address);
            }
        });
    });

    describe("setProxyOwner", () => {
        it("should fail if not proxy owner", async () => {
            await expect(manager.connect(accounts[1]).setProxyOwner(accounts[1].address)).to.be.revertedWith("Proxy:access denied");
        });

        it("should set new proxy owner", async () => {
            await manager.connect(accounts[0]).setProxyOwner(accounts[1].address);

            let proxyOwner = await manager.getProxyOwner();
            expect(proxyOwner).equal(accounts[1].address);
        });
    });

    describe("Proxy overrides", () => {
        it("payment to proxy should fail", async () => {
            const tx = accounts[0].sendTransaction({to: manager.address, value: ethers.utils.parseEther("1.1")});
            await expect(tx).to.be.revertedWith("contract not payable");
        });

    });
        
});
