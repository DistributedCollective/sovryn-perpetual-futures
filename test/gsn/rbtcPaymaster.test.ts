import { expect } from "chai";
import { ethers, waffle } from "hardhat";
const { BigNumber } = ethers;
const { deployMockContract } = waffle;
const { defaultAbiCoder: abi } = ethers.utils;

const btcethPrice = BigNumber.from("14198494959534290000");
const postGasUsage = BigNumber.from("33567");
const maxPossibleGas = BigNumber.from("631495"); // Gas limit for meta transaction
const gasUseWithoutPost = BigNumber.from("108435");

function createMockRelayRequest(fromAddress, paymasterAddress) {
    const request = {
        from: fromAddress,
        to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        value: 0,
        gas: 494832,
        nonce: 1,
        data: "0xb8c8f6ee00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000186a00000000000000000",
        validUntil: 9653653,
    };

    const relayData = {
        gasPrice: 1200000011,
        pctRelayFee: 70,
        baseRelayFee: 0,
        relayWorker: "0xcD64DAA0d258Cc0C0AEB1e297Aa6d0698F813aF0",
        paymaster: paymasterAddress,
        forwarder: "0x83A54884bE4657706785D7309cf46B58FE5f6e8a",
        paymasterData: "0x",
        clientId: 1,
    };

    return {
        request,
        relayData,
    };
}

function computeEthActualCharge(relayData) {
    return parseInt(relayData.baseRelayFee + (gasUseWithoutPost.add(postGasUsage).toNumber() * relayData.gasPrice * (relayData.pctRelayFee + 100)) / 100);
}

function computeTokenActualCharge(ethActualCharge) {
    return ethActualCharge.mul("1000000000000000000").div(btcethPrice);
}

describe("RbtcPaymaster", () => {
    let owner, user; // wallets
    let mockBtcethAggregator; // mocks
    let mockToken, rbtcPaymaster, mockRelayHub; // contracts
    let relayRequest;

    before(async () => {
        [owner, user] = await ethers.getSigners();
        if (user==undefined) {
            user = owner;
        }
        mockBtcethAggregator = await deployMockContract(owner, require("../../abi/AggregatorV3Interface.json"));
        await mockBtcethAggregator.mock.latestRoundData.returns(0, btcethPrice.toString(), 0, 0, 0);
    });

    beforeEach(async () => {
        const MockRelayHub = await ethers.getContractFactory("MockRelayHub");
        const MockToken = await ethers.getContractFactory("MockRbtc");
        const RbtcPaymaster = await ethers.getContractFactory("RbtcPaymaster");

        mockToken = await MockToken.deploy(ethers.constants.AddressZero);
        rbtcPaymaster = await RbtcPaymaster.deploy(postGasUsage, mockToken.address, mockBtcethAggregator.address);
        mockRelayHub = await MockRelayHub.deploy(rbtcPaymaster.address, mockToken.address);

        await rbtcPaymaster.setRelayHub(mockRelayHub.address);

        await mockToken.setPaymaster(rbtcPaymaster.address);
        await mockToken.mint(user.address, ethers.utils.parseUnits("100000000000000", 18));
        await mockToken.connect(user).approve(rbtcPaymaster.address, ethers.utils.parseUnits("100000000000000", 18));

        relayRequest = createMockRelayRequest(user.address, rbtcPaymaster.address);
    });

    describe("Basic functions", () => {
        it("should return correct version", async () => {
            expect(await rbtcPaymaster.versionPaymaster()).equal("2.2.0+opengsn.rbtc.ipaymaster");
        });

        it("should set relayHub at deployment", async () => {
            expect(await rbtcPaymaster.getHubAddr()).equal(mockRelayHub.address);
        });

        it("should set rBTC address at deployment", async () => {
            expect(await rbtcPaymaster.rbtc()).equal(mockToken.address);
        });

        it("should set price feed address at deployment", async () => {
            expect(await rbtcPaymaster.btcbnbFeed()).equal(mockBtcethAggregator.address);
        });

        it("should get payer from relay request", async () => {
            expect(await rbtcPaymaster.getPayer(relayRequest)).equal(user.address);
        });

        it("should withdraw rbtc token", async () => {
            const amount = 10000000;
            await mockToken.mint(rbtcPaymaster.address, amount);
            await expect(() => rbtcPaymaster.withdrawRbtcCollected(user.address, amount)).to.changeTokenBalance(mockToken, user, amount);
        });

        it("should not withdraw rbtc token if not owner", async () => {
            const amount = 10000000;
            await mockToken.mint(rbtcPaymaster.address, amount);
            await expect(rbtcPaymaster.connect(user).withdrawRbtcCollected(user.address, amount)).to.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("Internal functions", () => {
        it("should compute token amount needed", async () => {
            const MockRbtcPaymaster = await ethers.getContractFactory("MockRbtcPaymaster");
            const mockRbtcPaymaster = await MockRbtcPaymaster.deploy(postGasUsage, mockToken.address, mockBtcethAggregator.address);

            const tokenAmountExpected = maxPossibleGas.mul("1000000000000000000").div(btcethPrice);
            expect(await mockRbtcPaymaster.convertBnbToBtc(maxPossibleGas)).equal(tokenAmountExpected);
        });
    });

    describe("Relay calls", () => {
        describe("PreRelayeCall", () => {
            let preChargeExpected;

            before(async () => {
                const { request, relayData } = relayRequest;
                let ethMaxCharge = parseInt(
                    relayData.baseRelayFee + (maxPossibleGas.add(postGasUsage).toNumber() * relayData.gasPrice * (relayData.pctRelayFee + 100)) / 100
                );
                ethMaxCharge += request.value;
                preChargeExpected = BigNumber.from(ethMaxCharge).mul("1000000000000000000").div(btcethPrice);
            });

            it("should return correct values for pre relayed call", async () => {
                const res = await mockRelayHub.callStatic.callPreRelayedCall(relayRequest, maxPossibleGas);
                const data = abi.decode(["address", "uint256"], res[0]);

                expect(data[0]).equal(user.address);
                expect(data[1]).equal(preChargeExpected);
                expect(res[1]).to.be.false;
            });

            it("should get rBTC for pre relayed call", async () => {
                await expect(() => mockRelayHub.callPreRelayedCall(relayRequest, maxPossibleGas)).to.changeTokenBalances(
                    mockToken,
                    [user, rbtcPaymaster],
                    [preChargeExpected.mul(-1), preChargeExpected]
                );
            });

            it("should not pre relayed call if not relayHub", async () => {
                await expect(rbtcPaymaster.preRelayedCall(relayRequest, "0x", "0x", maxPossibleGas)).to.be.revertedWith("can only be called by RelayHub");
            });
        });

        describe("PostRelayeCall", () => {
            let relayData;
            let context;
            let tokenPrecharge;
            let ethActualCharge;
            let tokenActualCharge;

            before(async () => {
                relayData = relayRequest.relayData;

                const res = await mockRelayHub.callStatic.callPreRelayedCall(relayRequest, maxPossibleGas);
                context = res[0];

                const data = abi.decode(["address", "uint256"], context);
                tokenPrecharge = data[1];

                ethActualCharge = computeEthActualCharge(relayData);
                tokenActualCharge = computeTokenActualCharge(BigNumber.from(ethActualCharge));
            });

            beforeEach(async () => {
                await mockRelayHub.callPreRelayedCall(relayRequest, maxPossibleGas);
            });

            it("should refund payer for excess taken", async () => {
                const tokenRefundExpected = tokenPrecharge.sub(tokenActualCharge);
                await expect(() => mockRelayHub.callPostRelayedCall(context, gasUseWithoutPost, relayData)).to.changeTokenBalance(
                    mockToken,
                    user,
                    tokenRefundExpected
                );
            });

            it("should emit TokensCharged event with correct arguments", async () => {
                await expect(mockRelayHub.callPostRelayedCall(context, gasUseWithoutPost, relayData))
                    .to.emit(rbtcPaymaster, "TokensCharged")
                    .withArgs(gasUseWithoutPost, ethActualCharge, tokenActualCharge);
            });

            it("should not post relayed call if not relayHub", async () => {
                await expect(rbtcPaymaster.postRelayedCall(context, true, gasUseWithoutPost, relayData)).to.be.revertedWith("can only be called by RelayHub");
            });
        });
    });

    describe("Compute postGasUsage value for production", () => {
        it("should return postGasUsage", async () => {
            const tokenPreCharge = 10000000000;
            await mockToken.mint(mockRelayHub.address, tokenPreCharge);
            await rbtcPaymaster.transferOwnership(mockRelayHub.address);
            let usage = await mockRelayHub.calculatePostGasUsage(tokenPreCharge);
            console.log("Post Gas Usage = ", postGasUsage.toString());
        });
    });
});
