// @ts-nocheck
import {
    floatToABK64x64,
    ABK64x64ToFloat,
    toDec18} from "./perpMath";

export async function queryPoolCashFromPerpetual(perpetualManager, perpetualId) {
    // get aggregate AMM fund cash, PnL participant cash and DF cash
    let perpetual = await perpetualManager.getPerpetual(perpetualId);
    let lp = await perpetualManager.getLiquidityPool(perpetual.poolId);
    let poolCashVec = [ABK64x64ToFloat(lp.fAMMFundCashCC),
                       ABK64x64ToFloat(lp.fPnLparticipantsCashCC),
                       ABK64x64ToFloat(lp.fDefaultFundCashCC)];
    return poolCashVec;
}

export async function queryDefaultFundCash(perpetualManager, poolId) {
    let lp = await perpetualManager.getLiquidityPool(poolId);
    return ABK64x64ToFloat(lp.fDefaultFundCashCC);
}

export async function queryMarginCash(perpetualManager, perpetualId) {
    let marginAccount = await perpetualManager.getMarginAccount(perpetualId, perpetualManager.address);
    return ABK64x64ToFloat(marginAccount.fCashCC);
}