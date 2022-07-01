// @ts-nocheck
import { expect, use, util } from "chai";
const { ethers } = require("hardhat");
import { waffleChai } from "@ethereum-waffle/chai";
import { fromBytes32, toBytes32, createContract, getAccounts } from "../scripts/utils/utils";
import { deployMockContract } from "ethereum-waffle";
import * as fs from "fs";
import {
    createOracle,
    createLiquidityPool,
    createPerpetual,
    createPerpetualManager,
    getBTCBaseParams,
    getBTCRiskParams,
    getBTCFundRiskParams,
} from "./TestFactory";
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
} from "../scripts/utils/perpMath";
import { BigNumber } from "@ethersproject/bignumber";
import { float } from "hardhat/internal/core/params/argumentTypes";
const BN = ethers.BigNumber;

const ONE_DEC18 = BN.from(10).pow(BN.from(18));
const ONE_64x64 = BN.from("0x010000000000000000");

const BTC = toBytes32("BTC");
const USD = toBytes32("USD");
const ETH = toBytes32("ETH");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const COLLATERAL_CURRENCY_QUOTE = 0;
const COLLATERAL_CURRENCY_BASE = 1;
const COLLATERAL_CURRENCY_QUANTO = 2;

const PERPETUAL_STATE_INVALID = 0;
const PERPETUAL_STATE_INITIALIZING = 1;
const PERPETUAL_STATE_NORMAL = 2;
const PERPETUAL_STATE_EMERGENCY = 3;
const PERPETUAL_STATE_CLEARED = 4;

describe("PerpetualManager", () => {
    let accounts, owner;
    let manager;

    before(async () => {
        accounts = await getAccounts();
        owner = accounts[0].address;

        manager = await createPerpetualManager();
    });

    describe("createLiquidityPool", () => {

        it("should fail if not an owner", async () => {
            await expect(
                manager.connect(accounts[1]).createLiquidityPool(ZERO_ADDRESS, ZERO_ADDRESS, 86400, 86400, ONE_64x64, ONE_64x64, ONE_64x64.mul(-1))
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should fail if treasury address is zero", async () => {
            await expect(
                manager.createLiquidityPool(ZERO_ADDRESS, ZERO_ADDRESS, 86400, 86400, ONE_64x64, ONE_64x64, ONE_64x64.mul(-1))
            ).to.be.revertedWith("invalid treasuryAddress");
        });

        it("should fail if treasury address is manager", async () => {
            await expect(
                manager.createLiquidityPool(manager.address, ZERO_ADDRESS, 86400, 86400, ONE_64x64, ONE_64x64, ONE_64x64.mul(-1))
            ).to.be.revertedWith("invalid treasuryAddress");
        });

        it("should fail if margin token address is zero", async () => {
            await expect(manager.createLiquidityPool(owner, ZERO_ADDRESS, 86400, 86400, ONE_64x64, ONE_64x64, ONE_64x64.mul(-1))).to.be.revertedWith(
                "invalid marginTokenAddress"
            );
        });

        it("should fail if margin token address is manager", async () => {
            await expect(manager.createLiquidityPool(owner, manager.address, 86400, 86400, ONE_64x64, ONE_64x64, ONE_64x64.mul(-1))).to.be.revertedWith(
                "invalid marginTokenAddress"
            );
        });

        it("should fail if _iTargetPoolSizeUpdateTime < 30", async () => {
            await expect(manager.createLiquidityPool(owner, owner, 0, 86400, ONE_64x64, ONE_64x64, ONE_64x64.mul(-1))).to.be.revertedWith(
                "invalid iTargetPoolSizeUpdateTime"
            );
        });

        it("should fail if _iTargetPoolSizeUpdateTime > 1 week", async () => {
            await expect(manager.createLiquidityPool(owner, owner, 86400 * 7 + 1, 86400, ONE_64x64, ONE_64x64, ONE_64x64.mul(-1))).to.be.revertedWith(
                "invalid iTargetPoolSizeUpdateTime"
            );
        });

        it("should fail if _iPnLparticipantWithdrawalPeriod <= 0", async () => {
            await expect(manager.createLiquidityPool(owner, owner, 86400, 0, ONE_64x64, ONE_64x64, ONE_64x64.mul(-1))).to.be.revertedWith(
                "invalid iPnLparticipantWithdrawalPeriod"
            );
        });

        it("should fail if _iPnLparticipantWithdrawalPeriod > 1 week", async () => {
            await expect(manager.createLiquidityPool(owner, owner, 86400, 86400 * 7 + 1, ONE_64x64, ONE_64x64, ONE_64x64.mul(-1))).to.be.revertedWith(
                "invalid iPnLparticipantWithdrawalPeriod"
            );
        });

        it("should fail if _fPnLparticipantWithdrawalPercentageLimit <= 0", async () => {
            await expect(manager.createLiquidityPool(owner, owner, 86400, 86400, 0, ONE_64x64, ONE_64x64.mul(-1))).to.be.revertedWith(
                "invalid fPnLparticipantWithdrawalPercentageLimit"
            );
        });

        it("should fail if _fPnLparticipantWithdrawalPercentageLimit >= ONE_64x64", async () => {
            await expect(manager.createLiquidityPool(owner, owner, 86400, 86400, ONE_64x64, ONE_64x64, ONE_64x64.mul(-1))).to.be.revertedWith(
                "invalid fPnLparticipantWithdrawalPercentageLimit"
            );
        });

        it("should fail if _fPnLparticipantWithdrawalMinAmountLimit <= 0", async () => {
            await expect(manager.createLiquidityPool(owner, owner, 86400, 86400, ONE_64x64.div(BN.from(9)), 0, ONE_64x64.mul(-1))).to.be.revertedWith(
                "invalid fPnLparticipantWithdrawalMinAmountLimit"
            );
        });

        it("should create liquidity pool", async () => {
            let treasuryAddress = owner;
            let marginTokenAddress = accounts[1].address;
            let iTargetPoolSizeUpdateTime = 10800;
            let iPnLparticipantWithdrawalPeriod = 86400 / 3;
            let fPnLparticipantWithdrawalPercentageLimit = ONE_64x64.div(BN.from(9));
            let fPnLparticipantWithdrawalMinAmountLimit = ONE_64x64;
            let fMaxTotalTraderFunds = ONE_64x64.mul(-1);

            let tx = await manager.createLiquidityPool(
                treasuryAddress,
                marginTokenAddress,
                iTargetPoolSizeUpdateTime,
                iPnLparticipantWithdrawalPeriod,
                fPnLparticipantWithdrawalPercentageLimit,
                fPnLparticipantWithdrawalMinAmountLimit,
                fMaxTotalTraderFunds
            );

            let poolCount = await manager.getPoolCount();
            expect(poolCount).equal(1);

            let poolData = await manager.getLiquidityPool(poolCount);
            expect(poolData.shareTokenAddress).not.equal(ZERO_ADDRESS);
            expect(poolData.id).equal(poolCount);
            expect(poolData.treasuryAddress).equal(treasuryAddress);
            expect(poolData.marginTokenAddress).equal(marginTokenAddress);
            expect(poolData.iTargetPoolSizeUpdateTime).equal(iTargetPoolSizeUpdateTime);
            expect(poolData.iPnLparticipantWithdrawalPeriod).equal(iPnLparticipantWithdrawalPeriod);
            expect(poolData.fPnLparticipantWithdrawalPercentageLimit).equal(fPnLparticipantWithdrawalPercentageLimit);
            expect(poolData.fPnLparticipantWithdrawalMinAmountLimit).equal(fPnLparticipantWithdrawalMinAmountLimit);
            expect(poolData.fMaxTotalTraderFunds).equal(fMaxTotalTraderFunds);

            let shareToken = await ethers.getContractAt("ShareToken", poolData.shareTokenAddress);
            let shareTokenOwner = await shareToken.owner();
            expect(shareTokenOwner).equal(manager.address);

            await expect(shareToken.mint(owner, ONE_DEC18)).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(shareToken.burn(owner, ONE_DEC18)).to.be.revertedWith("Ownable: caller is not the owner");

            await expect(tx)
                .to.emit(manager, "LiquidityPoolCreated")
                .withArgs(
                    poolData.id,
                    poolData.treasuryAddress,
                    poolData.marginTokenAddress,
                    poolData.shareTokenAddress,
                    poolData.iTargetPoolSizeUpdateTime,
                    poolData.iPnLparticipantWithdrawalPeriod,
                    poolData.fPnLparticipantWithdrawalPercentageLimit,
                    poolData.fPnLparticipantWithdrawalMinAmountLimit
                );
        });
    });
    
    describe("createPerpetual", () => {
        let poolId;
        let oracles;
        let baseParams;
        let underlyingRiskParams;
        let defaultFundRiskParams;
        let eCollateralCurrency = COLLATERAL_CURRENCY_QUANTO;
        let value = ONE_64x64.div(BN.from(10));
        let ONEQUARTER_64x64 = BN.from("0x40000000000000000");
        beforeEach(async () => {
            poolId = 1;
            oracles = [await createOracle(BTC, USD), await createOracle(ETH, USD)];
            baseParams = getBTCBaseParams();
            underlyingRiskParams = getBTCRiskParams();
            defaultFundRiskParams = getBTCFundRiskParams();
        });

        it("should fail if not an owner", async () => {
            await expect(manager.connect(accounts[1]).createPerpetual(999, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it("should fail if liquidity pool not found", async () => {
            await expect(manager.createPerpetual(999, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "liquidity pool not found"
            );
        });

        it("should fail if invalid oracleS2Addr [1]", async () => {
            oracles[0] = manager.address;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid oracleS2Addr"
            );
        });

        it("should fail if invalid oracleS2Addr [2]", async () => {
            oracles[0] = ZERO_ADDRESS;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid oracleS2Addr"
            );
        });

        it("should fail if invalid oracleS2Addr [3]", async () => {
            oracles[0] = owner;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid oracle oracleS2Addr"
            );
        });

        it("should fail if invalid oracleS3Addr [1]", async () => {
            oracles[1] = manager.address;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid oracleS3Addr"
            );
        });

        it("should fail if invalid oracleS3Addr [2]", async () => {
            oracles[1] = oracles[0];
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid oracleS3Addr"
            );
        });

        it("should fail if invalid oracleS3Addr [3]", async () => {
            oracles[1] = ZERO_ADDRESS;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid oracleS3Addr"
            );
        });

        it("should fail if invalid oracleS3Addr [4]", async () => {
            oracles[1] = owner;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid oracle oracleS3Addr"
            );
        });

        it("should fail if invalid fInitialMarginRateAlpha [1]", async () => {
            baseParams[0] = 0;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "fMaintenanceMarginRateAlpha must be < fInitialMarginRateAlpha and positive"
            );
        });

        it("should fail if invalid fInitialMarginRateAlpha [2]", async () => {
            baseParams[0] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fInitialMarginRateAlpha"
            );
        });

        it("should fail if invalid fMarginRateBeta [1]", async () => {
            baseParams[1] = 0;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fMarginRateBeta"
            );
        });

        it("should fail if invalid fMarginRateBeta [2]", async () => {
            baseParams[1] = ONE_64x64.add(ONE_64x64);
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fMarginRateBeta"
            );
        });

        it("should fail if invalid fMaintenanceMarginRateAlpha [1]", async () => {
            baseParams[2] = 0;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "fMaintenanceMarginRateAlpha must be < fInitialMarginRateAlpha and positive"
            );
        });

        it("should fail if invalid fMaintenanceMarginRateAlpha [2]", async () => {
            baseParams[2] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "fMaintenanceMarginRateAlpha must be < fInitialMarginRateAlpha and positive"
            );
        });

        it("should fail if invalid fInitialMarginRateCap [2]", async () => {
            baseParams[3] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "fInitialMarginRateCap must be > 0 and <1"
            );
        });

        it("should fail if invalid fTreasuryFeeRate [1]", async () => {
            baseParams[4] = 0;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fTreasuryFeeRate"
            );
        });

        it("should fail if invalid fTreasuryFeeRate [2]", async () => {
            baseParams[4] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fTreasuryFeeRate"
            );
        });

        it("should fail if invalid fPnLPartRate [1]", async () => {
            baseParams[5] = 0;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fPnLPartRate"
            );
        });

        it("should fail if invalid fPnLPartRate [2]", async () => {
            baseParams[5] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fPnLPartRate"
            );
        });

        it("should fail if invalid fReferralRebateCC [1]", async () => {
            baseParams[6] = -1;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fReferralRebateCC"
            );
        });

        it("should fail if invalid fLiquidationPenaltyRate [1]", async () => {
            baseParams[7] = 0;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fLiquidationPenaltyRate"
            );
        });

        it("should fail if invalid fLiquidationPenaltyRate [2]", async () => {
            baseParams[7] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fLiquidationPenaltyRate"
            );
        });

        it("should fail if invalid fMinimalSpread [1]", async () => {
            baseParams[8] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fMinimalSpread"
            );
        });

        it("should fail if invalid fMinimalSpread [2]", async () => {
            baseParams[8] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fMinimalSpread"
            );
        });

        it("should fail if invalid fMinimalSpreadInStress [2]", async () => {
            baseParams[9] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fMinimalSpreadInStress"
            );
        });

        it("should fail if invalid fLotSizeBC", async () => {
            baseParams[10] = floatToABK64x64(0);
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fLotSizeBC"
            );
        });

        it("should fail if invalid fFundingRateClamp [1]", async () => {
            underlyingRiskParams[0] = floatToABK64x64(-1);
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fFundingRateClamp"
            );
        });

        it("should fail if invalid fFundingRateClamp [2]", async () => {
            underlyingRiskParams[0] = floatToABK64x64(1);
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fFundingRateClamp"
            );
        });

        it("should fail if invalid fMarkPriceEMALambda [1]", async () => {
            underlyingRiskParams[1] = 0;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fMarkPriceEMALambda"
            );
        });

        it("should fail if invalid fMarkPriceEMALambda [2]", async () => {
            underlyingRiskParams[1] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fMarkPriceEMALambda"
            );
        });

        it("should fail if invalid fSigma2 [1]", async () => {
            underlyingRiskParams[2] = 0;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fSigma2"
            );
        });

        it("should fail if invalid fSigma2 [2]", async () => {
            underlyingRiskParams[2] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fSigma2"
            );
        });

        it("should fail if invalid fSigma3 [1]", async () => {
            underlyingRiskParams[3] = 0;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fSigma3"
            );
        });

        it("should fail if invalid fSigma3 [2]", async () => {
            underlyingRiskParams[3] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fSigma3"
            );
        });

        it("should fail if invalid fRho23 [1]", async () => {
            underlyingRiskParams[4] = ONE_64x64.mul(BN.from(-2));
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fRho23"
            );
        });

        it("should fail if invalid fRho23 [2]", async () => {
            underlyingRiskParams[4] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fRho23"
            );
        });

        it("should fail if invalid fStressReturnS2[0] [1]", async () => {
            defaultFundRiskParams[0] = 0;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fStressReturnS2[0]"
            );
        });

        it("should fail if invalid fStressReturnS2[0] [2]", async () => {
            defaultFundRiskParams[0] = ONE_64x64.mul(BN.from(10));
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fStressReturnS2[0]"
            );
        });

        it("should fail if invalid fStressReturnS2[1] [1]", async () => {
            defaultFundRiskParams[1] = ONE_64x64.div(BN.from(-8));
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fStressReturnS2[1]"
            );
        });

        it("should fail if invalid fStressReturnS2[1] [2]", async () => {
            defaultFundRiskParams[1] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fStressReturnS2[1]"
            );
        });

        it("should fail if invalid fStressReturnS3[0] [1]", async () => {
            defaultFundRiskParams[2] = 0;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fStressReturnS3[0]"
            );
        });

        it("should fail if invalid fStressReturnS3[0] [2]", async () => {
            defaultFundRiskParams[2] = ONE_64x64.mul(BN.from(10));
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fStressReturnS3[0]"
            );
        });

        it("should fail if invalid fStressReturnS3[1] [1]", async () => {
            defaultFundRiskParams[3] = floatToABK64x64(-2);
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fStressReturnS3[1]"
            );
        });

        it("should fail if invalid fStressReturnS3[1] [2]", async () => {
            defaultFundRiskParams[3] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fStressReturnS3[1]"
            );
        });

        it("should fail if invalid fDFCoverNRate [1]", async () => {
            defaultFundRiskParams[4] = 0;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fDFCoverNRate"
            );
        });

        it("should fail if invalid fDFCoverNRate [2]", async () => {
            defaultFundRiskParams[4] = ONE_64x64.mul(BN.from(100));
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fDFCoverNRate"
            );
        });

        it("should fail if invalid fDFLambda[0] [1]", async () => {
            defaultFundRiskParams[5] = 0;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fDFLambda[0]"
            );
        });

        it("should fail if invalid fDFLambda[0] [2]", async () => {
            defaultFundRiskParams[5] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fDFLambda[0]"
            );
        });

        it("should fail if invalid fDFLambda[1] [1]", async () => {
            defaultFundRiskParams[6] = 0;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fDFLambda[1]"
            );
        });

        it("should fail if invalid fDFLambda[1] [2]", async () => {
            defaultFundRiskParams[6] = ONE_64x64;
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fDFLambda[1]"
            );
        });

        it("should fail if invalid fAMMTargetDD [1]", async () => {
            defaultFundRiskParams[7] = floatToABK64x64(5);
            defaultFundRiskParams[8] = floatToABK64x64(5);
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fAMMTargetDD"
            );
        });

        it("should fail if invalid fAMMTargetDD [2]", async () => {
            defaultFundRiskParams[7] = floatToABK64x64(-5);
            defaultFundRiskParams[8] = floatToABK64x64(-5);
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "invalid fAMMTargetDD"
            );
        });

        it("should fail if invalid fAMMTargetDD [3]", async () => {
            defaultFundRiskParams[7] = ONE_64x64.mul(BN.from(-2));
            defaultFundRiskParams[8] = ONE_64x64.mul(BN.from(-3));
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency)).to.be.revertedWith(
                "baseline fAMMTargetDD[0] must < stress fAMMTargetDD[1]"
            );
        });

        it("should fail if invalid eCollateralCurrency", async () => {
            defaultFundRiskParams[7] = ONE_64x64.mul(BN.from(-3));
            defaultFundRiskParams[8] = ONE_64x64.mul(BN.from(-2));
            await expect(manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, 5)).to.be.revertedWith(
                "invalid eCollateralCurrency"
            );
        });

        it("should create perpetual", async () => {
            let poolCount = await manager.getPoolCount();
            let pool = await manager.getLiquidityPool(poolCount);
            let perpetualCountBefore = pool.iPerpetualCount;
            let eCollateralCurrency = COLLATERAL_CURRENCY_BASE;
            let tx = await manager.createPerpetual(poolId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency);

            pool = await manager.getLiquidityPool(poolCount);
            let perpetualCountAfter = pool.iPerpetualCount;
            expect(perpetualCountAfter-perpetualCountBefore).equal(1);

            let perpetualCount = pool.iPerpetualCount;
            let perpetualId = await manager.getPerpetualId(poolId, perpetualCount - 1);
            // console.log(perpetualId);

            let perpetual = await manager.getPerpetual(perpetualId);
            // console.log(perpetual);

            //id, base data
            expect(perpetual.id).equal(perpetualId);
            expect(perpetual.poolId).equal(poolId);
            expect(await manager.getPoolIdByPerpetualId(perpetualId)).equal(poolId);

            // oracles
            expect(perpetual.oracleS2Addr).equal(oracles[0]);
            expect(perpetual.oracleS3Addr).equal(oracles[1]);

            // base parameters
            expect(perpetual.fInitialMarginRateAlpha).equal(baseParams[0]);
            expect(perpetual.fMarginRateBeta).equal(baseParams[1]);
            expect(perpetual.fMaintenanceMarginRateAlpha).equal(baseParams[2]);
            expect(perpetual.fInitialMarginRateCap).equal(baseParams[3]);
            expect(perpetual.fTreasuryFeeRate).equal(baseParams[4]);
            expect(perpetual.fPnLPartRate).equal(baseParams[5]);
            expect(perpetual.fReferralRebateCC).equal(baseParams[6]);
            expect(perpetual.fLiquidationPenaltyRate).equal(baseParams[7]);
            expect(perpetual.fMinimalSpread).equal(baseParams[8]);
            expect(perpetual.fMinimalSpreadInStress).equal(baseParams[9]);
            expect(perpetual.fLotSizeBC).equal(baseParams[10]);

            // risk parameters for underlying instruments
            expect(perpetual.fFundingRateClamp).equal(underlyingRiskParams[0]);
            expect(perpetual.fMarkPriceEMALambda).equal(underlyingRiskParams[1]);
            expect(perpetual.fSigma2).equal(underlyingRiskParams[2]);
            expect(perpetual.fSigma3).equal(underlyingRiskParams[3]);
            expect(perpetual.fRho23).equal(underlyingRiskParams[4]);

            // risk parameters for default fund / AMM pool
            expect(perpetual.fStressReturnS2[0]).equal(defaultFundRiskParams[0]);
            expect(perpetual.fStressReturnS2[1]).equal(defaultFundRiskParams[1]);
            expect(perpetual.fStressReturnS3[0]).equal(defaultFundRiskParams[2]);
            expect(perpetual.fStressReturnS3[1]).equal(defaultFundRiskParams[3]);
            expect(perpetual.fDFCoverNRate).equal(defaultFundRiskParams[4]);
            expect(perpetual.fDFLambda[0]).equal(defaultFundRiskParams[5]);
            expect(perpetual.fDFLambda[1]).equal(defaultFundRiskParams[6]);
            expect(perpetual.fAMMTargetDD[0]).equal(defaultFundRiskParams[7]);
            expect(perpetual.fAMMTargetDD[1]).equal(defaultFundRiskParams[8]);
            expect(perpetual.fAMMMinSizeCC).equal(defaultFundRiskParams[9]);
            expect(perpetual.fMinimalTraderExposureEMA).equal(defaultFundRiskParams[10]);
            expect(perpetual.fMinimalAMMExposureEMA).equal(defaultFundRiskParams[11]);
            expect(perpetual.fMaximalTradeSizeBumpUp).equal(defaultFundRiskParams[12]);
            // collateral currency base/quote/quanto
            expect(perpetual.eCollateralCurrency).equal(eCollateralCurrency);

            expect(perpetual.state).equal(PERPETUAL_STATE_INITIALIZING);

            await expect(tx)
                .to.emit(manager, "PerpetualCreated")
                .withArgs(poolId, perpetualId, oracles, baseParams, underlyingRiskParams, defaultFundRiskParams, eCollateralCurrency);
        });
    });

    describe("setEmergencyState", () => {
        let poolId, perpetualId;
        let oracles;
        let baseParams;
        beforeEach(async () => {
            poolId = 1;
            oracles = [await createOracle(BTC, USD), await createOracle(ETH, USD)];
            baseParams = getBTCBaseParams();
            perpetualId = await createPerpetual(manager, poolId);
        });

        it("should fail if not an owner", async () => {
            await expect(manager.connect(accounts[1]).setEmergencyState(perpetualId)).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it("should set state = EMERGENCY", async () => {
            await manager.setPerpetualState(perpetualId, PERPETUAL_STATE_NORMAL);
            await manager.setEmergencyState(perpetualId);

            let perpetual = await manager.getPerpetual(perpetualId);
            expect(perpetual.state).equal(PERPETUAL_STATE_EMERGENCY);
        });
    });

    describe("setPerpetualOracles", () => {
        let poolId;
        let perpetualId;
        let oracles;

        beforeEach(async () => {
            poolId = 1;
            oracles = [await createOracle(BTC, USD), await createOracle(ETH, USD)];
            perpetualId = await createPerpetual(manager, poolId);
        });

        it("should fail if not an owner", async () => {
            await expect(manager.connect(accounts[1]).setPerpetualOracles(perpetualId, oracles)).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it("should fail if perpetual not found", async () => {
            await expect(manager.setPerpetualOracles(toBytes32("Dummy"), oracles)).to.be.revertedWith(
                "perpetual not found"
            );
        });

        it("should fail if invalid oracleS2Addr [1]", async () => {
            oracles[0] = manager.address;
            await expect(manager.setPerpetualOracles(perpetualId, oracles)).to.be.revertedWith(
                "invalid oracleS2Addr"
            );
        });

        it("should fail if invalid oracleS2Addr [2]", async () => {
            oracles[0] = ZERO_ADDRESS;
            await expect(manager.setPerpetualOracles(perpetualId, oracles)).to.be.revertedWith(
                "invalid oracleS2Addr"
            );
        });

        it("should fail if invalid oracleS2Addr [3]", async () => {
            oracles[0] = owner;
            await expect(manager.setPerpetualOracles(perpetualId, oracles)).to.be.revertedWith(
                "invalid oracle oracleS2Addr"
            );
        });

        it("should fail if invalid oracleS3Addr [1]", async () => {
            oracles[1] = manager.address;
            await expect(manager.setPerpetualOracles(perpetualId, oracles)).to.be.revertedWith(
                "invalid oracleS3Addr"
            );
        });

        it("should fail if invalid oracleS3Addr [2]", async () => {
            oracles[1] = oracles[0];
            await expect(manager.setPerpetualOracles(perpetualId, oracles)).to.be.revertedWith(
                "invalid oracleS3Addr"
            );
        });

        it("should fail if invalid oracleS3Addr [3]", async () => {
            oracles[1] = ZERO_ADDRESS;
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualOracles(perpetualId, oracles)).to.be.revertedWith(
                "invalid oracleS3Addr"
            );
        });

        it("should fail if invalid oracleS3Addr [4]", async () => {
            oracles[1] = owner;
            await expect(manager.setPerpetualOracles(perpetualId, oracles)).to.be.revertedWith(
                "invalid oracle oracleS3Addr"
            );
        });

        it("should set oracles", async () => {
            oracles = [await createOracle(BTC, USD), await createOracle(ETH, USD)];
            let tx = await manager.setPerpetualOracles(perpetualId, oracles);

            let perpetual = await manager.getPerpetual(perpetualId);
            expect(perpetual.oracleS2Addr).equal(oracles[0]);
            expect(perpetual.oracleS3Addr).equal(oracles[1]);

            await expect(tx)
                .to.emit(manager, "SetOracles")
                .withArgs(
                    perpetualId,
                    oracles
                );
        });

    });

    describe("setPerpetualBaseParams", () => {
        let poolId, perpetualId;
        let oracles;
        let baseParams;
        beforeEach(async () => {
            poolId = 1;
            oracles = [await createOracle(BTC, USD), await createOracle(ETH, USD)];
            baseParams = getBTCBaseParams();
            perpetualId = await createPerpetual(manager, poolId);
        });

        it("should fail if not an owner", async () => {
            await expect(manager.connect(accounts[1]).setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it("should fail if invalid fInitialMarginRateAlpha [1]", async () => {
            baseParams[0] = 0;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "fMaintenanceMarginRateAlpha must be < fInitialMarginRateAlpha and positive"
            );
        });

        it("should fail if invalid fInitialMarginRateAlpha [2]", async () => {
            baseParams[0] = ONE_64x64;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "invalid fInitialMarginRateAlpha"
            );
        });

        it("should fail if invalid fMarginRateBeta [1]", async () => {
            baseParams[1] = 0;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "invalid fMarginRateBeta"
            );
        });

        it("should fail if invalid fMarginRateBeta [2]", async () => {
            baseParams[1] = ONE_64x64.add(ONE_64x64);
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "invalid fMarginRateBeta"
            );
        });

        it("should fail if invalid fMaintenanceMarginRateAlpha [1]", async () => {
            baseParams[2] = 0;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "fMaintenanceMarginRateAlpha must be < fInitialMarginRateAlpha and positive"
            );
        });

        it("should fail if invalid fMaintenanceMarginRateAlpha [2]", async () => {
            baseParams[2] = ONE_64x64;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "fMaintenanceMarginRateAlpha must be < fInitialMarginRateAlpha and positive"
            );
        });

        it("should fail if invalid fInitialMarginRateCap [2]", async () => {
            baseParams[3] = ONE_64x64;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "fInitialMarginRateCap must be > 0 and <1"
            );
        });

        it("should fail if invalid fTreasuryFeeRate [1]", async () => {
            baseParams[4] = 0;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "invalid fTreasuryFeeRate"
            );
        });

        it("should fail if invalid fTreasuryFeeRate [2]", async () => {
            baseParams[4] = ONE_64x64;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "invalid fTreasuryFeeRate"
            );
        });

        it("should fail if invalid fPnLPartRate [1]", async () => {
            baseParams[5] = 0;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "invalid fPnLPartRate"
            );
        });

        it("should fail if invalid fPnLPartRate [2]", async () => {
            baseParams[5] = ONE_64x64;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "invalid fPnLPartRate"
            );
        });

        it("should fail if invalid fReferralRebateCC [1]", async () => {
            baseParams[6] = -1;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "invalid fReferralRebateCC"
            );
        });

        it("should fail if invalid fLiquidationPenaltyRate [1]", async () => {
            baseParams[7] = 0;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "invalid fLiquidationPenaltyRate"
            );
        });

        it("should fail if invalid fLiquidationPenaltyRate [2]", async () => {
            baseParams[7] = ONE_64x64;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "invalid fLiquidationPenaltyRate"
            );
        });

        it("should fail if invalid fMinimalSpread [1]", async () => {
            baseParams[8] = ONE_64x64;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "invalid fMinimalSpread"
            );
        });

        it("should fail if invalid fMinimalSpread [2]", async () => {
            baseParams[8] = ONE_64x64;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "invalid fMinimalSpread"
            );
        });

        it("should fail if invalid fMinimalSpreadInStress [2]", async () => {
            baseParams[9] = ONE_64x64;
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "invalid fMinimalSpreadInStress"
            );
        });

        it("should fail if invalid fLotSizeBC", async () => {
            baseParams[10] = floatToABK64x64(0);
            await expect(manager.setPerpetualBaseParams(perpetualId, baseParams)).to.be.revertedWith(
                "invalid fLotSizeBC"
            );
        });

        it("should set perpetual base params", async () => {
            let tx = await manager.setPerpetualBaseParams(perpetualId, baseParams);

            let perpetual = await manager.getPerpetual(perpetualId);

            // base parameters
            expect(perpetual.fInitialMarginRateAlpha).equal(baseParams[0]);
            expect(perpetual.fMarginRateBeta).equal(baseParams[1]);
            expect(perpetual.fMaintenanceMarginRateAlpha).equal(baseParams[2]);
            expect(perpetual.fInitialMarginRateCap).equal(baseParams[3]);
            expect(perpetual.fTreasuryFeeRate).equal(baseParams[4]);
            expect(perpetual.fPnLPartRate).equal(baseParams[5]);
            expect(perpetual.fReferralRebateCC).equal(baseParams[6]);
            expect(perpetual.fLiquidationPenaltyRate).equal(baseParams[7]);
            expect(perpetual.fMinimalSpread).equal(baseParams[8]);
            expect(perpetual.fMinimalSpreadInStress).equal(baseParams[9]);
            expect(perpetual.fLotSizeBC).equal(baseParams[10]);

            await expect(tx)
                .to.emit(manager, "SetPerpetualBaseParameters")
                .withArgs(
                    perpetualId,
                    baseParams
                );
        });

    });

    describe("setPerpetualRiskParams", () => {
        let poolId, perpetualId;
        let oracles;
        let underlyingRiskParams, defaultFundRiskParams;
        beforeEach(async () => {
            poolId = 1;
            oracles = [await createOracle(BTC, USD), await createOracle(ETH, USD)];
            underlyingRiskParams = getBTCRiskParams();
            defaultFundRiskParams = getBTCFundRiskParams();
            perpetualId = await createPerpetual(manager, poolId);
        });

        it("should fail if not an owner", async () => {
            await expect(manager.connect(accounts[1]).setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it("should fail if invalid fFundingRateClamp [1]", async () => {
            underlyingRiskParams[0] = floatToABK64x64(-1);
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fFundingRateClamp"
            );
        });

        it("should fail if invalid fFundingRateClamp [2]", async () => {
            underlyingRiskParams[0] = floatToABK64x64(1);
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fFundingRateClamp"
            );
        });

        it("should fail if invalid fMarkPriceEMALambda [1]", async () => {
            underlyingRiskParams[1] = 0;
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fMarkPriceEMALambda"
            );
        });

        it("should fail if invalid fMarkPriceEMALambda [2]", async () => {
            underlyingRiskParams[1] = ONE_64x64;
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fMarkPriceEMALambda"
            );
        });

        it("should fail if invalid fSigma2 [1]", async () => {
            underlyingRiskParams[2] = 0;
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fSigma2"
            );
        });

        it("should fail if invalid fSigma2 [2]", async () => {
            underlyingRiskParams[2] = ONE_64x64;
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fSigma2"
            );
        });

        it("should fail if invalid fSigma3 [1]", async () => {
            underlyingRiskParams[3] = 0;
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fSigma3"
            );
        });

        it("should fail if invalid fSigma3 [2]", async () => {
            underlyingRiskParams[3] = ONE_64x64;
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fSigma3"
            );
        });

        it("should fail if invalid fRho23 [1]", async () => {
            underlyingRiskParams[4] = ONE_64x64.mul(BN.from(-2));
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fRho23"
            );
        });

        it("should fail if invalid fRho23 [2]", async () => {
            underlyingRiskParams[4] = ONE_64x64;
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fRho23"
            );
        });

        it("should fail if invalid fStressReturnS2[0] [1]", async () => {
            defaultFundRiskParams[0] = 0;
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fStressReturnS2[0]"
            );
        });

        it("should fail if invalid fStressReturnS2[0] [2]", async () => {
            defaultFundRiskParams[0] = ONE_64x64.mul(BN.from(10));
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fStressReturnS2[0]"
            );
        });

        it("should fail if invalid fStressReturnS2[1] [1]", async () => {
            defaultFundRiskParams[1] = floatToABK64x64(-0.1);
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fStressReturnS2[1]"
            );
        });

        it("should fail if invalid fStressReturnS2[1] [2]", async () => {
            defaultFundRiskParams[1] = ONE_64x64;
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fStressReturnS2[1]"
            );
        });

        it("should fail if invalid fStressReturnS3[0] [1]", async () => {
            defaultFundRiskParams[2] = 0;
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fStressReturnS3[0]"
            );
        });

        it("should fail if invalid fStressReturnS3[0] [2]", async () => {
            defaultFundRiskParams[2] = ONE_64x64.mul(BN.from(10));
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fStressReturnS3[0]"
            );
        });

        it("should fail if invalid fStressReturnS3[1] [1]", async () => {
            defaultFundRiskParams[3] = floatToABK64x64(-2);
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fStressReturnS3[1]"
            );
        });

        it("should fail if invalid fStressReturnS3[1] [2]", async () => {
            defaultFundRiskParams[3] = ONE_64x64;
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fStressReturnS3[1]"
            );
        });

        it("should fail if invalid fDFCoverNRate [1]", async () => {
            defaultFundRiskParams[4] = 0;
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fDFCoverNRate"
            );
        });

        it("should fail if invalid fDFCoverNRate [2]", async () => {
            defaultFundRiskParams[4] = ONE_64x64.mul(BN.from(100));
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fDFCoverNRate"
            );
        });

        it("should fail if invalid fDFLambda[0] [1]", async () => {
            defaultFundRiskParams[5] = 0;
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fDFLambda[0]"
            );
        });

        it("should fail if invalid fDFLambda[0] [2]", async () => {
            defaultFundRiskParams[5] = ONE_64x64;
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fDFLambda[0]"
            );
        });

        it("should fail if invalid fDFLambda[1] [1]", async () => {
            defaultFundRiskParams[6] = 0;
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fDFLambda[1]"
            );
        });

        it("should fail if invalid fDFLambda[1] [2]", async () => {
            defaultFundRiskParams[6] = ONE_64x64;
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fDFLambda[1]"
            );
        });

        it("should fail if invalid fAMMTargetDD [1]", async () => {
            defaultFundRiskParams[7] = floatToABK64x64(-10);
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fAMMTargetDD"
            );
        });

        it("should fail if invalid fAMMTargetDD [2]", async () => {
            defaultFundRiskParams[7] = floatToABK64x64(0);
            await expect(manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams)).to.be.revertedWith(
                "invalid fAMMTargetDD"
            );
        });

        it("should set perpetual risk params", async () => {
            underlyingRiskParams = getBTCRiskParams();
            defaultFundRiskParams = getBTCFundRiskParams();
            let tx = await manager.setPerpetualRiskParams(perpetualId, underlyingRiskParams, defaultFundRiskParams);

            let perpetual = await manager.getPerpetual(perpetualId);

            // risk parameters for underlying instruments
            expect(perpetual.fFundingRateClamp).equal(underlyingRiskParams[0]);
            expect(perpetual.fMarkPriceEMALambda).equal(underlyingRiskParams[1]);
            expect(perpetual.fSigma2).equal(underlyingRiskParams[2]);
            expect(perpetual.fSigma3).equal(underlyingRiskParams[3]);
            expect(perpetual.fRho23).equal(underlyingRiskParams[4]);

            // risk parameters for default fund / AMM pool
            expect(perpetual.fStressReturnS2[0]).equal(defaultFundRiskParams[0]);
            expect(perpetual.fStressReturnS2[1]).equal(defaultFundRiskParams[1]);
            expect(perpetual.fStressReturnS3[0]).equal(defaultFundRiskParams[2]);
            expect(perpetual.fStressReturnS3[1]).equal(defaultFundRiskParams[3]);
            expect(perpetual.fDFCoverNRate).equal(defaultFundRiskParams[4]);
            expect(perpetual.fDFLambda[0]).equal(defaultFundRiskParams[5]);
            expect(perpetual.fDFLambda[1]).equal(defaultFundRiskParams[6]);
            expect(perpetual.fAMMTargetDD[0]).equal(defaultFundRiskParams[7]);
            expect(perpetual.fAMMTargetDD[1]).equal(defaultFundRiskParams[8]);
            expect(perpetual.fAMMMinSizeCC).equal(defaultFundRiskParams[9]);
            expect(perpetual.fMinimalTraderExposureEMA).equal(defaultFundRiskParams[10]);
            expect(perpetual.fMinimalAMMExposureEMA).equal(defaultFundRiskParams[11]);
            expect(perpetual.fMaximalTradeSizeBumpUp).equal(defaultFundRiskParams[12]);
            await expect(tx)
                .to.emit(manager, "SetPerpetualRiskParameters")
                .withArgs(
                    perpetualId,
                    underlyingRiskParams,
                    defaultFundRiskParams
                );

        });

    });

    describe("setPerpetualParam", () => {
        let poolId, perpetualId;
        let oracles;
        let baseParams;
        beforeEach(async () => {
            poolId = 1;
            oracles = [await createOracle(BTC, USD), await createOracle(ETH, USD)];
            baseParams = getBTCBaseParams();
            perpetualId = await createPerpetual(manager, poolId);
        });

        it("should fail if not an owner", async () => {
            await expect(manager.connect(accounts[1]).setPerpetualParam(perpetualId, "name", 0)).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it("should fail if param not found", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "name", 0)).to.be.revertedWith(
                "parameter not found"
            );
        });

        it("should fail if invalid fInitialMarginRateAlpha [2]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fInitialMarginRateAlpha", ONE_64x64)).to.be.revertedWith(
                "invalid fInitialMarginRateAlpha"
            );
        });

        it("should fail if invalid fMarginRateBeta [1]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fMarginRateBeta", 0)).to.be.revertedWith(
                "invalid fMarginRateBeta"
            );
        });

        it("should fail if invalid fMarginRateBeta [2]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fMarginRateBeta", ONE_64x64.add(ONE_64x64))).to.be.revertedWith(
                "invalid fMarginRateBeta"
            );
        });

        it("should fail if invalid fMaintenanceMarginRateAlpha [1]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fMaintenanceMarginRateAlpha", 0)).to.be.revertedWith(
                "fMaintenanceMarginRateAlpha must be < fInitialMarginRateAlpha and positive"
            );
        });

        it("should fail if invalid fMaintenanceMarginRateAlpha [2]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fMaintenanceMarginRateAlpha", ONE_64x64)).to.be.revertedWith(
                "fMaintenanceMarginRateAlpha must be < fInitialMarginRateAlpha and positive"
            );
        });

        it("should fail if invalid fInitialMarginRateCap [2]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fInitialMarginRateCap", ONE_64x64)).to.be.revertedWith(
                "fInitialMarginRateCap must be > 0 and <1"
            );
        });

        it("should fail if invalid fTreasuryFeeRate [1]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fTreasuryFeeRate", 0)).to.be.revertedWith(
                "invalid fTreasuryFeeRate"
            );
        });

        it("should fail if invalid fTreasuryFeeRate [2]", async () => {
            baseParams[4] = ONE_64x64;
            await expect(manager.setPerpetualParam(perpetualId, "fTreasuryFeeRate", ONE_64x64)).to.be.revertedWith(
                "invalid fTreasuryFeeRate"
            );
        });

        it("should fail if invalid fPnLPartRate [1]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fPnLPartRate", 0)).to.be.revertedWith(
                "invalid fPnLPartRate"
            );
        });

        it("should fail if invalid fPnLPartRate [2]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fPnLPartRate", ONE_64x64)).to.be.revertedWith(
                "invalid fPnLPartRate"
            );
        });

        it("should fail if invalid fReferralRebateCC [1]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fReferralRebateCC", -1)).to.be.revertedWith(
                "invalid fReferralRebateCC"
            );
        });

        it("should fail if invalid fLiquidationPenaltyRate [1]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fLiquidationPenaltyRate", 0)).to.be.revertedWith(
                "invalid fLiquidationPenaltyRate"
            );
        });

        it("should fail if invalid fLiquidationPenaltyRate [2]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fLiquidationPenaltyRate", ONE_64x64)).to.be.revertedWith(
                "invalid fLiquidationPenaltyRate"
            );
        });

        it("should fail if invalid fMinimalSpread [1]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fMinimalSpread", ONE_64x64)).to.be.revertedWith(
                "invalid fMinimalSpread"
            );
        });

        it("should fail if invalid fMinimalSpread [2]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fMinimalSpread", ONE_64x64)).to.be.revertedWith(
                "invalid fMinimalSpread"
            );
        });

        it("should fail if invalid fLotSizeBC", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fLotSizeBC", 0)).to.be.revertedWith(
                "invalid fLotSizeBC"
            );
        });

        it("should fail if invalid fFundingRateClamp [1]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fFundingRateClamp", floatToABK64x64(-1))).to.be.revertedWith(
                "invalid fFundingRateClamp"
            );
        });

        it("should fail if invalid fFundingRateClamp [2]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fFundingRateClamp", floatToABK64x64(1))).to.be.revertedWith(
                "invalid fFundingRateClamp"
            );
        });

        it("should fail if invalid fMarkPriceEMALambda [1]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fMarkPriceEMALambda", 0)).to.be.revertedWith(
                "invalid fMarkPriceEMALambda"
            );
        });

        it("should fail if invalid fMarkPriceEMALambda [2]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fMarkPriceEMALambda", ONE_64x64)).to.be.revertedWith(
                "invalid fMarkPriceEMALambda"
            );
        });

        it("should fail if invalid fSigma2 [1]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fSigma2", 0)).to.be.revertedWith(
                "invalid fSigma2"
            );
        });

        it("should fail if invalid fSigma2 [2]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fSigma2", ONE_64x64)).to.be.revertedWith(
                "invalid fSigma2"
            );
        });

        it("should fail if invalid fSigma3 [1]", async () => {
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualParam(perpetualId, "fSigma3", 0)).to.be.revertedWith(
                "invalid fSigma3"
            );
        });

        it("should fail if invalid fSigma3 [2]", async () => {
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualParam(perpetualId, "fSigma3", ONE_64x64)).to.be.revertedWith(
                "invalid fSigma3"
            );
        });

        it("should fail if invalid fRho23 [1]", async () => {
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualParam(perpetualId, "fRho23", ONE_64x64.mul(BN.from(-2)))).to.be.revertedWith(
                "invalid fRho23"
            );
        });

        it("should fail if invalid fRho23 [2]", async () => {
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualParam(perpetualId, "fRho23", ONE_64x64)).to.be.revertedWith(
                "invalid fRho23"
            );
        });


        it("should fail if invalid fDFCoverNRate [1]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fDFCoverNRate", 0)).to.be.revertedWith(
                "invalid fDFCoverNRate"
            );
        });

        it("should fail if invalid fDFCoverNRate [2]", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fDFCoverNRate", ONE_64x64.mul(BN.from(100)))).to.be.revertedWith(
                "invalid fDFCoverNRate"
            );
        });

        it("should fail if invalid fAMMTargetDD [1]", async () => {
            let v1 = floatToABK64x64(-6);
            let v2 = floatToABK64x64(0);
            await expect(manager.setPerpetualParamPair(perpetualId, "fAMMTargetDD", v1, v2)).to.be.revertedWith(
                "invalid fAMMTargetDD"
            );
        });

        it("should fail if invalid fAMMTargetDD [2]", async () => {
            let v1 = floatToABK64x64(0);
            let v2 = floatToABK64x64(1);
            await expect(manager.setPerpetualParamPair(perpetualId, "fAMMTargetDD", v1, v2)).to.be.revertedWith(
                "invalid fAMMTargetDD"
            );
        });

        it("should fail if invalid fStressReturnS2[0] [1]", async () => {
            await expect(manager.setPerpetualParamPair(perpetualId, "fStressReturnS2", 0, ONE_64x64.div(BN.from(2)))).to.be.revertedWith(
                "invalid fStressReturnS2[0]"
            );
        });

        it("should fail if invalid fStressReturnS2[0] [2]", async () => {
            await expect(manager.setPerpetualParamPair(perpetualId, "fStressReturnS2", ONE_64x64.mul(BN.from(10)), ONE_64x64.div(BN.from(2)))).to.be.revertedWith(
                "invalid fStressReturnS2[0]"
            );
        });

        it("should fail if invalid fStressReturnS2[1] [1]", async () => {
            let perpetual = await manager.getPerpetual(perpetualId);
            await expect(manager.setPerpetualParamPair(perpetualId, "fStressReturnS2", perpetual.fStressReturnS2[0], ONE_64x64.div(BN.from(-8)))).to.be.revertedWith(
                "invalid fStressReturnS2[1]"
            );
        });

        it("should fail if invalid fStressReturnS2[1] [2]", async () => {
            let perpetual = await manager.getPerpetual(perpetualId);
            await expect(manager.setPerpetualParamPair(perpetualId, "fStressReturnS2", perpetual.fStressReturnS2[0], ONE_64x64)).to.be.revertedWith(
                "invalid fStressReturnS2[1]"
            );
        });

        it("should fail if invalid fStressReturnS3[0] [1]", async () => {
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualParamPair(perpetualId, "fStressReturnS3", 0, 0)).to.be.revertedWith(
                "invalid fStressReturnS3[0]"
            );
        });

        it("should fail if invalid fStressReturnS3[0] [2]", async () => {
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualParamPair(perpetualId, "fStressReturnS3", ONE_64x64.mul(BN.from(10)), 0)).to.be.revertedWith(
                "invalid fStressReturnS3[0]"
            );
        });

        it("should fail if invalid fStressReturnS3[1] [1]", async () => {
            let perpetual = await manager.getPerpetual(perpetualId);
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            let ret = floatToABK64x64(-2);
            await expect(manager.setPerpetualParamPair(perpetualId, "fStressReturnS3", perpetual.fStressReturnS3[0], ret)).to.be.revertedWith(
                "invalid fStressReturnS3[1]"
            );
        });

        it("should fail if invalid fStressReturnS3[1] [2]", async () => {
            let perpetual = await manager.getPerpetual(perpetualId);
            await manager.setCollateralCurrency(perpetualId, COLLATERAL_CURRENCY_QUANTO);
            await expect(manager.setPerpetualParamPair(perpetualId, "fStressReturnS3", perpetual.fStressReturnS3[0], ONE_64x64)).to.be.revertedWith(
                "invalid fStressReturnS3[1]"
            );
        });

        it("should fail if invalid fDFLambda[0] [1]", async () => {
            await expect(manager.setPerpetualParamPair(perpetualId, "fDFLambda", 0, 0)).to.be.revertedWith(
                "invalid fDFLambda[0]"
            );
        });

        it("should fail if invalid fDFLambda[0] [2]", async () => {
            await expect(manager.setPerpetualParamPair(perpetualId, "fDFLambda", ONE_64x64, 0)).to.be.revertedWith(
                "invalid fDFLambda[0]"
            );
        });

        it("should fail if invalid fDFLambda[1] [1]", async () => {
            let perpetual = await manager.getPerpetual(perpetualId);
            await expect(manager.setPerpetualParamPair(perpetualId, "fDFLambda", perpetual.fDFLambda[0], 0)).to.be.revertedWith(
                "invalid fDFLambda[1]"
            );
        });

        it("should fail if invalid fDFLambda[1] [2]", async () => {
            let perpetual = await manager.getPerpetual(perpetualId);
            await expect(manager.setPerpetualParamPair(perpetualId, "fDFLambda", perpetual.fDFLambda[0], ONE_64x64)).to.be.revertedWith(
                "invalid fDFLambda[1]"
            );
        });

        it("should fail if fMaxTotalTraderFunds is zero", async () => {
            await expect(manager.setPerpetualParam(perpetualId, "fMaxTotalTraderFunds", 0)).to.be.revertedWith(
                "fMaxTotalTraderFunds cannot be zero"
            );
        });

    });

    describe("setTreasury", () => {

        let poolId;
        let marginToken;

        before(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
        });

        it("should fail if not an owner", async () => {
            await expect(manager.connect(accounts[1]).setTreasury(poolId, manager.address)).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should fail if pool not found", async () => {
            await expect(manager.setTreasury(BN.from(999), manager.address)).to.be.revertedWith("pool index out of range");
        });

        it("should fail if zero address", async () => {
            await expect(manager.setTreasury(poolId, ZERO_ADDRESS)).to.be.revertedWith("invalid treasuryAddress");
        });

        it("should fail if zero address", async () => {
            await expect(manager.setTreasury(poolId, manager.address)).to.be.revertedWith("invalid treasuryAddress");
        });

        it("should set treasury address", async () => {
            let oldPool = await manager.getLiquidityPool(poolId);
            let newTreasury = accounts[1].address;
            let tx = await manager.setTreasury(poolId, newTreasury);

            let pool = await manager.getLiquidityPool(poolId);
            expect(pool.treasuryAddress).equal(newTreasury);

            await expect(tx)
                .to.emit(manager, "TransferTreasuryTo")
                .withArgs(
                    pool.id,
                    oldPool.treasuryAddress,
                    pool.treasuryAddress
                );
        });

    });

    describe("setAMMPerpLogic", () => {

        let poolId;
        let marginToken;

        before(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
        });

        it("should fail if not an owner", async () => {
            await expect(manager.connect(accounts[1]).setAMMPerpLogic(owner)).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should fail if zero address", async () => {
            await expect(manager.setAMMPerpLogic(ZERO_ADDRESS)).to.be.revertedWith("invalid address");
        });

        it("should set treasury address", async () => {
            let oldAMMPerpLogic = await manager.getAMMPerpLogic();
            await manager.setAMMPerpLogic(owner);

            let AMMPerpLogic = await manager.getAMMPerpLogic();
            expect(AMMPerpLogic).equal(owner);

            await manager.setAMMPerpLogic(oldAMMPerpLogic);
        });

    });

    describe("setTargetPoolSizeUpdateTime", () => {

        let poolId;
        let marginToken;

        before(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
        });

        it("should fail if not an owner", async () => {
            await expect(manager.connect(accounts[1]).setTargetPoolSizeUpdateTime(poolId, 86400)).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should fail if pool not found", async () => {
            await expect(manager.setTargetPoolSizeUpdateTime(BN.from(999), 86400)).to.be.revertedWith("pool index out of range");
        });

        it("should fail if invalid value", async () => {
            await expect(manager.setTargetPoolSizeUpdateTime(poolId, 1)).to.be.revertedWith("invalid iTargetPoolSizeUpdateTime");
        });

        it("should set treasury address", async () => {
            let newValue = 86400;
            let tx = await manager.setTargetPoolSizeUpdateTime(poolId, newValue);

            let pool = await manager.getLiquidityPool(poolId);
            expect(pool.iTargetPoolSizeUpdateTime).equal(newValue);

            await expect(tx)
                .to.emit(manager, "SetTargetPoolSizeUpdateTime")
                .withArgs(
                    pool.id,
                    newValue
                );
        });

    });

    describe("setWithdrawalLimit", () => {

        let poolId;
        let marginToken;

        before(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
        });

        it("should fail if not an owner", async () => {
            await expect(
                manager.connect(accounts[1]).setWithdrawalLimit(poolId, 28800, ONE_64x64.div(BN.from(9)), ONE_64x64)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should fail if _iPnLparticipantWithdrawalPeriod <= 0", async () => {
            await expect(manager.setWithdrawalLimit(poolId, 0, ONE_64x64, ONE_64x64)).to.be.revertedWith(
                "invalid iPnLparticipantWithdrawalPeriod"
            );
        });

        it("should fail if _iPnLparticipantWithdrawalPeriod > 1 week", async () => {
            await expect(manager.setWithdrawalLimit(poolId, 86400 * 7 + 1, ONE_64x64, ONE_64x64)).to.be.revertedWith(
                "invalid iPnLparticipantWithdrawalPeriod"
            );
        });

        it("should fail if _fPnLparticipantWithdrawalPercentageLimit <= 0", async () => {
            await expect(manager.setWithdrawalLimit(poolId, 86400, 0, ONE_64x64)).to.be.revertedWith(
                "invalid fPnLparticipantWithdrawalPercentageLimit"
            );
        });

        it("should fail if _fPnLparticipantWithdrawalPercentageLimit >= ONE_64x64", async () => {
            await expect(manager.setWithdrawalLimit(poolId, 86400, ONE_64x64, ONE_64x64)).to.be.revertedWith(
                "invalid fPnLparticipantWithdrawalPercentageLimit"
            );
        });

        it("should fail if _fPnLparticipantWithdrawalMinAmountLimit <= 0", async () => {
            await expect(manager.setWithdrawalLimit(poolId, 86400, ONE_64x64.div(BN.from(9)), 0)).to.be.revertedWith(
                "invalid fPnLparticipantWithdrawalMinAmountLimit"
            );
        });

        it("should set treasury address", async () => {
            let iPnLparticipantWithdrawalPeriod = 28800;
            let fPnLparticipantWithdrawalPercentageLimit = ONE_64x64.div(BN.from(9));
            let fPnLparticipantWithdrawalMinAmountLimit = ONE_64x64;

            let tx = await manager.setWithdrawalLimit(poolId, iPnLparticipantWithdrawalPeriod, fPnLparticipantWithdrawalPercentageLimit, fPnLparticipantWithdrawalMinAmountLimit);

            let pool = await manager.getLiquidityPool(poolId);
            expect(pool.iPnLparticipantWithdrawalPeriod).equal(iPnLparticipantWithdrawalPeriod);
            expect(pool.fPnLparticipantWithdrawalPercentageLimit).equal(fPnLparticipantWithdrawalPercentageLimit);
            expect(pool.fPnLparticipantWithdrawalMinAmountLimit).equal(fPnLparticipantWithdrawalMinAmountLimit);

            await expect(tx)
                .to.emit(manager, "SetWithdrawalLimit")
                .withArgs(
                    pool.id,
                    iPnLparticipantWithdrawalPeriod,
                    fPnLparticipantWithdrawalPercentageLimit,
                    fPnLparticipantWithdrawalMinAmountLimit
                );
        });

    });

    describe("depositToDefaultFund", () => {
        let poolId;
        let perpetualId;
        let marginToken;

        before(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
            perpetualId = await createPerpetual(manager, poolId);
        });

        it("should fail if pool not found", async () => {
            await expect(manager.depositToDefaultFund(BN.from(999), ONE_64x64)).to.be.revertedWith("pool index out of range");
        });

        it("should fail if amount = 0", async () => {
            await manager.runLiquidityPool(poolId);
            await expect(manager.depositToDefaultFund(poolId, 0)).to.be.revertedWith("invalid amount");
        });

        it("should deposit to the default fund", async () => {
            await marginToken.approve(manager.address, ONE_64x64.mul(1000));

            let traderBalanceBefore = await marginToken.balanceOf(owner);
            let vaultBalanceBefore = await marginToken.balanceOf(manager.address);
            let poolBefore = await manager.getLiquidityPool(poolId);

            let amount = 100;
            let depositedAmountDec18 = ONE_DEC18.mul(amount);
            let depositedAmount64x64 = ONE_64x64.mul(amount);
            await manager.depositToDefaultFund(poolId, depositedAmount64x64);

            let traderBalanceAfter = await marginToken.balanceOf(owner);
            let vaultBalanceAfter = await marginToken.balanceOf(manager.address);
            let poolAfter = await manager.getLiquidityPool(poolId);
            expect(traderBalanceBefore.sub(traderBalanceAfter)).equal(depositedAmountDec18);
            expect(vaultBalanceAfter.sub(vaultBalanceBefore)).equal(depositedAmountDec18);
            expect(poolAfter.fDefaultFundCashCC.sub(poolBefore.fDefaultFundCashCC)).equal(depositedAmount64x64);
        });
    });

    describe("withdrawFromDefaultFund", () => {
        let poolId;
        let perpetualId;
        let marginToken;

        before(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
            perpetualId = await createPerpetual(manager, poolId);
        });

        it("should fail if pool not found", async () => {
            await expect(manager.withdrawFromDefaultFund(BN.from(999), owner, ONE_64x64)).to.be.revertedWith("pool index out of range");
        });

        it("should fail if amount = 0", async () => {
            await expect(manager.withdrawFromDefaultFund(poolId, owner, 0)).to.be.revertedWith("invalid amount");
        });

        it("should fail if amount isn't available", async () => {
            await expect(manager.withdrawFromDefaultFund(poolId, owner, ONE_64x64)).to.be.revertedWith("amount isn't available");
        });


        it("should withdraw from the default fund", async () => {
            await marginToken.approve(manager.address, ONE_64x64.mul(1000));

            let amount = 100;
            let depositedAmount = ONE_DEC18.mul(amount);
            let depositedAmount64x64 = ONE_64x64.mul(amount);
            await manager.depositToDefaultFund(poolId, depositedAmount64x64);

            let traderBalanceBefore = await marginToken.balanceOf(owner);
            let vaultBalanceBefore = await marginToken.balanceOf(manager.address);
            let poolBefore = await manager.getLiquidityPool(poolId);

            await manager.withdrawFromDefaultFund(poolId, owner, depositedAmount64x64);

            let traderBalanceAfter = await marginToken.balanceOf(owner);
            let vaultBalanceAfter = await marginToken.balanceOf(manager.address);
            let poolAfter = await manager.getLiquidityPool(poolId);
            expect(traderBalanceAfter.sub(traderBalanceBefore)).equal(depositedAmount);
            expect(vaultBalanceBefore.sub(vaultBalanceAfter)).equal(depositedAmount);
            expect(poolBefore.fDefaultFundCashCC.sub(poolAfter.fDefaultFundCashCC)).equal(depositedAmount64x64);
        });
    });
    
    describe("deposit", () => {
        let poolId;
        let perpetualId;
        let marginToken;
        let oracles;
        before(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;

            let S2Oracle = 50000;
            let prices : BigNumber[] = [];
            for(var k = 0; k<20; k++) {
                prices.push(floatToABK64x64(S2Oracle));
            }
            const BTC = toBytes32("BTC");
            const USD = toBytes32("USD");
            const ETH = toBytes32("ETH");
            let oracleBTCUSD = await createContract("MockPriceScenarioOracle", [BTC, USD, prices]);
            oracles = [oracleBTCUSD.address, await createOracle(ETH, USD)];
            
        });

        beforeEach(async () => {
            perpetualId = await createPerpetual(manager, poolId, null, null, null, COLLATERAL_CURRENCY_BASE, oracles);
        });

        it("should fail if not whitelisted", async () => {
            await manager.setWhitelistActive(true);
            await expect(manager.deposit(perpetualId, ONE_64x64)).to.be.revertedWith("account should be whitelisted");
            await manager.setWhitelistActive(false);
        });

        it("should fail if perpetual not found", async () => {
            await expect(manager.deposit(toBytes32("Dummy"), ONE_64x64)).to.be.revertedWith("perpetual not found");
        });

        it("should fail if perpetual state isn't NORMAL", async () => {
            await expect(manager.deposit(perpetualId, ONE_64x64)).to.be.revertedWith("perpetual should be in NORMAL state");
        });

        it("should fail if amount = 0", async () => {
            await manager.runLiquidityPool(poolId);
            await expect(manager.deposit(perpetualId, 0)).to.be.revertedWith("invalid amount");
        });

        it("should deposit to the perpetual", async () => {
            await marginToken.approve(manager.address, ONE_64x64.mul(1000));

            let traderBalanceBefore = await marginToken.balanceOf(owner);
            let vaultBalanceBefore = await marginToken.balanceOf(manager.address);
            let marginAccountBefore = await manager.getMarginAccount(perpetualId, owner);
            let isActiveAccount = await manager.isActiveAccount(perpetualId, owner);
            expect(isActiveAccount).to.be.false;

            let amount = 100;
            let depositedAmountDec18 = ONE_DEC18.mul(amount);
            let depositedAmount64x64 = ONE_64x64.mul(amount);

            await manager.setWhitelistActive(true);
            await manager.addToWhitelist([owner]);
            let tx = await manager.deposit(perpetualId, depositedAmount64x64);
            await manager.setWhitelistActive(false);
            await manager.removeFromWhitelist([owner]);

            let traderBalanceAfter = await marginToken.balanceOf(owner);
            let vaultBalanceAfter = await marginToken.balanceOf(manager.address);
            let marginAccountAfter = await manager.getMarginAccount(perpetualId, owner);
            expect(traderBalanceBefore.sub(traderBalanceAfter)).equal(depositedAmountDec18);
            expect(vaultBalanceAfter.sub(vaultBalanceBefore)).equal(depositedAmountDec18);
            expect(marginAccountAfter.fCashCC.sub(marginAccountBefore.fCashCC)).equal(depositedAmount64x64);
            isActiveAccount = await manager.isActiveAccount(perpetualId, owner);
            expect(isActiveAccount).to.be.true;
            let receipt = await tx.wait();
            const eventsArr = receipt.events?.filter((x)=>{return x.event=='TokensDeposited'});
            const timeStamp = eventsArr[0].args[eventsArr[0].args.length-1];
            await expect(tx).to.emit(manager, "TokensDeposited").withArgs(perpetualId, owner, depositedAmount64x64);
        });
    });

    describe("withdraw", () => {
        let poolId;
        let perpetualId;
        let marginToken;

        before(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
        });

        beforeEach(async () => {
            perpetualId = await createPerpetual(manager, poolId);
        });

        it("should fail if not whitelisted", async () => {
            await manager.setWhitelistActive(true);
            await expect(manager.withdraw(perpetualId, ONE_64x64)).to.be.revertedWith("account should be whitelisted");
            await manager.setWhitelistActive(false);
        });

        it("should fail if perpetual not found", async () => {
            await expect(manager.withdraw(toBytes32("Dummy"), ONE_64x64)).to.be.revertedWith("pool not found");
        });

        it("should fail if perpetual state isn't NORMAL", async () => {
            await expect(manager.withdraw(perpetualId, ONE_64x64)).to.be.revertedWith("should be in NORMAL/CLEARED state");
        });

        it("should fail if amount = 0", async () => {
            let poolData = await createLiquidityPool(manager, owner);
            let poolId = poolData.id;
            let perpetualId = await createPerpetual(manager, poolId);

            await manager.runLiquidityPool(poolId);
            await expect(manager.withdraw(perpetualId, 0)).to.be.revertedWith("invalid amount");
        });

        it("should fail if market is closed", async () => {
            let poolData = await createLiquidityPool(manager, owner);
            let poolId = poolData.id;
            let marginToken = poolData.marginToken;
            let perpetualId = await createPerpetual(manager, poolId);

            let perpetual = await manager.getPerpetual(perpetualId);
            let oracle = await ethers.getContractAt("ISpotOracle", perpetual.oracleS2Addr);
            oracle.setMarketClosed(true);

            await manager.runLiquidityPool(poolId);
            await marginToken.approve(manager.address, ONE_DEC18);
            await manager.deposit(perpetualId, ONE_64x64);

            await manager.setTraderPosition(perpetualId, owner, ONE_64x64.mul(10));
            await expect(manager.withdraw(perpetualId, ONE_64x64)).to.be.revertedWith("market is closed");
        });

        it("should shrink amount if amount isn't available", async () => {
            let poolData = await createLiquidityPool(manager, owner);
            let poolId = poolData.id;
            let marginToken = poolData.marginToken;
            let perpetualId = await createPerpetual(manager, poolId);

            await manager.runLiquidityPool(poolId);
            await marginToken.approve(manager.address, ONE_DEC18);
            await manager.deposit(perpetualId, ONE_64x64);
            let isActiveAccount = await manager.isActiveAccount(perpetualId, owner);
            expect(isActiveAccount).to.be.true;

            // try removing more than we have
            await manager.withdraw(perpetualId, ONE_64x64.mul(2));
            let acc = await manager.getMarginAccount(perpetualId, owner);
            // cash should be 0 now
            expect(acc.fCashCC.toString()).to.be.equal("0");
            // should no longer be an active account
            isActiveAccount = await manager.isActiveAccount(perpetualId, owner);
            expect(isActiveAccount).to.be.false;
        });

        it("should withdraw from the perpetual", async () => {
            await manager.runLiquidityPool(poolId);

            await marginToken.approve(manager.address, ONE_64x64.mul(1000));

            let amount = 100;
            let depositedAmount = ONE_DEC18.mul(amount);
            let depositedAmount64x64 = ONE_64x64.mul(amount);
            await manager.deposit(perpetualId, depositedAmount64x64);

            let traderBalanceBefore = await marginToken.balanceOf(owner);
            let vaultBalanceBefore = await marginToken.balanceOf(manager.address);
            let marginAccountBefore = await manager.getMarginAccount(perpetualId, owner);
            let isActiveAccount = await manager.isActiveAccount(perpetualId, owner);
            expect(isActiveAccount).to.be.true;

            await manager.setWhitelistActive(true);
            await manager.addToWhitelist([owner]);
            let tx = await manager.withdraw(perpetualId, depositedAmount64x64);
            await manager.setWhitelistActive(false);
            await manager.removeFromWhitelist([owner]);

            let traderBalanceAfter = await marginToken.balanceOf(owner);
            let vaultBalanceAfter = await marginToken.balanceOf(manager.address);
            let marginAccountAfter = await manager.getMarginAccount(perpetualId, owner);
            expect(traderBalanceAfter.sub(traderBalanceBefore)).equal(depositedAmount);
            expect(vaultBalanceBefore.sub(vaultBalanceAfter)).equal(depositedAmount);
            expect(marginAccountBefore.fCashCC.sub(marginAccountAfter.fCashCC)).equal(depositedAmount64x64);
            isActiveAccount = await manager.isActiveAccount(perpetualId, owner);
            expect(isActiveAccount).to.be.false;
            let receipt = await tx.wait();
            const eventsArr = receipt.events?.filter((x)=>{return x.event=='TokensWithdrawn'});
            const timeStamp = eventsArr[0].args[eventsArr[0].args.length-1];
            await expect(tx).to.emit(manager, "TokensWithdrawn").withArgs(perpetualId, owner, depositedAmount64x64);
        });
    });

    describe("withdrawAll", () => {
        let poolId;
        let perpetualId;
        let marginToken;

        before(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
        });

        beforeEach(async () => {
            perpetualId = await createPerpetual(manager, poolId);
        });

        it("should fail if not whitelisted", async () => {
            await manager.setWhitelistActive(true);
            await expect(manager.withdrawAll(perpetualId)).to.be.revertedWith("account should be whitelisted");
            await manager.setWhitelistActive(false);
        });

        it("should fail if perpetual not found", async () => {

            await expect(manager.withdrawAll(toBytes32("Dummy"))).to.be.revertedWith("pool not found");
        });

        it("should fail if perpetual state isn't NORMAL", async () => {
            await expect(manager.withdrawAll(perpetualId)).to.be.revertedWith("should be in NORMAL/CLEARED state");
        });

        it("should fail if amount = 0", async () => {
            let poolData = await createLiquidityPool(manager, owner);
            let poolId = poolData.id;
            let perpetualId = await createPerpetual(manager, poolId);

            await manager.runLiquidityPool(poolId);
            await expect(manager.withdrawAll(perpetualId)).to.be.revertedWith("invalid amount");
        });

        it("should fail if position != zero", async () => {
            let poolData = await createLiquidityPool(manager, owner);
            let poolId = poolData.id;
            let perpetualId = await createPerpetual(manager, poolId);

            await manager.runLiquidityPool(poolId);
            await manager.setTraderPosition(perpetualId, owner, 1);
            await expect(manager.withdrawAll(perpetualId)).to.be.revertedWith("position should be zero");
        });

        it("should withdraw all cash from the perpetual", async () => {
            await manager.runLiquidityPool(poolId);

            await marginToken.approve(manager.address, ONE_64x64.mul(1000));

            let amount = 100;
            let depositedAmount = ONE_DEC18.mul(amount);
            let depositedAmount64x64 = ONE_64x64.mul(amount);
            await manager.deposit(perpetualId, depositedAmount64x64);

            let traderBalanceBefore = await marginToken.balanceOf(owner);
            let vaultBalanceBefore = await marginToken.balanceOf(manager.address);
            let marginAccountBefore = await manager.getMarginAccount(perpetualId, owner);
            let isActiveAccount = await manager.isActiveAccount(perpetualId, owner);
            expect(isActiveAccount).to.be.true;

            await manager.setWhitelistActive(true);
            await manager.addToWhitelist([owner]);
            let tx = await manager.withdrawAll(perpetualId);
            await manager.setWhitelistActive(false);
            await manager.removeFromWhitelist([owner]);

            let traderBalanceAfter = await marginToken.balanceOf(owner);
            let vaultBalanceAfter = await marginToken.balanceOf(manager.address);
            let marginAccountAfter = await manager.getMarginAccount(perpetualId, owner);
            expect(traderBalanceAfter.sub(traderBalanceBefore)).equal(depositedAmount);
            expect(vaultBalanceBefore.sub(vaultBalanceAfter)).equal(depositedAmount);
            expect(marginAccountBefore.fCashCC.sub(marginAccountAfter.fCashCC)).equal(depositedAmount64x64);
            isActiveAccount = await manager.isActiveAccount(perpetualId, owner);
            expect(isActiveAccount).to.be.false;
            let receipt = await tx.wait();
            const eventsArr = receipt.events?.filter((x)=>{return x.event=='TokensWithdrawn'});
            const timeStamp = eventsArr[0].args[eventsArr[0].args.length-1];
            await expect(tx).to.emit(manager, "TokensWithdrawn").withArgs(perpetualId, owner, depositedAmount64x64);
        });
    });

    describe("addLiquidity", () => {
        let poolId;
        let perpetualId;
        let marginToken;

        before(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
        });

        beforeEach(async () => {
            perpetualId = await createPerpetual(manager, poolId);
        });

        it("should fail if pool index out of range", async () => {
            await expect(manager.addLiquidity(999, ONE_64x64)).to.be.revertedWith("no perp in pool");
        });

        it("should fail if amount = 0", async () => {
            await expect(manager.addLiquidity(poolId, 0)).to.be.revertedWith("invalid amount");
        });

        it("should fail if pool is not running", async () => {
            await expect(manager.addLiquidity(poolId, ONE_64x64)).to.be.revertedWith("pool not running");
        });

        it("should fail if no active perpetual", async () => {
            let poolData = await createLiquidityPool(manager, owner);
            let poolId = poolData.id;
            let perpetualId = await createPerpetual(manager, poolId);
            await manager.runLiquidityPool(poolId);
            await manager.setPerpetualState(perpetualId, PERPETUAL_STATE_INITIALIZING);

            await expect(manager.addLiquidity(poolId, ONE_64x64)).to.be.revertedWith("no active perpetual");
        });

        it("should be able to add liquidity", async () => {
            await manager.runLiquidityPool(poolId);
            await marginToken.approve(manager.address, ONE_64x64.mul(1000));

            let pool = await manager.getLiquidityPool(poolId);
            let traderBalanceBefore = await marginToken.balanceOf(owner);
            let vaultBalanceBefore = await marginToken.balanceOf(manager.address);
            let shareToken = await ethers.getContractAt("IERC20", pool.shareTokenAddress);
            let shareBalanceBefore = await shareToken.balanceOf(owner);
            let PnLparticipantsCashBefore = pool.fPnLparticipantsCashCC;

            let amount = 100;
            let amountDec18 = ONE_DEC18.mul(amount);
            let amount64x64 = ONE_64x64.mul(amount);
            let tx = await manager.addLiquidity(poolId, amount64x64);

            let traderBalanceAfter = await marginToken.balanceOf(owner);
            let vaultBalanceAfter = await marginToken.balanceOf(manager.address);
            let shareBalanceAfter = await shareToken.balanceOf(owner);
            pool = await manager.getLiquidityPool(poolId);
            let PnLparticipantsCashAfter = pool.fPnLparticipantsCashCC;

            expect(traderBalanceBefore.sub(traderBalanceAfter)).equal(amountDec18);
            expect(vaultBalanceAfter.sub(vaultBalanceBefore)).equal(amountDec18);
            expect(shareBalanceAfter.sub(shareBalanceBefore)).equal(amountDec18);
            expect(PnLparticipantsCashAfter.sub(PnLparticipantsCashBefore)).equal(amount64x64);

            await expect(tx).to.emit(manager, "LiquidityAdded").withArgs(poolId, owner, amountDec18, amountDec18);
        });
    });

    describe("removeLiquidity", () => {
        let poolId;
        let perpetualId;
        let marginToken;
        let amount;
        let amountDec18;
        let amount64x64;

        before(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;

            perpetualId = await createPerpetual(manager, poolId);
            await manager.runLiquidityPool(poolId);

            await marginToken.approve(manager.address, ONE_64x64.mul(100000));
            amount = 100;
            amountDec18 = ONE_DEC18.mul(amount);
            amount64x64 = ONE_64x64.mul(amount);
            await manager.addLiquidity(poolId, amount64x64);
        });

        beforeEach(async () => {});

        it("should fail if pool index out of range", async () => {
            await expect(manager.removeLiquidity(999, ONE_64x64)).to.be.revertedWith("no perp in pool");
        });

        it("should fail if amount = 0", async () => {
            await expect(manager.removeLiquidity(poolId, 0)).to.be.revertedWith("invalid amount");
        });

        it("should fail if pool is not running", async () => {
            let poolData = await createLiquidityPool(manager, owner);
            let poolId = poolData.id;

            await expect(manager.removeLiquidity(poolId, ONE_64x64)).to.be.revertedWith("no perp in pool");
        });

        it("should fail if no active perpetual", async () => {
            let poolData = await createLiquidityPool(manager, owner);
            let poolId = poolData.id;
            let perpetualId = await createPerpetual(manager, poolId);
            await manager.runLiquidityPool(poolId);
            await manager.setPerpetualState(perpetualId, PERPETUAL_STATE_INITIALIZING);

            await expect(manager.removeLiquidity(poolId, ONE_64x64)).to.be.revertedWith("no active perpetual");
        });

        it("should fail if withdraw limit exceeded", async () => {
            await expect(manager.removeLiquidity(poolId, amount64x64)).to.be.revertedWith("withdraw limit exceeded");
        });

        it("should fail if withdraw limit exceeded (second withdraw)", async () => {
            await manager.addLiquidity(poolId, amount64x64);
            await manager.removeLiquidity(poolId, amount64x64.div(10));

            await expect(manager.removeLiquidity(poolId, amount64x64)).to.be.revertedWith("withdraw limit exceeded");
        });

        it("should be able to remove liquidity", async () => {
            await manager.addLiquidity(poolId, amount64x64.mul(1000));

            let pool = await manager.getLiquidityPool(poolId);
            let traderBalanceBefore = await marginToken.balanceOf(owner);
            let vaultBalanceBefore = await marginToken.balanceOf(manager.address);
            let shareToken = await ethers.getContractAt("IERC20", pool.shareTokenAddress);
            let shareBalanceBefore = await shareToken.balanceOf(owner);
            let PnLparticipantsCashBefore = pool.fPnLparticipantsCashCC;

            let tx = await manager.removeLiquidity(poolId, amount64x64);

            let traderBalanceAfter = await marginToken.balanceOf(owner);
            let vaultBalanceAfter = await marginToken.balanceOf(manager.address);
            let shareBalanceAfter = await shareToken.balanceOf(owner);
            pool = await manager.getLiquidityPool(poolId);
            let PnLparticipantsCashAfter = pool.fPnLparticipantsCashCC;

            expect(traderBalanceAfter.sub(traderBalanceBefore)).equal(amountDec18);
            expect(vaultBalanceBefore.sub(vaultBalanceAfter)).equal(amountDec18);
            expect(shareBalanceBefore.sub(shareBalanceAfter)).equal(amountDec18);
            expect(PnLparticipantsCashBefore.sub(PnLparticipantsCashAfter)).equal(amount64x64);

            let checkpoints = await manager.getCheckpoints(poolId, owner);
            expect(checkpoints.length).equal(2);
            expect(checkpoints[1].amount).equal(amount64x64);
            const block = await ethers.provider.getBlock(tx.blockNumber);
            expect(checkpoints[1].timestamp).equal(block.timestamp);

            await expect(tx).to.emit(manager, "LiquidityRemoved").withArgs(poolId, owner, amountDec18, amountDec18);
        });

        it("should not fail if not enough share balance", async () => {
            // add liquidity for other account to prevent 'withdrawal limit exceeded'
            let trader = accounts[1];
            await marginToken.connect(trader).approve(manager.address, ONE_64x64.mul(100000));
            amount = 2000;
            await manager.addLiquidity(poolId, ONE_64x64.mul(amount));
            // try removing more than we added
            await manager.removeLiquidity(poolId, amount64x64.add(ONE_64x64));
        });
    });

    describe("_getShareAmountToMint", () => {
        let poolId;
        let perpetualId;
        let marginToken;

        before(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
            perpetualId = await createPerpetual(manager, poolId);
        });

        it("_getShareAmountToMint = ONE_64x64", async () => {
            let shareAmount = await manager.getShareAmountToMint(poolId, ONE_64x64);
            expect(shareAmount).equal(ONE_64x64);
        });

        it("_getShareAmountToMint = ONE_64x64 * 2", async () => {
            await manager.runLiquidityPool(poolId);
            await marginToken.approve(manager.address, ONE_64x64.mul(1000));
            await manager.addLiquidity(poolId, ONE_64x64);

            await manager.setPnLparticipantsCashCC(poolId, ONE_64x64.div(2));

            let shareAmount = await manager.getShareAmountToMint(poolId, ONE_64x64);
            expect(shareAmount).equal(ONE_64x64.mul(2));
        });
    });

    describe("_getTokenAmountToReturn", () => {
        let poolId;
        let perpetualId;
        let marginToken;

        beforeEach(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;
            perpetualId = await createPerpetual(manager, poolId);
        });

        it("_getTokenAmountToReturn = 0", async () => {
            let tokenAmount = await manager.getTokenAmountToReturn(poolId, ONE_64x64);
            expect(tokenAmount).equal(0);
        });

        it("_getTokenAmountToReturn = ONE_64x64 * 2", async () => {
            await manager.mintShareTokens(poolId, owner, ONE_DEC18);

            await manager.setPnLparticipantsCashCC(poolId, ONE_64x64.mul(2));

            let tokenAmount = await manager.getTokenAmountToReturn(poolId, ONE_64x64);
            expect(tokenAmount).equal(ONE_64x64.mul(2));
        });
    });

    describe("_getAmountForPeriod", () => {
        let poolId;
        let perpetualId;
        let marginToken;

        before(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;

            perpetualId = await createPerpetual(manager, poolId);
            await marginToken.approve(manager.address, ONE_64x64.mul(1000));
            await manager.runLiquidityPool(poolId);
        });

        it("should return zero amount", async () => {
            let amountForPeriod = await manager.getAmountForPeriod(poolId, owner);
            expect(amountForPeriod).equal(0);
        });

        it("should return withdrawn amount = 1", async () => {
            let amount = 100;
            let amount64x64 = ONE_64x64.mul(amount);
            await manager.addLiquidity(poolId, amount64x64);
            await manager.removeLiquidity(poolId, ONE_64x64);

            let amountForPeriod = await manager.getAmountForPeriod(poolId, owner);
            expect(amountForPeriod).equal(ONE_64x64);
        });

        it("should return withdrawn amount = 3", async () => {
            let amount = 100;
            let amount64x64 = ONE_64x64.mul(amount);
            await manager.addLiquidity(poolId, amount64x64);
            await manager.removeLiquidity(poolId, ONE_64x64.mul(2));

            let amountForPeriod = await manager.getAmountForPeriod(poolId, owner);
            expect(amountForPeriod).equal(ONE_64x64.mul(3));
        });
    });

    describe("_checkWithdrawalRestrictions", () => {
        let poolId;
        let perpetualId;
        let marginToken;

        before(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;

            perpetualId = await createPerpetual(manager, poolId);
            await marginToken.approve(manager.address, ONE_64x64.mul(1000));
            await manager.runLiquidityPool(poolId);

            let amount = 100;
            let amount64x64 = ONE_64x64.mul(amount);
            await manager.addLiquidity(poolId, amount64x64);
        });

        it("shouldn't fail for trying to withdraw 10", async () => {
            await manager.checkWithdrawalRestrictions(poolId, owner, ONE_64x64.mul(10));
        });

        it("shouldn't fail for trying to withdraw 11", async () => {
            await expect(manager.checkWithdrawalRestrictions(poolId, owner, ONE_64x64.mul(11))).to.be.revertedWith("withdraw limit exceeded");
        });
    });

    describe("testing PerpetualTreasury ammGovernanceAddress...", async () => {
        it("owner should add and remove AMM admin address", async () => {
            await manager.addAmmGovernanceAddress(accounts[3].address);
            expect(await manager.isGovernanceAddress(accounts[3].address)).true;
            await manager.removeAmmGovernanceAddress(accounts[3].address);
            expect(await manager.isGovernanceAddress(accounts[3].address)).false;
        });

        it("only owner should add and remove AMM admin address", async () => {
            await expect(manager.connect(accounts[2]).addAmmGovernanceAddress(accounts[4].address)).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(manager.connect(accounts[2]).removeAmmGovernanceAddress(accounts[4].address)).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("enumerates and returns governance addresses", async () => {
            await manager.addAmmGovernanceAddress(accounts[1].address);
            await manager.addAmmGovernanceAddress(accounts[2].address);
            expect(await manager.getGovernanceAddresses()).to.eql([accounts[1].address, accounts[2].address]);
        });
    });

    describe("PerpetualUpdateLogic", () => {
        let poolId;
        let perpetualId;
        let marginToken;

        before(async () => {
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;

            perpetualId = await createPerpetual(manager, poolId);
            await marginToken.approve(manager.address, ONE_64x64.mul(1000));
            await manager.runLiquidityPool(poolId);
        });

        it("should fail if updateAMMTargetFundSize invoked outside", async () => {
            await expect(manager.updateAMMTargetFundSize(perpetualId, floatToABK64x64(1))).to.be.revertedWith("can't be invoked outside");
        });

        it("should fail if updateFundingAndPricesBefore invoked outside", async () => {
            await expect(manager.updateFundingAndPricesBefore(perpetualId,perpetualId)).to.be.revertedWith("can't be invoked outside");
        });

        it("should fail if updateFundingAndPricesAfter invoked outside", async () => {
            await expect(manager.updateFundingAndPricesAfter(perpetualId, perpetualId)).to.be.revertedWith("can't be invoked outside");
        });

    });

    describe("PerpetualRebalanceLogic", () => {
        let poolId;
        let perpetualId;
        let marginToken;

        before(async () => {
            manager = await createPerpetualManager(false, ["PerpetualRebalanceLogic"]);
            let poolData = await createLiquidityPool(manager, owner);
            poolId = poolData.id;
            marginToken = poolData.marginToken;

            perpetualId = await createPerpetual(manager, poolId);
            await marginToken.approve(manager.address, ONE_64x64.mul(1000));
            await manager.runLiquidityPool(poolId);
        });

        it("should fail if rebalance invoked outside", async () => {
            await expect(manager.rebalance(perpetualId)).to.be.revertedWith("can't be invoked outside");
        });

    });

    describe("setTrustedForwarder", () => {
        it("should fail if not proxy owner", async () => {
            await expect(manager.connect(accounts[1]).setTrustedForwarder("0xD4B5f1c12b46445693ae5Ec05880Ffd117277d12")).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it("should set new trusted forwarder", async () => {
            const randomAddress = "0xD4B5f1c12b46445693ae5Ec05880Ffd117277d12";

            await manager.connect(accounts[0]).setTrustedForwarder(randomAddress);
            expect(await manager.trustedForwarder()).equal(randomAddress);
            expect(await manager.isTrustedForwarder(randomAddress)).to.be.true;
        });
    });

    describe("versionRecipient", () => {
        it("should return version", async () => {
            let version = await manager.versionRecipient();
            expect(version).equal("2.2.3+opengsn.bsc.irelayrecipient");
        });
    });

});
