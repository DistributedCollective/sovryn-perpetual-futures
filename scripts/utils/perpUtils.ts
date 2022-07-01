/*
    Helper-functions for frontend
*/ 

import console from 'console';
import { trade } from '../deployment/deploymentUtil';
import {
    calcKStar,
    shrinkToLot,
    calcPerpPrice,
    calculateMaintenanceMarginRate,
    calculateLiquidationPriceCollateralQuote,
    calculateLiquidationPriceCollateralQuanto,
    calculateLiquidationPriceCollateralBase,
    getPricesAndTradesForPercentRage,
    getMaxLeveragePosition,
    isTraderMarginSafe,
    cdfNormalStd,
    COLLATERAL_CURRENCY_QUOTE,
    COLLATERAL_CURRENCY_BASE,
    COLLATERAL_CURRENCY_QUANTO,
    getMarginBalanceCC,
    roundToLot} from "./perpMath";
// imports for signature:
import { BytesLike, BigNumberish, Signer} from "ethers";
import { keccak256, defaultAbiCoder, toUtf8Bytes } from 'ethers/lib/utils';

/*---
// Suffix CC/BC/QC:
// CC: collateral currency, BC: base currency, QC: quote currency
// Examples:
// for BTCUSD collateralized in BTC: CC=BTC, BC=BTC, QC=USD
// for ETHUSD collateralized in BTC: CC=BTC, BC=ETH, QC=USD
// for TeslaUSD collateralized in BTC: CC=BTC, BC=Tesla, QC=USD
----*/


export interface PerpParameters {
    //get perpetual
    //base parameters
    fInitialMarginRateAlpha : number;
    fMarginRateBeta : number;
    fInitialMarginRateCap : number;
    fMaintenanceMarginRateAlpha : number;
    fTreasuryFeeRate : number;
    fPnLPartRate : number;
    fReferralRebateCC : number;
    fLiquidationPenaltyRate : number;
    fMinimalSpread : number;
    fMinimalSpreadInStress : number;
    fLotSizeBC : number;
    fFundingRateClamp : number;
    fMarkPriceEMALambda : number;
    fSigma2 : number;
    fSigma3 : number;
    fRho23 : number;
    // default fund / AMM fund
    fStressReturnS2_0 : number;
    fStressReturnS2_1 : number;
    fStressReturnS3_0 : number;
    fStressReturnS3_1 : number;
    fDFCoverNRate : number;
    fDFLambda_0 : number;
    fDFLambda_1 : number;
    fAMMTargetDD_0 : number;
    fAMMTargetDD_1 : number;
    fAMMMinSizeCC : number;
    fMinimalTraderExposureEMA : number;
    fMaximalTradeSizeBumpUp : number;
    // funding state
    fCurrentFundingRate : number;
    fUnitAccumulatedFunding : number;
    
    fOpenInterest : number;

    poolId : number;
    oracleS2Addr : string;
    oracleS3Addr : string;
    // perpetual-wide hard-cap for position size
    fMaxPositionBC : number;
}

export interface PerpCurrencySymbols {
    tradedPair: string, //BTCUSD
    collateralCurrency: string, //USDT
}

export interface AMMState {
    // values from AMM margin account:
    // L1 = -fLockedInValueQC
    // K2 = -fPositionBC
    L1 : number; 
    K2 : number;
    // {M1, M2, M3} = -fLockedInValueQC
    M1 : number;
    M2 : number;
    M3 : number;
    // PerpetualData.fCurrentTraderExposureEMA
    fCurrentTraderExposureEMA : number;
    // Oracle data:
    indexS2PriceData : number; // S2 price used in the current state of the contract
    indexS3PriceData : number; // S3 price used in the current state of the contract
    indexS2PriceDataOracle : number; // most up to date S2 price, can differ from contract price
    indexS3PriceDataOracle : number; // most up to date S4 price, can differ from contract price
    currentMarkPremiumRate : number;
    currentPremiumRate : number;
    defFundToTargetRatio : number; // funding state of default fund. Relevant for minimal bid-ask spread
}

export interface LiqPoolState {
    fPnLparticipantsCashCC : number; // current P&L participants cash
    fAMMFundCashCC : number;      // current sum of AMM funds cash
    fDefaultFundCashCC : number;  // current default fund size
    fTargetAMMFundSize : number;  //target AMM pool size for all perpetuals in pool (sum)
    fTargetDFSize : number;       //target default fund size for all perpetuals in pool
    isRunning : boolean;
}

export interface TraderState {
    marginBalanceCC : number; // current margin balance
    availableMarginCC : number; // amount above initial margin (can be negative if below)
    availableCashCC : number; // cash minus unpaid funding
    marginAccountCashCC : number; // from margin account
    marginAccountPositionBC : number; // from margin account
    marginAccountLockedInValueQC : number; // from margin account
    fUnitAccumulatedFundingStart : number; // from margin account
}


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

/**
 * Extract the mark-price from AMMState-data
 * Use most up to date price data, which can differ from stored value in contract 
 * @param {AMMState} ammData - Should contain current state of perpetual
 * @returns {number} mark price
 */ 
export function getMarkPrice(ammData: AMMState) : number {
    return ammData.indexS2PriceDataOracle * (1 + ammData.currentMarkPremiumRate);
}

/**
 * Extract the index-price from AMMState-data
 * Use most up to date price data, which can differ from stored value in contract 
 * @param {AMMState} ammData - Should contain current state of perpetual
 * @returns {number} index price
 */ 
export function getIndexPrice(ammData: AMMState) : number {
    return ammData.indexS2PriceDataOracle;
}

/**
 * Extract the quanto-price from AMMState-data. 
 * E.g., if ETHUSD backed in BTC, the BTCUSD price is the quanto-price
 * Use most up to date price data, which can differ from stored value in contract 
 * @param {AMMState} ammData - Should contain current state of perpetual
 * @returns {number} quanto price (non-zero if 3rd currency involved)
 */ 
export function getQuantoPrice(ammData: AMMState) : number {
    return ammData.indexS3PriceDataOracle;
}

/**
 * Get the trading fee rate, so that fee = abs(position)*rate
 * @param {PerpParameters} perpParams - Contains parameter of the perpetual
 * @returns {number} fee relative to position size
 */ 
export function getTradingFeeRate(perpParams : PerpParameters): number {
    return perpParams.fTreasuryFeeRate+perpParams.fPnLPartRate;
}

/**
 * Get trading fee in collateral currency
 * @param {deltaPosition} number - Traded amount
 * @param {PerpParameters} perpParams - Contains parameter of the perpetual
 * @returns {number} fee relative to position size
 */ 
export function getTradingFee(deltaPosition : number, perpParams : PerpParameters, ammData : AMMState): number {
    let feeBC = Math.abs(deltaPosition) * getTradingFeeRate(perpParams);
    let fx = getBase2CollateralFX(ammData, false);
    return feeBC * fx;
}

/**
 * Get initial margin rate
 * @param {number} position - The position for which we calculate the initial margin rate
 * @param {PerpParameters} perpParams - Contains parameter of the perpetual
 * @returns {number} maintenance margin rate
 */ 
export function getInitialMarginRate(position : number, perpParams : PerpParameters): number {
    let cap = perpParams.fInitialMarginRateCap
    return Math.min(perpParams.fInitialMarginRateAlpha+perpParams.fMarginRateBeta*Math.abs(position), cap);
}

/**
 * Get maintenance margin rate
 * The margin requirement depends on the position size.
 * @param {number} position - The position for which we calculate the maintenance margin rate
 * @param {PerpParameters} perpParams - Contains parameter of the perpetual
 * @returns {number} maintenance margin rate
 */
export function getMaintenanceMarginRate(position : number, perpParams : PerpParameters): number {
    return calculateMaintenanceMarginRate(perpParams.fInitialMarginRateAlpha, 
        perpParams.fMaintenanceMarginRateAlpha, 
        perpParams.fInitialMarginRateCap, 
        perpParams.fMarginRateBeta, 
        position);
}

/**
 * Get the maximal leverage that is allowed by the initial margin requirement.
 * The margin requirement depends on the position size.
 * Use this function:
 * to determine the max leverage for new and existing positions
 * @param {number} position - The position for which we calculate the maximal initial leverage
 * @param {PerpParameters} perpParams - Contains parameter of the perpetual
 * @returns {number} maximal leverage
 */ 
export function getMaxInitialLeverage(position : number, perpParams : PerpParameters): number {
    let mRate = getInitialMarginRate(position, perpParams);
    // leverage = 1 / marginrate
    const buffer = 1e-13;
    return 1/mRate - buffer;
}

/**
 * Get minimal short or maximal long position for a given trader. Assumes maximal leverage and no open positions for trader.
 * Direction=-1 for short, 1 for long
 * Assumes maximal leverage
 * This function calculates the largest position considering 
 * - leverage constraints
 * - position size constraint by AMM
 * - available funds in wallet balance and margin account
 * - slippage from mid-price
 * @param {number} direction - {-1, 1} Does the trader want to buy (1), or sell (-1)
 * @param {number} availableWalletBalance - trader's available wallet balance
 * @param {PerpParameters} perpParams - Contains parameter of the perpetual
 * @param {traderState} TraderState - Contains trader state data
 * @param {AMMState} ammData  - Contains amm state data
 * @param {LiqPoolState} poolData - Contains liq pool state data
 * @returns {number} position-size in base-currency
 */ 
export function getSignedMaxAbsPositionForTrader(
    direction : number, 
    availableWalletBalance : number, 
    perpParams : PerpParameters, 
    traderState : TraderState, 
    ammData : AMMState, 
    poolData : LiqPoolState,
    slippagePercent : number = 0
): number {
    // max position = min(current position + maximal trade size, max position allowed by leverage constraint)
    let currentPos = traderState.marginAccountPositionBC;
    let fee = getTradingFeeRate(perpParams);
    let S3 = 1/getQuote2CollateralFX(ammData);
    let S2 = getIndexPrice(ammData); 
    let Sm = getMarkPrice(ammData); 
    let maxSignedPos = currentPos + getMaximalTradeSizeInPerpetual(currentPos, Math.sign(direction), ammData, poolData, perpParams);
    let traderPnL = traderState.marginAccountPositionBC * Sm - traderState.marginAccountLockedInValueQC;
    let cashQC = (availableWalletBalance + traderState.availableCashCC) * S3 + traderPnL;
    if (cashQC <= 0) {
        return 0;
    }
    // estimate pos at max leverage: it's a non-linear equation because of the entry price so we need to iterate.
    // position_0 = one lot in given direction
    // position_i+1 = max position where entry price is price(position_i)
    let position = direction * perpParams.fLotSizeBC;
    let denominator = 1;
    let numIter = 0;
    
    let slippagePrice = calculateSlippagePriceFromMidPrice(perpParams, ammData, slippagePercent, direction);
    let tradeAmountPrice = slippagePrice;
    let marginRate;
    while (denominator > 0 && numIter < 20) {
        position = (cashQC - traderState.marginAccountPositionBC * (Sm - tradeAmountPrice)) / denominator;
        tradeAmountPrice = getPrice(position - traderState.marginAccountPositionBC, perpParams, ammData);
        tradeAmountPrice = direction > 0 ? Math.max(tradeAmountPrice, slippagePrice) : Math.min(tradeAmountPrice, slippagePrice);
        marginRate = getInitialMarginRate(position, perpParams);
        denominator = (Sm * marginRate + fee * S2 - direction * (Sm - tradeAmountPrice));
        numIter += 1;
    }
    let maxpos;
    if (direction < 0) {
        maxpos = Math.max(-position, maxSignedPos);
    } else {
        maxpos = Math.min(position, maxSignedPos);
    }
    maxpos = shrinkToLot(maxpos, perpParams.fLotSizeBC);
    return maxpos;
}

/**
 * Get the maximal trade size for a trader with position currentPos (can be 0) for a given
 * perpetual, assuming enough margin is available (i.e. not considering leverage).
 * @param {number} currentPos - The current position of the trade (base currency), negative if short
 * @param {number} direction - {-1, 1} Does the trader want to buy (1), or sell (-1)
 * @param {LiqPoolState} liqPool - Contains current liq pool state data 
 * @param {AMMState} ammData - Contains current price/state data
 * @param {PerpParameters} perpParams - Contains parameter of the perpetual
 * @returns {number} signed position size that the trader can enter
 */
export function getMaximalTradeSizeInPerpetual(
    currentPos : number, 
    direction : number, 
    ammData : AMMState, 
    liqPool : LiqPoolState, 
    perpParams : PerpParameters
): number {

    function getMaxSizeFromPrice(S2 : number, S3 : number) : number {
        let kStar = calcKStar(ammData.K2, ammData.L1, S2, S3,
            ammData.M1, ammData.M2, ammData.M3, perpParams.fRho23, perpParams.fSigma2, perpParams.fSigma3);
        let lotSize = perpParams.fLotSizeBC;
        kStar = shrinkToLot(kStar, lotSize);
        let fundingRatio = liqPool.fDefaultFundCashCC/liqPool.fTargetDFSize;
        let scale : number;
        if (Math.sign(direction) === Math.sign(kStar)) {
            scale = perpParams.fMaximalTradeSizeBumpUp
        } else {
            // adverse direction
            scale = perpParams.fMaximalTradeSizeBumpUp * Math.min(1, fundingRatio);
        }
        let maxAbsPositionSize = ammData.fCurrentTraderExposureEMA * scale;
        maxAbsPositionSize = shrinkToLot(maxAbsPositionSize, lotSize);
        let maxSignedTradeSize : number;
        if (direction < 0) {
            maxSignedTradeSize = Math.min(kStar, Math.min(-maxAbsPositionSize - currentPos, 0));
        } else {
            maxSignedTradeSize = Math.max(kStar, Math.max(maxAbsPositionSize - currentPos, 0));
        }
        return maxSignedTradeSize;
    }
    // calculate the max trade size based on the current oracle price and the latest price stored in the contract
    let maxSizeContractPx : number = getMaxSizeFromPrice(ammData.indexS2PriceData, ammData.indexS3PriceData);
    let maxSizeOraclePx : number = getMaxSizeFromPrice(ammData.indexS2PriceDataOracle, ammData.indexS3PriceDataOracle);
    return Math.min(maxSizeContractPx, maxSizeOraclePx);
}

/**
 * Get maximal trade size for trader without adding additional margin.
 * Use this when changing position size, which does not add margin.
 * Direction=-1 for short, 1 for long
 * This function calculates the largest trade considering 
 * - leverage constraints
 * - position size constraint by AMM
 * - available funds in margin account
 * @param {number} direction - {-1, 1} Does the trader want to buy (1), or sell (-1)
 * @param {number} availableWalletBalance - trader's available wallet balance
 * @param {PerpParameters} perpParams - Contains parameter of the perpetual
 * @param {traderState} TraderState - Contains trader state data
 * @param {AMMState} ammData  - Contains amm state data
 * @param {LiqPoolState} poolData - Contains liq pool state data
 * @returns {number} maintenance margin rate
 */ 
export function getMaximalTradeSizeInPerpetualWithCurrentMargin(direction : number, perpParams : PerpParameters, 
    traderState : TraderState, ammData : AMMState, poolData : LiqPoolState): number 
{
    let availableWalletBalance = 0;
    let maxPos = getSignedMaxAbsPositionForTrader(Math.sign(direction), availableWalletBalance, perpParams, traderState, ammData, poolData);
    return maxPos-traderState.marginAccountPositionBC;
}

/**
 * Calculate the worst price, the trader is willing to accept compared to the provided price 
 * @param {number} currentMidPrice - The current price from which we calculate the slippage
 * @param {number} slippagePercent - The slippage that the trader is willing to accept. The number is in decimals (0.01=1%).
 * @param {number} direction - {-1, 1} Does the trader want to buy (1), or sell (-1)
 * @returns {number} worst acceptable price
 */
export function calculateSlippagePrice(currentMidPrice : number, slippagePercent : number, direction : number) {
    // console.assert(slippagePercent<0.1);//10% is unreasonably high slippage
    // console.assert(slippagePercent>=0);
    return currentMidPrice*(1+Math.sign(direction)*slippagePercent)
}

/**
 * Calculate the worst price, the trader is willing to accept compared to the mid-price calculated as the average
 * of price(+lot) and price(-lot)
 * @param {PerpParameters} perpParams   - Perpetual Parameters
 * @param {AMMState} ammData            - AMM state data
 * @param {number} slippagePercent      - The slippage that the trader is willing to accept. The number is in decimals (0.01=1%).
 * @param {number} direction - {-1, 1} Does the trader want to buy (1), or sell (-1)
 * @returns {number} worst acceptable price
 */
export function calculateSlippagePriceFromMidPrice(perpParams : PerpParameters, ammData : AMMState, slippagePercent : number, direction : number) {
    const lot = perpParams.fLotSizeBC;
    let price = 0.5*(getPrice(-lot, perpParams, ammData) + getPrice(lot, perpParams, ammData))
    return calculateSlippagePrice(price, slippagePercent, direction);
}

/**
 * Conversion rate quote to collateral
 * Use most up to date price data
 * @param {AMMState} ammData - Contains current price/state data
 * @returns {number} conversion rate
 */ 
export function getQuote2CollateralFX(ammData : AMMState) : number {
    if (ammData.M1 !== 0) {
        // quote
        return 1;
    } else if (ammData.M2 !== 0) {
        // base
        return 1/ammData.indexS2PriceDataOracle;
    } else {
        // quanto
        return 1/ammData.indexS3PriceDataOracle;
    }
}

/**
 * Conversion rate base to collateral
 * Use most up to date price data
 * @param {AMMState} ammData - Contains current price/state data
 * @param {boolean} atMarkPrice - conversion at spot or mark price 
 * @returns {number} conversion rate
 */ 
export function getBase2CollateralFX(ammData : AMMState, atMarkPrice : boolean) : number {
    let s2 = atMarkPrice ? (ammData.currentMarkPremiumRate + 1)* ammData.indexS2PriceDataOracle : ammData.indexS2PriceDataOracle;
    if (ammData.M1 !== 0) {
        // quote
        return s2;
    } else if (ammData.M2 !== 0) {
        // base
        return s2/ammData.indexS2PriceDataOracle;
    } else {
        // quanto
        return s2/ammData.indexS3PriceDataOracle;
    }
}

/**
 * Conversion rate base to quote
 * Use most up to date price data
 * @param {AMMState} ammData - Contains current price/state data
 * @param {boolean} atMarkPrice - conversion at spot or mark price 
 * @returns {number} conversion rate
 */ 
export function getBase2QuoteFX(ammData : AMMState, atMarkPrice : boolean) : number {
    let s2 = atMarkPrice ? (1+ammData.currentMarkPremiumRate) * ammData.indexS2PriceDataOracle : ammData.indexS2PriceDataOracle;
    return s2;
}

/**
 * Calculate the price at which the perpetual will be liquidated
 * Example 1: trader has zero position and wants to trade 1 BTC --> tradeSize=1, traderCashAddedCC from getRequiredMarginCollateral
 * Example 2: trader has a position and wants to trade an additional 0.5 BTC --> tradeSize=0.5, traderCashAddedCC from getRequiredMarginCollateral
 * Example 3: trader already traded and wants to know current liq price --> tradeSize = 0, traderCashAddedCC = 0
 * current liquidation price:
 * @param {TraderState} traderState - Trader state (perpQueries.queryTraderState)
 * @param {AMMState} ammData - AMM state
 * @param {PerpParameters} perpParams - Contains parameter of the perpetual
 * @param {number} tradeSize - The trade size (base currency), negative if short
 * @param {number} traderCashAddedCC - Cash of the trader that is added to the perpetual margin account if the trader trades
 *                                     use getRequiredMarginCollateral
 * 
 * @returns {number} approximate liquidation price
 */ 
export function calculateApproxLiquidationPrice(
    traderState : TraderState,  
    ammData : AMMState, 
    perpParams : PerpParameters,
    tradeSize : number, 
    traderCashAddedCC : number
): number {
    let tradePrice = getPrice(tradeSize, perpParams, ammData);
    let newTraderCash = traderState.availableCashCC + traderCashAddedCC;
    let lockedInValueQC = traderState.marginAccountLockedInValueQC + tradeSize*tradePrice;
    let traderNewPosition = traderState.marginAccountPositionBC + tradeSize;
    let maintMarginRate = getMaintenanceMarginRate(traderNewPosition, perpParams);
    if (ammData.M1 !== 0) {
        // quote currency perpetual
        return calculateLiquidationPriceCollateralQuote(lockedInValueQC, traderNewPosition, newTraderCash, maintMarginRate);
    } else if (ammData.M2 !== 0) {
        // base currency perpetual
        return calculateLiquidationPriceCollateralBase(lockedInValueQC, traderNewPosition, newTraderCash, maintMarginRate);
    } else if (ammData.M3 !== 0) {
        // quanto currency perpetual
        // we calculate a price that leads to a liquidation according to
        // assumptions on the future prices
        let Sm =  getMarkPrice(ammData);
        return calculateLiquidationPriceCollateralQuanto(lockedInValueQC, traderNewPosition, newTraderCash, maintMarginRate, ammData.indexS3PriceDataOracle, Sm);
    }
    return -1;
}


/**
 * Provide a conservative estimate for the margin collateral required to close a leveraged stop/limit order.
 * The calculation would require the mark-price at execution and the index-price which are both unknown.
 * @param {PerpParameters} perpParams - Contains parameter of the perpetual
 * @param {AMMState} ammData - AMM state
 * @param {number} leverage - The leverage that the trader wants to achieve, given the position size
 * @param {number} tradeSize  - The trader's (signed) trade size in base currency
 * @param {number} limitPrice - limit price. Required for both stop orders and limit orders
 * @param {boolean} triggerPrice - null or triggerPrice, required for stop orders
 * @returns {number} estimated margin balance to be approved for the wallet and contract
 */
export function getEstimatedMarginCollateralForLimitOrder(
    perpParams: PerpParameters,
    ammData: AMMState,
    leverage: number,
    tradeSize: number,
    limitPrice: number,
    triggerPrice?: number,
): number {
    // console.assert(leverage > 0);
    if (triggerPrice==null) {
        triggerPrice = limitPrice;
    }
    // assume a 2x return on collateral currency in adverse direction
    let S2 = getIndexPrice(ammData);
    let adverseReturn = Math.abs(limitPrice / S2 - 1); // always positive
    let S3 = (1 / getQuote2CollateralFX(ammData)) * (1 - 2 * adverseReturn);
    let feesCC = getTradingFee(tradeSize, perpParams, ammData) * (1 + 2 * adverseReturn);
    let Sm = triggerPrice;
    let collRequired = feesCC;
    let collExFees = (Math.abs(tradeSize) * Sm / leverage - tradeSize * (Sm - limitPrice)) / S3;
    collRequired += collExFees > 0 ? collExFees : 0;
    // increase estimate by 10%
    collRequired *= 1.1;
    return collRequired;
    
}

/**
 * Get the amount of collateral required to obtain a given leverage with a given position size.
 * It accounts for trading fees, collateral already deposited, and slippage tolerance.
 * @param {number} leverage - The leverage that the trader wants to achieve, given the position size
 * @param {number} targetPos  - The trader's (signed) target position in base currency
 * @param {PerpParameters} perpParams - Contains parameter of the perpetual
 * @param {AMMState} ammData - AMM state
 * @param {TraderState} traderState - Trader state
 * @param {number} slippagePercent - optional. Specify slippage compared to mid-price that the trader is willing to accept
 * @param {boolean} accountForExistingMargin - optional, default true. subtracts existing margin and clamp to 0
 * @param {boolean} accountForExistingPosition - optional, default true. If false, the margin for a trade is calculated
 * @returns {number} balance required to arrive at the perpetual contract to obtain requested leverage
 */
export function getRequiredMarginCollateral(
    leverage: number,
    targetPos: number,
    perpParams: PerpParameters,
    ammData: AMMState,
    traderState : TraderState,
    slippagePercent = 0,
    accountForExistingMargin = true,
    accountForExistingPosition = true
): number {
    // master equation:
    // |pos_new| * Sm / l + fee_BC * S2 = margin * S3 + pos_old * Sm - L + (pos_new - pos_old)*(Sm - entry price)
    // entry price: AMM price for delta position, possibly with slippage
    // console.assert(leverage > 0);
    let currentPos = accountForExistingPosition ? traderState.marginAccountPositionBC : 0;
    let positionToTrade = targetPos - currentPos;
    let feesCC = getTradingFee(positionToTrade, perpParams, ammData);
    let dir = Math.sign(positionToTrade);
    let slippagePrice = calculateSlippagePriceFromMidPrice(perpParams, ammData, slippagePercent, dir);
    let tradeAmountPrice = getPrice(positionToTrade, perpParams, ammData);
    tradeAmountPrice = dir > 0 ? Math.max(tradeAmountPrice, slippagePrice) : Math.min(tradeAmountPrice, slippagePrice);
    // let quote2collateral = getQuote2CollateralFX(ammData);
    let S3 = 1 / getQuote2CollateralFX(ammData);
    // leverage = position/margincollateral, where position and collateral are valued at spot
    // Protocol fees are subtracted from the margincollateral
    // Hence: leverage = position/(margincollateral - fees)
    //   -> margincollateral =  position/leverage + pnl + fees
    let Sm = getMarkPrice(ammData);
    let initialPnLQC = accountForExistingPosition ? currentPos * Sm - traderState.marginAccountLockedInValueQC : 0;
    let newPnLQC = positionToTrade * (Sm - tradeAmountPrice);

    let collRequired = feesCC;
    let isClosing = accountForExistingPosition && currentPos * targetPos >= 0 && currentPos * positionToTrade < 0;
    if (!isClosing) {
        collRequired += Math.max(0, Math.abs(targetPos) * Sm / leverage - initialPnLQC - newPnLQC) / S3;
    }

    if (accountForExistingMargin) {
        // account for collateral already deposited
        return Math.max(0, collRequired - traderState.availableCashCC);
    } else {
        return collRequired;
    }
}

/**
 * Maximal amount the trader can withdraw so that they still are initial margin safe
 * 
 * Uses prices based on the recent oracle data, which can differ from the contract's price entry.
 * @param {TraderState} traderState - Trader state (for account balances)
 * @param {PerpParameters} perpData Perpetual data
 * @param {AMMState} ammData - AMM data
 * @returns An array containing [prices, % deviation from mid price ((price - mid-price)/mid-price), trade amounts]
 */ 
export function getMaximalMarginToWithdraw(traderState: TraderState, perpParams : PerpParameters, ammData : AMMState) {
    let currentPos = traderState.marginAccountPositionBC;
    let Sm = getMarkPrice(ammData);
    let S2 = ammData.indexS2PriceDataOracle;
    let S3 = 1/getQuote2CollateralFX(ammData);
    
    // required initial margin rate
    let tau = getInitialMarginRate(currentPos, perpParams);
    // required collateral: margin balance >= |pos|*tau * S2Mark/S3
    let collType = getPerpetualCollateralType(ammData);
    let b = getMarginBalanceCC(currentPos, traderState.marginAccountLockedInValueQC, S2, S3, Sm-S2, traderState.availableCashCC, 
        collType)
    // we can withdraw only the amount the current margin balance is above |pos|*tau * S2Mark/S3
    let maxAmount = b - Math.abs(currentPos) * tau * Sm/S3;
    // we shrink the amount by a fraction of a lot (collateral currency equivalent) to be safe and avoid that the margin is not enough
    const lotSizeFraction = 0.10;
    maxAmount = shrinkToLot(maxAmount, perpParams.fLotSizeBC * S2/S3 * lotSizeFraction);
    return Math.max(0, maxAmount);
}

/**
 * Get the unrealized Profit/Loss of a trader using mark price as benchmark. Reported in Quote currency.
 * @param {TraderState} traderState - Trader state (for account balances)
 * @param {AMMState} ammData - AMM state (for mark price and CCY conversion)
 * @param {PerpParameters} perpParams - Contains parameter of the perpetual
 * @param {number} limitPrice - optional exit price for which the PnL should be calculated
 * @returns {number} PnL = value of position at mark price minus locked in value
 */ 
export function getTraderPnL(traderState : TraderState, ammData : AMMState, perpData : PerpParameters, limitPrice : number = NaN) : number {
    let price = isNaN(limitPrice)? getMarkPrice(ammData) : limitPrice;
    let tradePnL = traderState.marginAccountPositionBC * price - traderState.marginAccountLockedInValueQC;
    let fundingPnL = getFundingFee(traderState, perpData) / getQuote2CollateralFX(ammData);
    return tradePnL - fundingPnL;
}

/**
 * Get the current leverage of a trader using mark price as benchmark.
 * See chapter "Lemmas / Leverage" in whitepaper
 * @param {TraderState} traderState - Trader state (for account balances)
 * @param {AMMState} ammData - AMM state (for mark price and CCY conversion)
 * @returns {number} current leverage for the trader 
 */ 
export function getTraderLeverage(traderState : TraderState, ammData : AMMState) : number {
    let pnlQC = traderState.marginAccountPositionBC * getMarkPrice(ammData) - traderState.marginAccountLockedInValueQC;
    let b = pnlQC*getQuote2CollateralFX(ammData) + traderState.availableCashCC;
    return Math.abs(traderState.marginAccountPositionBC) * getBase2CollateralFX(ammData, false) / b;
}

/**
 * Get the unrealized Profit/Loss of a trader using a given exit price if specified, or the mark price otherwise. 
 * Reported in collateral currency and includes upcoming funding payments.
 * @param {TraderState} traderState - Trader state (for account balances)
 * @param {AMMState} ammData - AMM state (for mark price and CCY conversion)
 * @param {PerpParameters} perpParams - Contains parameter of the perpetual
 * @param {number} price - optional exit price for which the PnL should be calculated
 * @returns {number} PnL = value of position at mark price minus locked in value
 */ 
 export function getTraderPnLInCC(traderState : TraderState, ammData : AMMState, perpData : PerpParameters, limitPrice : number = NaN) : number {
    return getQuote2CollateralFX(ammData) * getTraderPnL(traderState, ammData, perpData, limitPrice);
}

/**
 * Get the unpaid, accumulated funding rate in collateral currency
 * @param {TraderState} traderState - Trader state (for account balances)
 * @param {PerpParameters} perpData - Perp parameters
 * @returns {number} PnL = value of position at mark price minus locked in value
 */ 
 export function getFundingFee(traderState : TraderState, perpData : PerpParameters) : number {
    let fCurrentFee = perpData.fUnitAccumulatedFunding - traderState.fUnitAccumulatedFundingStart;
    // if the fee is positive, the long pays the short receives and vice versa
    // hence no abs(position) required
    return fCurrentFee * traderState.marginAccountPositionBC;
}

/**
 * Get the mid-price based on 0 quantity (no bid-ask spread)
 * Uses the most recent index data (from Oracle), which might differ
 * from the stored data in the contract
 * @param {PerpParameters} perpData - Perp parameters
 * @param {AMMState} ammData - AMM state (for mark price and CCY conversion)
 * @returns {number} PnL = value of position at mark price minus locked in value
 */ 
export function getMidPrice(perpParams : PerpParameters, ammData : AMMState) : number {
    return getPrice(0, perpParams, ammData);
}

/**
 * Calculates the price using the most recent Oracle price data 
 * (might differ from the oracle price stored in the contract)
 * 
 * @param {number} tradeSize size of the trade
 * @param {PerpParameters} perpData Perpetual data
 * @param {AMMState} ammData - AMM data
 * @returns An array containing [prices, % deviation from mid price ((price - mid-price)/mid-price), trade amounts]
 */ 
export function getPrice(tradeSize : number, perpParams : PerpParameters, ammData : AMMState) : number {
    let k = tradeSize;
    let r = 0;
    let minSpread = getMinimalSpread(perpParams, ammData);

    return calcPerpPrice(ammData.K2, k,
        ammData.L1, ammData.indexS2PriceDataOracle, ammData.indexS3PriceDataOracle, perpParams.fSigma2, perpParams.fSigma3, 
        perpParams.fRho23,
        r, ammData.M1, ammData.M2, ammData.M3, minSpread);
}

/**
 * Builds the depth matrix using the bid-ask spread to construct prices and trade amounts:
 * - Short prices are equi-spaced from the unit price of an infinitesimal short
 * - Long prices are equi-spaced from the unit price of an infinitesimal long
 * e.g. for -0.4%, we find a trade amount k such that (price(-k) - price(-0)) / price(-0) = -0.4%
 * note that the mid-price is (price(+0) + price(-0)) / 2
 * 
 * Uses prices based on the recent oracle data, which can differ from the contract's price entry.
 * @param {PerpParameters} perpData Perpetual data
 * @param {AMMState} ammData - AMM data
 * @returns An array containing [prices, % deviation from mid price ((price - mid-price)/mid-price), trade amounts]
 */ 
export function getDepthMatrix(perpData : PerpParameters, ammData : AMMState) {
    let pctRange = [-1.0, -0.9, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, 0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    return getPricesAndTradesForPercentRage(ammData.K2, ammData.L1, ammData.indexS2PriceDataOracle, ammData.indexS3PriceDataOracle, perpData.fSigma2, perpData.fSigma3, perpData.fRho23,
        0, ammData.M1, ammData.M2, ammData.M3, perpData.fMinimalSpread, perpData.fLotSizeBC, pctRange); 
}

/**
 * Check whether trader is maintenance margin safe (i.e. cannot be liquidated yet)
 * 
 * Uses prices based on the recent oracle data, which can differ from the contract's price entry.
 * @param {TraderState} traderState - Trader state (for account balances)
 * @param {PerpParameters} perpData Perpetual data
 * @param {AMMState} ammData - AMM data
 * @returns An array containing [prices, % deviation from mid price ((price - mid-price)/mid-price), trade amounts]
 */ 
export function isTraderMaintenanceMarginSafe(traderState: TraderState, perpParams : PerpParameters, ammData : AMMState) {
    let tau = getMaintenanceMarginRate(traderState.marginAccountPositionBC, perpParams);
    let m = traderState.availableCashCC;
    let s3 = 1/getQuote2CollateralFX(ammData);
    return isTraderMarginSafe(tau, 
                            traderState.marginAccountPositionBC, 
                            getMarkPrice(ammData), 
                            traderState.marginAccountLockedInValueQC, 
                            ammData.indexS2PriceDataOracle, 
                            s3,
                            m);
}


// TODO: get max position size for given margin
/**
 * Check whether trader is initial margin safe (i.e. can increase position or withdraw margin)
 * 
 * Uses prices based on the recent oracle data, which can differ from the contract's price entry.
 * @param {TraderState} traderState - Trader state (for account balances)
 * @param {number} deltaCashCC - requested change in margin cash in collateral currency (plus to add, minus to remove)
 * @param {number} deltaPosBC - requested change in position size (plus to add, minus to remove)
 * @param {PerpParameters} perpData Perpetual data
 * @param {AMMState} ammData - AMM data
 * @returns An array containing [prices, % deviation from mid price ((price - mid-price)/mid-price), trade amounts]
 */ 
export function isTraderInitialMarginSafe(traderState: TraderState, deltaCashCC : number, deltaPosBC : number, perpParams : PerpParameters, ammData : AMMState) {
    let tau = getInitialMarginRate(traderState.marginAccountPositionBC, perpParams);
    let m = traderState.availableCashCC + deltaCashCC;
    let newPositionBC = traderState.marginAccountPositionBC + deltaPosBC;
    let lockedIn = traderState.marginAccountLockedInValueQC;
    if (deltaPosBC!==0) {
        // factor-in a trade of size deltaPosBC
        let px = getPrice(deltaPosBC, perpParams, ammData);
        lockedIn = lockedIn + px*deltaPosBC;
        let feesCC = getTradingFee(deltaPosBC, perpParams, ammData);
        m = m - feesCC;
    }
    let s3 = 1/getQuote2CollateralFX(ammData);
    return isTraderMarginSafe(tau, 
                            newPositionBC, 
                            getMarkPrice(ammData), 
                            lockedIn, 
                            ammData.indexS2PriceDataOracle, 
                            s3,
                            m);
}

/**
 * Return minimal spread that depends on Default Fund funding rate
 * @param {PerpParameters} perpData Perpetual data
 * @param {AMMState} ammData - AMM data
 * @returns minimal bid-ask spread
 */ 
export function getMinimalSpread(perpParams : PerpParameters, ammData : AMMState) : number {
    return ammData.defFundToTargetRatio > 1 ? perpParams.fMinimalSpread : perpParams.fMinimalSpreadInStress;
}

/**
 * internal function to get the type of collateral: quote, base, or quanto
 * @param {AMMState} ammData - AMM data
 * @returns COLLATERAL_CURRENCY_BASE | COLLATERAL_CURRENCY_QUOTE | COLLATERAL_CURRENCY_QUANTO
 */
function getPerpetualCollateralType(ammData : AMMState) {
    if (ammData.M2 != 0) {
        return COLLATERAL_CURRENCY_BASE;
    } else if (ammData.M3 != 0) {
        return COLLATERAL_CURRENCY_QUANTO;
    } else {
        return COLLATERAL_CURRENCY_QUOTE;
    }
}

/**
 * Calculates leverage of a resulting position.
 * It accounts for trading fees and current trader balance.
 * See also 'calculateLeverage'
 * @param {TraderState} traderState
 * @param {AMMState} ammState
 * @param {PerpParameters} perpParameters
 * @param {number} orderSize - signed order size (coll.curr.)
 * @param {number} tradeLeverage - leverage of trade (order)
 * @param {number} slippagePercent - slippage tolerance, in decimals (1% is 0.01)
 * @param {boolean} keepPositionLeverage - if true it returns the existing position leverage
 * @returns {number} leverage of resulting position after trade
 */
export function calculateResultingPositionLeverage(
    traderState: TraderState,
    ammState: AMMState,
    perpParameters: PerpParameters,
    orderSize: number,
    tradeLeverage: number,
    slippagePercent : number = 0,
    keepPositionLeverage : boolean = false) 
{   
    let currentPosition = traderState.marginAccountPositionBC;
    if (keepPositionLeverage) {
        return calculateLeverage(currentPosition, traderState.availableCashCC, traderState, ammState, perpParameters);
    }
    let isFlip = currentPosition * orderSize < 0 && Math.abs(orderSize) > Math.abs(currentPosition);
    if (traderState.marginAccountPositionBC == 0 || isFlip) {
        return tradeLeverage;
    }
    // master equation:
    // |p_new| * S2 / l + fee_BC * S2 = m * S3 + p_old * Sm - L + (p_new - p_old)*(S2 - entry price)
    let targetPos = currentPosition + orderSize;
    let feesCC = getTradingFee(orderSize, perpParameters, ammState);
    let accountForExistingMargin = false;
    let accountForExistingPosition = false;
    let marginCollateral = Math.abs(orderSize)==0 ? 0 :
        getRequiredMarginCollateral(tradeLeverage,
            orderSize,
            perpParameters,
            ammState,
            traderState,
            slippagePercent,
            accountForExistingMargin,
            accountForExistingPosition);

    let marginCollateralNew = marginCollateral + traderState.availableCashCC;
    return calculateLeverage(targetPos, marginCollateralNew, traderState, ammState, perpParameters, slippagePercent);
}

/**
 * Calculates leverage for new margin-collateral and position. 
 * It accounts for trading fees and current trader balance.
 * @param {number} targetPosition - new target position size, in base currency
 * @param {number} targetMargin - new margin collateral after trade, in collateral currency
 * @param {TraderState} traderState - trader state
 * @param {AMMState} ammState - AMM state
 * @param {PerpParameters} perpParameters - perp parameters
 * @param {number} slippagePercent - slippage percent
 * @returns {number} current leverage for the trader
 */
export function calculateLeverage(
    targetPosition: number,
    targetMargin: number,
    traderState: TraderState,
    ammState: AMMState,
    perpParameters: PerpParameters,
    slippagePercent : number = 0
) : number {
    // master equation:
    // |p_new| * Sm / l + fee_BC * S2 = m * S3 + p_old * Sm - L + (p_new - p_old)*(Sm - entry price)
    // entry price: AMM price for delta position, possibly with slippage
    // console.assert(targetMargin > 0);
    // pnl of existing position
    let S2 = getIndexPrice(ammState);
    let S3 = 1 / getQuote2CollateralFX(ammState);
    let Sm = getMarkPrice(ammState);
    let currentPosition = traderState.marginAccountPositionBC;
    let lockedIn = traderState.marginAccountLockedInValueQC;
    let initialPnL = currentPosition * Sm - lockedIn;
    // pnl of adjusting position
    let deltaPosition = targetPosition - currentPosition;
    let dir = Math.sign(deltaPosition);
    let slippagePrice = calculateSlippagePriceFromMidPrice(perpParameters, ammState, slippagePercent, dir);
    let tradeAmountPrice = getPrice(deltaPosition, perpParameters, ammState);
    tradeAmountPrice = dir>0 ? Math.max(tradeAmountPrice, slippagePrice) : Math.min(tradeAmountPrice, slippagePrice);
    let newPnL = deltaPosition * (Sm - tradeAmountPrice);
    // fees
    let feesQC = getTradingFee(deltaPosition, perpParameters, ammState) * S3;
    // leverage = position / margin after fees and pnl
    let numeratorQC = Math.abs(targetPosition) * getBase2QuoteFX(ammState, false);
    let denominatorQC = initialPnL + newPnL + targetMargin * S3 - feesQC;
    return numeratorQC / denominatorQC;
}

/**
 * Calculates the average entry price for a given trader.
 * It returns NaN if the position is zero.
 * @param {TraderState} traderState
 * @returns {number} Average entry price: | locked-in-value / position-size |
 */
export function getAverageEntryPrice(traderState: TraderState) : number {
    let positionBC = traderState.marginAccountPositionBC;
    if (positionBC == 0) {
        return NaN;
    }
    return Math.abs(traderState.marginAccountLockedInValueQC / positionBC);
}

/**
 * Returns a digest for a limit or stop order (or its cancelation), that is to be signed.
 * @param {Order} order             order-struct to be signed
 * @param {boolean} isNewOrder      true for order placement, fals for order cancellation
 * @param {string} managerAddress   address of perpetual-manager
 * @param {number} chainId          Chain ID for current network
 * @returns {Promise<Buffer>} signed order or signed cancelation of order
 */
 export async function createOrderDigest(
    order: any,
    isNewOrder: boolean,
    managerAddress: string,
    chainId: number,
  ): Promise<string> {
    const NAME = toUtf8Bytes('Perpetual Trade Manager');
    const DOMAIN_TYPEHASH = keccak256(
      toUtf8Bytes(
        'EIP712Domain(string name,uint256 chainId,address verifyingContract)',
      ),
    );
    let domainSeparator = keccak256(
      defaultAbiCoder.encode(
        ['bytes32', 'bytes32', 'uint256', 'address'],
        [DOMAIN_TYPEHASH, keccak256(NAME), chainId, managerAddress],
      ),
    );
    const TRADE_ORDER_TYPEHASH = keccak256(
      toUtf8Bytes(
        'Order(bytes32 iPerpetualId,address traderAddr,int128 fAmount,int128 fLimitPrice,int128 fTriggerPrice,uint256 iDeadline,uint32 flags,int128 fLeverage,uint256 createdTimestamp)',
      ),
    );
    let structHash = keccak256(
      defaultAbiCoder.encode(
        [
          'bytes32',
          'bytes32',
          'address',
          'int128',
          'int128',
          'int128',
          'uint256',
          'uint32',
          'int128',
          'uint256',
        ],
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
        ],
      ),
    );
    let digest = keccak256(
      defaultAbiCoder.encode(
        ['bytes32', 'bytes32', 'bool'],
        [domainSeparator, structHash, isNewOrder],
      ),
    );
    return digest;
  }

/**
 * Provides a conservative estimate of the margin needed for an order submitted by a trader, 
 * conditional on all of the trader's open orders
 * @param {PerpParameters} perpParams 
 * @param {AMMState} ammData 
 * @param {TraderState} traderState 
 * @returns {number} Approximate margin collateral needed to fulfill all existing orders for trader
 */
 export function getEstimatedMarginCollateralForTrader(
    fAmount: number,
    fLeverage: number,
    traderOrders,
    perpParams: PerpParameters,
    ammData: AMMState,
    traderState: TraderState,
    slippagePercent?,
    fLimitPrice?,
    fTriggerPrice?
 ) : number {
    let res = 0;
    for(const o of traderOrders) {
        res += getEstimatedMarginCollateralForLimitOrder(perpParams, ammData, o.fLeverage, o.fAmount, o.fLimitPrice, o.fTriggerPrice);
        res += perpParams.fReferralRebateCC;
    }
    if (slippagePercent == null) {
        slippagePercent = 0;
    }
    if (fLimitPrice == null) {
        res += getRequiredMarginCollateral(fLeverage, traderState.marginAccountPositionBC + fAmount, perpParams, ammData, traderState, slippagePercent, true, true);
    } else {
        if (fTriggerPrice == null) {
            fTriggerPrice = 0;
        }
        res += getEstimatedMarginCollateralForLimitOrder(perpParams, ammData, fLeverage, fAmount, fLimitPrice, fTriggerPrice);
        res += perpParams.fReferralRebateCC;
    }
    return res;
 }

 /**
 * Get the minimal position size for the perpetual
 * @param {perpParameters} PerpParameters
 * @returns {number} (Global min num lots per position) x (Perpetual lot size)
 */
export function getMinimalPositionSize(perpParameters: PerpParameters) : number {
    // TODO: read global min num lots from contract? though we plan to only change it rarely
    return perpParameters.fLotSizeBC * 10;
}

/**
 * Get the margin balance of a given trader at closing in collateral currency. 
 * Valuation is at AMM price, not mark price, and includes funding and trading fees.
 * @param {TraderState} traderState - Trader state (for account balances)
 * @param {AMMState} ammData - AMM state (for mark price and CCY conversion)
 * @param {PerpParameters} perpParams - Contains parameter of the perpetual
 * @returns {number} Best approximation of the margin the trader would get if closing immediately.
 */ 
 export function getMarginBalanceAtClosing(traderState : TraderState, ammData : AMMState, perpData : PerpParameters) : number {
    let tradeAmount = -traderState.marginAccountPositionBC;
    let price = getPrice(tradeAmount, perpData, ammData);
    let closingPnL = (traderState.marginAccountPositionBC * price - traderState.marginAccountLockedInValueQC) * getQuote2CollateralFX(ammData);
    let fundingPnL = getFundingFee(traderState, perpData);
    let fees = getTradingFee(tradeAmount,perpData, ammData);
    return traderState.marginAccountCashCC + closingPnL - fundingPnL - fees;
}
