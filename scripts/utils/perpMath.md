## Functions

<dl>
<dt><a href="#getDepositAmountForLvgPosition">getDepositAmountForLvgPosition(pos, leverage, price, S2, S3, S2Mark, totalFeeRate)</a> ⇒ <code>number</code></dt>
<dd><p>Determine amount to be deposited into margin account so that the given leverage
is obtained when trading a position pos (trade amount = position)</p></dd>
<dt><a href="#getDepositAmountForLvgTrade">getDepositAmountForLvgTrade(pos0, b0, tradeAmnt, targetLvg, price, S3, S2Mark)</a> ⇒ <code>number</code></dt>
<dd><p>Determine amount to be deposited into margin account so that the given leverage
is obtained when trading a position pos (trade amount = position)
Does NOT include fees</p></dd>
<dt><a href="#calculateLiquidationPriceCollateralBase">calculateLiquidationPriceCollateralBase(LockedInValueQC, position, cash_cc, maintenance_margin_ratio, S3)</a> ⇒ <code>number</code></dt>
<dd><p>Determine amount to be deposited into margin account so that the given leverage
is obtained when trading a position pos (trade amount = position)</p></dd>
<dt><a href="#calculateLiquidationPriceCollateralQuanto">calculateLiquidationPriceCollateralQuanto(LockedInValueQC, position, cash_cc, maintenance_margin_ratio, S3, Sm)</a> ⇒ <code>number</code></dt>
<dd><p>Determine amount to be deposited into margin account so that the given leverage
is obtained when trading a position pos (trade amount = position)</p></dd>
<dt><a href="#calculateLiquidationPriceCollateralQuote">calculateLiquidationPriceCollateralQuote(LockedInValueQC, position, cash_cc, maintenance_margin_ratio, S3)</a> ⇒ <code>number</code></dt>
<dd><p>Determine amount to be deposited into margin account so that the given leverage
is obtained when trading a position pos (trade amount = position)</p></dd>
<dt><a href="#isTraderMarginSafe">isTraderMarginSafe(tau, position, markPrice, lockedInValueQC, S2, S3, m)</a> ⇒ <code>number</code></dt>
<dd><p>Determine whether the trader is maintenance margin safe, given the required target margin rate tau.</p></dd>
<dt><a href="#calculateLiquidationAmount">calculateLiquidationAmount(marginBalanceCC, mntncMarginRate, targetMarginRate, traderPositionBC, liquidationFee, tradingFee, lotSize, S2, S3, Sm)</a> ⇒ <code>number</code></dt>
<dd><p>Determine amount to be liquidated. If positive sell, if negative buy.</p></dd>
<dt><a href="#getMarginBalanceCC">getMarginBalanceCC(pos, LockedInValueQC, S2, S3, markPremium, cashCC, collateralCurrencyIndex)</a> ⇒ <code>number</code></dt>
<dd><p>Calculate margin balance in collateral currency for a trader
See alternative function below</p></dd>
<dt><a href="#calculateMarginBalance">calculateMarginBalance(position, markPrice, lockedInValueQC, S3, m)</a> ⇒ <code>number</code></dt>
<dd><p>Calculate margin balance in collateral currency for a trader
See alternative function above</p></dd>
<dt><a href="#isMarginSafe">isMarginSafe(pos, LockedInValueQC, S2, S3, markPremium, cashCC, collateralCurrencyIndex)</a> ⇒ <code>bool</code></dt>
<dd><p>Check whether margin is safe for given marginrate</p></dd>
<dt><a href="#getBase2CollateralFX">getBase2CollateralFX(indexS2, indexS3, markPremium, collateral_currency_index, atMarkPrice)</a> ⇒ <code>number</code></dt>
<dd><p>Conversion rate base to collateral</p></dd>
<dt><a href="#roundToLot">roundToLot(value, lotSize)</a> ⇒ <code>number</code></dt>
<dd><p>Round value to precision.
Replicates the smart contract specification of this function.</p></dd>
<dt><a href="#roundToLotBN">roundToLotBN(value, lotSize)</a> ⇒ <code>BigNumber</code></dt>
<dd><p>Round value to precision. Replicates the smart contract specification of this function.</p></dd>
<dt><a href="#shrinkToLot">shrinkToLot(value, lotSize)</a> ⇒ <code>number</code></dt>
<dd><p>Round value down (towards zero) to precision</p></dd>
<dt><a href="#growToLot">growToLot(value, lotSize)</a> ⇒ <code>number</code></dt>
<dd><p>Round value up (away from zero) to precision</p></dd>
<dt><a href="#getMaxLeveragePosition">getMaxLeveragePosition(cashBC, targetPremiumRate, alpha, beta, feeRate, slippageRate)</a> ⇒ <code>number</code></dt>
<dd><p>Calculate maximal position that can be achieved with full leverage and under misterious mark-price assumptions
Not considering position-size restrictions of AMM</p></dd>
</dl>

<a name="getDepositAmountForLvgPosition"></a>

## getDepositAmountForLvgPosition(pos, leverage, price, S2, S3, S2Mark, totalFeeRate) ⇒ <code>number</code>
<p>Determine amount to be deposited into margin account so that the given leverage
is obtained when trading a position pos (trade amount = position)</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>Amount to be deposited to have the given leverage when trading into position pos</p>  

| Param | Type | Description |
| --- | --- | --- |
| pos | <code>number</code> | <p>target position</p> |
| leverage | <code>number</code> | <p>target leverage</p> |
| price | <code>number</code> | <p>price to trade amount 'pos'</p> |
| S2 | <code>number</code> | <p>index price S2</p> |
| S3 | <code>number</code> | <p>collateral to quote conversion (=S2 if base-collateral, =1 if quote collateral, = index S3 if quanto)</p> |
| S2Mark | <code>number</code> | <p>mark price</p> |
| totalFeeRate | <code>number</code> | <p>total fee rates (PNL participants + treasury fee)</p> |

<a name="getDepositAmountForLvgTrade"></a>

## getDepositAmountForLvgTrade(pos0, b0, tradeAmnt, targetLvg, price, S3, S2Mark) ⇒ <code>number</code>
<p>Determine amount to be deposited into margin account so that the given leverage
is obtained when trading a position pos (trade amount = position)
Does NOT include fees</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>Amount to be deposited to have the given leverage when trading into position pos before fees</p>  

| Param | Type | Description |
| --- | --- | --- |
| pos0 | <code>number</code> | <p>target position</p> |
| b0 | <code>number</code> | <p>target position</p> |
| tradeAmnt | <code>number</code> | <p>target position</p> |
| targetLvg | <code>number</code> | <p>target leverage</p> |
| price | <code>number</code> | <p>price to trade amount 'pos'</p> |
| S3 | <code>number</code> | <p>collateral to quote conversion (=S2 if base-collateral, =1 if quote collateral, = index S3 if quanto)</p> |
| S2Mark | <code>number</code> | <p>mark price</p> |

<a name="calculateLiquidationPriceCollateralBase"></a>

## calculateLiquidationPriceCollateralBase(LockedInValueQC, position, cash_cc, maintenance_margin_ratio, S3) ⇒ <code>number</code>
<p>Determine amount to be deposited into margin account so that the given leverage
is obtained when trading a position pos (trade amount = position)</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>Amount to be deposited to have the given leverage when trading into position pos</p>  

| Param | Type | Description |
| --- | --- | --- |
| LockedInValueQC | <code>number</code> | <p>trader locked in value in quote currency</p> |
| position | <code>number</code> | <p>trader position in base currency</p> |
| cash_cc | <code>number</code> | <p>trader available margin cash in collateral currency</p> |
| maintenance_margin_ratio | <code>number</code> | <p>maintenance margin ratio</p> |
| S3 | <code>number</code> | <p>collateral to quote conversion (=S2 if base-collateral, =1 if quuote collateral, = index S3 if quanto)</p> |

<a name="calculateLiquidationPriceCollateralQuanto"></a>

## calculateLiquidationPriceCollateralQuanto(LockedInValueQC, position, cash_cc, maintenance_margin_ratio, S3, Sm) ⇒ <code>number</code>
<p>Determine amount to be deposited into margin account so that the given leverage
is obtained when trading a position pos (trade amount = position)</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>Amount to be deposited to have the given leverage when trading into position pos</p>  

| Param | Type | Description |
| --- | --- | --- |
| LockedInValueQC | <code>number</code> | <p>trader locked in value in quote currency</p> |
| position | <code>number</code> | <p>trader position in base currency</p> |
| cash_cc | <code>number</code> | <p>trader available margin cash in collateral currency</p> |
| maintenance_margin_ratio | <code>number</code> | <p>maintenance margin ratio</p> |
| S3 | <code>number</code> | <p>collateral to quote conversion (=S2 if base-collateral, =1 if quuote collateral, = index S3 if quanto)</p> |
| Sm | <code>number</code> | <p>mark price</p> |

<a name="calculateLiquidationPriceCollateralQuote"></a>

## calculateLiquidationPriceCollateralQuote(LockedInValueQC, position, cash_cc, maintenance_margin_ratio, S3) ⇒ <code>number</code>
<p>Determine amount to be deposited into margin account so that the given leverage
is obtained when trading a position pos (trade amount = position)</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>Amount to be deposited to have the given leverage when trading into position pos</p>  

| Param | Type | Description |
| --- | --- | --- |
| LockedInValueQC | <code>number</code> | <p>trader locked in value in quote currency</p> |
| position | <code>number</code> | <p>trader position in base currency</p> |
| cash_cc | <code>number</code> | <p>trader available margin cash in collateral currency</p> |
| maintenance_margin_ratio | <code>number</code> | <p>maintenance margin ratio</p> |
| S3 | <code>number</code> | <p>collateral to quote conversion (=S2 if base-collateral, =1 if quuote collateral, = index S3 if quanto)</p> |

<a name="isTraderMarginSafe"></a>

## isTraderMarginSafe(tau, position, markPrice, lockedInValueQC, S2, S3, m) ⇒ <code>number</code>
<p>Determine whether the trader is maintenance margin safe, given the required target margin rate tau.</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>Amount to be liquidated (in base currency)</p>  

| Param | Type | Description |
| --- | --- | --- |
| tau | <code>number</code> | <p>target margin rate (e.g., the maintenance margin rate)</p> |
| position | <code>number</code> | <p>traders position</p> |
| markPrice | <code>number</code> | <p>mark price</p> |
| lockedInValueQC | <code>number</code> | <p>traders locked in value</p> |
| S2 | <code>number</code> | <p>index price S2, base to quote conversion</p> |
| S3 | <code>number</code> | <p>collateral to quote conversion</p> |
| m | <code>number</code> | <p>trader collateral in collateral currency</p> |

<a name="calculateLiquidationAmount"></a>

## calculateLiquidationAmount(marginBalanceCC, mntncMarginRate, targetMarginRate, traderPositionBC, liquidationFee, tradingFee, lotSize, S2, S3, Sm) ⇒ <code>number</code>
<p>Determine amount to be liquidated. If positive sell, if negative buy.</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>Amount to be liquidated (in base currency)</p>  

| Param | Type | Description |
| --- | --- | --- |
| marginBalanceCC | <code>number</code> | <p>Current margin balance in collateral currency</p> |
| mntncMarginRate | <code>number</code> | <p>Maintenance margin rate</p> |
| targetMarginRate | <code>number</code> | <p>Margin rate target for after liquidation</p> |
| traderPositionBC | <code>number</code> | <p>Current trader position</p> |
| liquidationFee | <code>number</code> | <p>liquidation fee rate, applied to position size (base currency) being liquidated</p> |
| tradingFee | <code>number</code> | <p>trading fee rate, applied to position size (base currency) being liquidated</p> |
| lotSize | <code>number</code> | <p>lot size (base currency)</p> |
| S2 | <code>number</code> | <p>index price (base to quote)</p> |
| S3 | <code>number</code> | <p>collateral to quote conversion</p> |
| Sm | <code>number</code> | <p>mark price (base to quote conversion)</p> |

<a name="getMarginBalanceCC"></a>

## getMarginBalanceCC(pos, LockedInValueQC, S2, S3, markPremium, cashCC, collateralCurrencyIndex) ⇒ <code>number</code>
<p>Calculate margin balance in collateral currency for a trader
See alternative function below</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>margin balance</p>  

| Param | Type | Description |
| --- | --- | --- |
| pos | <code>number</code> | <p>position (base currency)</p> |
| LockedInValueQC | <code>number</code> | <p>trader locked in value in quote currency</p> |
| S2 | <code>number</code> | <p>Index S2</p> |
| S3 | <code>number</code> | <p>Index S3 (can be zero if not quanto)</p> |
| markPremium | <code>number</code> | <p>mark price premium in quote currency</p> |
| cashCC | <code>number</code> | <p>collateral</p> |
| collateralCurrencyIndex | <code>number</code> | <p>[0,1,2]</p> |

<a name="calculateMarginBalance"></a>

## calculateMarginBalance(position, markPrice, lockedInValueQC, S3, m) ⇒ <code>number</code>
<p>Calculate margin balance in collateral currency for a trader
See alternative function above</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>Amount to be liquidated (in base currency)</p>  

| Param | Type | Description |
| --- | --- | --- |
| position | <code>number</code> | <p>traders position</p> |
| markPrice | <code>number</code> | <p>mark price</p> |
| lockedInValueQC | <code>number</code> | <p>traders locked in value</p> |
| S3 | <code>number</code> | <p>collateral to quote conversion</p> |
| m | <code>number</code> | <p>trader collateral in collateral currency</p> |

<a name="isMarginSafe"></a>

## isMarginSafe(pos, LockedInValueQC, S2, S3, markPremium, cashCC, collateralCurrencyIndex) ⇒ <code>bool</code>
<p>Check whether margin is safe for given marginrate</p>

**Kind**: global function  
**Returns**: <code>bool</code> - <p>margin balance &gt; Math.abs(pos) * marginrate * b2c;</p>  

| Param | Type | Description |
| --- | --- | --- |
| pos | <code>number</code> | <p>position (base currency)</p> |
| LockedInValueQC | <code>number</code> | <p>trader locked in value in quote currency</p> |
| S2 | <code>number</code> | <p>Index S2</p> |
| S3 | <code>number</code> | <p>Index S3 (can be zero if not quanto)</p> |
| markPremium | <code>number</code> | <p>mark price premium in quote currency</p> |
| cashCC | <code>number</code> | <p>collateral</p> |
| collateralCurrencyIndex | <code>number</code> | <p>[COLLATERAL_CURRENCY_BASE, COLLATERAL_CURRENCY_QUOTE, COLLATERAL_CURRENCY_QUANTO]</p> |

<a name="getBase2CollateralFX"></a>

## getBase2CollateralFX(indexS2, indexS3, markPremium, collateral_currency_index, atMarkPrice) ⇒ <code>number</code>
<p>Conversion rate base to collateral</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>conversion rate</p>  

| Param | Type | Description |
| --- | --- | --- |
| indexS2 | <code>number</code> | <p>Contains current S2 price data</p> |
| indexS3 | <code>number</code> | <p>Contains current S3 price data</p> |
| markPremium | <code>number</code> | <p>mark price premium (amount above index in quote currency)</p> |
| collateral_currency_index | <code>number</code> | <p>COLLATERAL_CURRENCY_QUOTE, COLLATERAL_CURRENCY_BASE or COLLATERAL_CURRENCY_QUANTO</p> |
| atMarkPrice | <code>boolean</code> | <p>conversion at spot or mark price</p> |

<a name="roundToLot"></a>

## roundToLot(value, lotSize) ⇒ <code>number</code>
<p>Round value to precision.
Replicates the smart contract specification of this function.</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>rounded value</p>  

| Param | Type | Description |
| --- | --- | --- |
| value | <code>number</code> | <p>number to be rounded</p> |
| lotSize | <code>number</code> | <p>size of the lot (e.g., 0.0001)</p> |

<a name="roundToLotBN"></a>

## roundToLotBN(value, lotSize) ⇒ <code>BigNumber</code>
<p>Round value to precision. Replicates the smart contract specification of this function.</p>

**Kind**: global function  
**Returns**: <code>BigNumber</code> - <p>rounded value in ABDK64.64 BigNumber format</p>  

| Param | Type | Description |
| --- | --- | --- |
| value | <code>number</code> | <p>float, number to be rounded</p> |
| lotSize | <code>number</code> | <p>float, size of the lot (e.g., 0.0001)</p> |

<a name="shrinkToLot"></a>

## shrinkToLot(value, lotSize) ⇒ <code>number</code>
<p>Round value down (towards zero) to precision</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>rounded value</p>  

| Param | Type | Description |
| --- | --- | --- |
| value | <code>number</code> | <p>number to be rounded</p> |
| lotSize | <code>number</code> | <p>size of the lot (e.g., 0.0001)</p> |

<a name="growToLot"></a>

## growToLot(value, lotSize) ⇒ <code>number</code>
<p>Round value up (away from zero) to precision</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>rounded value</p>  

| Param | Type | Description |
| --- | --- | --- |
| value | <code>number</code> | <p>number to be rounded</p> |
| lotSize | <code>number</code> | <p>size of the lot (e.g., 0.0001)</p> |

<a name="getMaxLeveragePosition"></a>

## getMaxLeveragePosition(cashBC, targetPremiumRate, alpha, beta, feeRate, slippageRate) ⇒ <code>number</code>
<p>Calculate maximal position that can be achieved with full leverage and under misterious mark-price assumptions
Not considering position-size restrictions of AMM</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>position notional</p>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| cashBC | <code>number</code> |  | <p>available collateral</p> |
| targetPremiumRate | <code>number</code> |  | <p>premium rate</p> |
| alpha | <code>number</code> |  | <p>parameter for initial margin</p> |
| beta | <code>number</code> |  | <p>parameter for initial margin</p> |
| feeRate | <code>number</code> |  | <p>total fee rate to be applied on position notional</p> |
| slippageRate | <code>number</code> | <code></code> | <ul> <li></li> </ul> |

