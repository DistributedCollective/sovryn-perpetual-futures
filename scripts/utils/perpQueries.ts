/*
    Functions to query the perpetual manager smart contract to get
    AMM and trader data
*/
import {
    floatToABK64x64,
    ABK64x64ToFloat} from "./perpMath";
import { getDeploymentAddresses } from "./constants";

import {PerpParameters, AMMState, TraderState, LiqPoolState, PerpCurrencySymbols} from "./perpUtils";
import { Contract } from "ethers";
import { ResultSetDependencies } from "mathjs";

export async function queryAMMState(manager, perpId : string) : Promise<AMMState> {
    let responseArray = await manager.getAMMState(perpId);
    let ammState = {L1: ABK64x64ToFloat(responseArray[0]),
                    K2 : ABK64x64ToFloat(responseArray[1]),
                    M1 : ABK64x64ToFloat(responseArray[2]),
                    M2 : ABK64x64ToFloat(responseArray[3]),
                    M3 : ABK64x64ToFloat(responseArray[4]),
                    fCurrentTraderExposureEMA : ABK64x64ToFloat(responseArray[5]),
                    indexS2PriceData : ABK64x64ToFloat(responseArray[6]),
                    indexS3PriceData : ABK64x64ToFloat(responseArray[7]),
                    indexS2PriceDataOracle : ABK64x64ToFloat(responseArray[10]),
                    indexS3PriceDataOracle : ABK64x64ToFloat(responseArray[11]),
                    currentMarkPremiumRate : ABK64x64ToFloat(responseArray[8]),
                    currentPremiumRate : ABK64x64ToFloat(responseArray[9]),
                    defFundToTargetRatio : ABK64x64ToFloat(responseArray[12])};
    return ammState;
}

export async function queryLiqPoolStateFromPerpetualId(manager, perpId : string) :  Promise<LiqPoolState> {
    let id = await manager.getPoolIdByPerpetualId(perpId);
    let pool = await manager.getLiquidityPool(id);
    let liqPoolState = {
            fPnLparticipantsCashCC: ABK64x64ToFloat(pool.fPnLparticipantsCashCC),
            fAMMFundCashCC : ABK64x64ToFloat(pool.fAMMFundCashCC),
            fDefaultFundCashCC : ABK64x64ToFloat(pool.fDefaultFundCashCC),
            fTargetAMMFundSize : ABK64x64ToFloat(pool.fTargetAMMFundSize),
            fTargetDFSize : ABK64x64ToFloat(pool.fTargetDFSize),
            isRunning : pool.isRunning};
    return liqPoolState;
}

// Query perpetual data and parameters
export async function queryPerpParameters(manager, perpId : string) : Promise<PerpParameters> {
    let perpData = await manager.getPerpetual(perpId);
    let perpParams = {
        fInitialMarginRateAlpha : ABK64x64ToFloat(perpData.fInitialMarginRateAlpha),
        fMarginRateBeta : ABK64x64ToFloat(perpData.fMarginRateBeta),
        fInitialMarginRateCap : ABK64x64ToFloat(perpData.fInitialMarginRateCap),
        fMaintenanceMarginRateAlpha : ABK64x64ToFloat(perpData.fMaintenanceMarginRateAlpha),
        fTreasuryFeeRate : ABK64x64ToFloat(perpData.fTreasuryFeeRate),
        fPnLPartRate : ABK64x64ToFloat(perpData.fPnLPartRate),
        fReferralRebateCC : ABK64x64ToFloat(perpData.fReferralRebateCC),
        fLiquidationPenaltyRate : ABK64x64ToFloat(perpData.fLiquidationPenaltyRate),
        fMinimalSpread : ABK64x64ToFloat(perpData.fMinimalSpread),
        fMinimalSpreadInStress : ABK64x64ToFloat(perpData.fMinimalSpreadInStress),
        fLotSizeBC : ABK64x64ToFloat(perpData.fLotSizeBC),
        fFundingRateClamp : ABK64x64ToFloat(perpData.fFundingRateClamp),
        fMarkPriceEMALambda : ABK64x64ToFloat(perpData.fMarkPriceEMALambda),
        fSigma2 : ABK64x64ToFloat(perpData.fSigma2),
        fSigma3 : ABK64x64ToFloat(perpData.fSigma3),
        fRho23 : ABK64x64ToFloat(perpData.fRho23),
        // default fund / AMM fund
        fStressReturnS2_0 : ABK64x64ToFloat(perpData.fStressReturnS2[0]),
        fStressReturnS2_1 : ABK64x64ToFloat(perpData.fStressReturnS2[1]),
        fStressReturnS3_0 : ABK64x64ToFloat(perpData.fStressReturnS3[0]),
        fStressReturnS3_1 : ABK64x64ToFloat(perpData.fStressReturnS3[1]),
        fDFCoverNRate : ABK64x64ToFloat(perpData.fDFCoverNRate),
        fDFLambda_0 : ABK64x64ToFloat(perpData.fDFLambda[0]),
        fDFLambda_1 : ABK64x64ToFloat(perpData.fDFLambda[1]),
        fAMMTargetDD_0 : ABK64x64ToFloat(perpData.fAMMTargetDD[0]),
        fAMMTargetDD_1 : ABK64x64ToFloat(perpData.fAMMTargetDD[1]),
        fAMMMinSizeCC : ABK64x64ToFloat(perpData.fAMMMinSizeCC),
        fMinimalTraderExposureEMA : ABK64x64ToFloat(perpData.fMinimalTraderExposureEMA),
        fMaximalTradeSizeBumpUp : ABK64x64ToFloat(perpData.fMaximalTradeSizeBumpUp),
        fCurrentFundingRate : ABK64x64ToFloat(perpData.fCurrentFundingRate),
        fUnitAccumulatedFunding : ABK64x64ToFloat(perpData.fUnitAccumulatedFunding),
        fOpenInterest : ABK64x64ToFloat(perpData.fOpenInterest),
        poolId : perpData.poolId,
        oracleS2Addr : perpData.oracleS2Addr,
        oracleS3Addr : perpData.oracleS3Addr,
        fMaxPositionBC :  ABK64x64ToFloat(perpData.fMaxPositionBC),
    };
    if (perpParams.fMaxPositionBC === 0.0) {
        // if no max position set, we store infinity so
        // calculations don't need if-then-else
        perpParams.fMaxPositionBC = Infinity;
    }
    return perpParams;
}


export async function queryTraderState(manager, perpId : string, _traderAddr : string) : Promise<TraderState> {
    let traderStateArr = await manager.getTraderState(perpId, _traderAddr);
    let traderState = {
        marginBalanceCC : ABK64x64ToFloat(traderStateArr[0]), // current margin balance
        availableMarginCC : ABK64x64ToFloat(traderStateArr[1]), // amount over initial margin
        availableCashCC : ABK64x64ToFloat(traderStateArr[2]), // cash minus unpaid funding
        marginAccountCashCC : ABK64x64ToFloat(traderStateArr[3]), // from margin account
        marginAccountPositionBC : ABK64x64ToFloat(traderStateArr[4]), // from margin account
        marginAccountLockedInValueQC : ABK64x64ToFloat(traderStateArr[5]), // from margin account
        fUnitAccumulatedFundingStart : ABK64x64ToFloat(traderStateArr[6]) // from margin account
    };
    return traderState;
}

export async function getPerpSymbols(manager, perpId: string): Promise<PerpCurrencySymbols>{
    const perpParams = await queryPerpParameters(manager, perpId);
    const poolData = await manager.getLiquidityPool(perpParams.poolId);
    const addresses = getDeploymentAddresses();
    
    // return the address as a fallback, in case the addresses are not yet updated in scripts/utils/constants.ts
    return {
        tradedPair: addresses[perpParams.oracleS2Addr.toLowerCase()] || perpParams.oracleS2Addr,
        collateralCurrency: addresses[poolData.marginTokenAddress.toLowerCase()] || poolData.marginTokenAddress,
    }
    
}

export async function getTraderOrders(limitOrder, traderAddress: string) {
    let res = Array();
    let digests = await getTraderDigests(limitOrder, traderAddress);
    for (const digest of digests) {
        let order = await limitOrder.orderOfDigest(digest);
        order = {
            iPerpetualId: order.iPerpetualId.toString(),
            traderAddr: order.traderAddr,
            fAmount: ABK64x64ToFloat(order.fAmount),
            fLimitPrice: ABK64x64ToFloat(order.fLimitPrice),
            fTriggerPrice: ABK64x64ToFloat(order.fTriggerPrice),
            iDeadline: (order.iDeadline).toNumber(),
            referrerAddr: order.referrerAddr,
            flags: order.flags as number,
            fLeverage: ABK64x64ToFloat(order.fLeverage), // 0 if deposit and trade order.
            createdTimestamp: (order.createdTimestamp).toNumber(),
            digest: digest,
        };
        res.push(order);
    }
    return res;
}

export async function getTraderDigests(limitOrder, traderAddress: string) {
    let res = Array();
    let e;
    let i = 0;
    while (!e) {
        try {
            let digest = await limitOrder.digestsOfTrader(traderAddress, i);
            res.push(digest);
            ++i;
        } catch (error) {
            e = error;
        }
    }
    return res;
}