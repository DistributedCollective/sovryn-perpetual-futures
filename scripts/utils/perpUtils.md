## Functions

<dl>
<dt><a href="#getMarkPrice">getMarkPrice(ammData)</a> ⇒ <code>number</code></dt>
<dd><p>Extract the mark-price from AMMState-data
Use most up to date price data, which can differ from stored value in contract</p></dd>
<dt><a href="#getIndexPrice">getIndexPrice(ammData)</a> ⇒ <code>number</code></dt>
<dd><p>Extract the index-price from AMMState-data
Use most up to date price data, which can differ from stored value in contract</p></dd>
<dt><a href="#getQuantoPrice">getQuantoPrice(ammData)</a> ⇒ <code>number</code></dt>
<dd><p>Extract the quanto-price from AMMState-data.
E.g., if ETHUSD backed in BTC, the BTCUSD price is the quanto-price
Use most up to date price data, which can differ from stored value in contract</p></dd>
<dt><a href="#getTradingFeeRate">getTradingFeeRate(perpParams)</a> ⇒ <code>number</code></dt>
<dd><p>Get the trading fee rate, so that fee = abs(position)*rate</p></dd>
<dt><a href="#getTradingFee">getTradingFee(number, perpParams)</a> ⇒ <code>number</code></dt>
<dd><p>Get trading fee in collateral currency</p></dd>
<dt><a href="#getInitialMarginRate">getInitialMarginRate(position, perpParams)</a> ⇒ <code>number</code></dt>
<dd><p>Get initial margin rate</p></dd>
<dt><a href="#getMaintenanceMarginRate">getMaintenanceMarginRate(position, perpParams)</a> ⇒ <code>number</code></dt>
<dd><p>Get maintenance margin rate
The margin requirement depends on the position size.</p></dd>
<dt><a href="#getMaxInitialLeverage">getMaxInitialLeverage(position, perpParams)</a> ⇒ <code>number</code></dt>
<dd><p>Get the maximal leverage that is allowed by the initial margin requirement.
The margin requirement depends on the position size.
Use this function:
to determine the max leverage for new and existing positions</p></dd>
<dt><a href="#getSignedMaxAbsPositionForTrader">getSignedMaxAbsPositionForTrader(direction, availableWalletBalance, perpParams, TraderState, ammData, poolData)</a> ⇒ <code>number</code></dt>
<dd><p>Get minimal short or maximal long position for a given trader. Assumes maximal leverage and no open positions for trader.
Direction=-1 for short, 1 for long
Assumes maximal leverage
This function calculates the largest position considering</p>
<ul>
<li>leverage constraints</li>
<li>position size constraint by AMM</li>
<li>available funds in wallet balance and margin account</li>
<li>slippage from mid-price</li>
</ul></dd>
<dt><a href="#getMaximalTradeSizeInPerpetual">getMaximalTradeSizeInPerpetual(currentPos, direction, liqPool, ammData, perpParams)</a> ⇒ <code>number</code></dt>
<dd><p>Get the maximal trade size for a trader with position currentPos (can be 0) for a given
perpetual, assuming enough margin is available (i.e. not considering leverage).</p></dd>
<dt><a href="#getMaximalTradeSizeInPerpetualWithCurrentMargin">getMaximalTradeSizeInPerpetualWithCurrentMargin(direction, availableWalletBalance, perpParams, TraderState, ammData, poolData)</a> ⇒ <code>number</code></dt>
<dd><p>Get maximal trade size for trader without adding additional margin.
Use this when changing position size, which does not add margin.
Direction=-1 for short, 1 for long
This function calculates the largest trade considering</p>
<ul>
<li>leverage constraints</li>
<li>position size constraint by AMM</li>
<li>available funds in margin account</li>
</ul></dd>
<dt><a href="#calculateSlippagePrice">calculateSlippagePrice(currentMidPrice, slippagePercent, direction)</a> ⇒ <code>number</code></dt>
<dd><p>Calculate the worst price, the trader is willing to accept compared to the provided price</p></dd>
<dt><a href="#calculateSlippagePriceFromMidPrice">calculateSlippagePriceFromMidPrice(perpParams, ammData, slippagePercent, direction)</a> ⇒ <code>number</code></dt>
<dd><p>Calculate the worst price, the trader is willing to accept compared to the mid-price calculated as the average
of price(+lot) and price(-lot)</p></dd>
<dt><a href="#getQuote2CollateralFX">getQuote2CollateralFX(ammData)</a> ⇒ <code>number</code></dt>
<dd><p>Conversion rate quote to collateral
Use most up to date price data</p></dd>
<dt><a href="#getBase2CollateralFX">getBase2CollateralFX(ammData, atMarkPrice)</a> ⇒ <code>number</code></dt>
<dd><p>Conversion rate base to collateral
Use most up to date price data</p></dd>
<dt><a href="#getBase2QuoteFX">getBase2QuoteFX(ammData, atMarkPrice)</a> ⇒ <code>number</code></dt>
<dd><p>Conversion rate base to quote
Use most up to date price data</p></dd>
<dt><a href="#calculateApproxLiquidationPrice">calculateApproxLiquidationPrice(traderState, ammData, perpParams, tradeSize, traderCashAddedCC)</a> ⇒ <code>number</code></dt>
<dd><p>Calculate the price at which the perpetual will be liquidated
Example 1: trader has zero position and wants to trade 1 BTC --&gt; tradeSize=1, traderCashAddedCC from getRequiredMarginCollateral
Example 2: trader has a position and wants to trade an additional 0.5 BTC --&gt; tradeSize=0.5, traderCashAddedCC from getRequiredMarginCollateral
Example 3: trader already traded and wants to know current liq price --&gt; tradeSize = 0, traderCashAddedCC = 0
current liquidation price:</p></dd>
<dt><a href="#getEstimatedMarginCollateralForLimitOrder">getEstimatedMarginCollateralForLimitOrder(perpParams, ammData, leverage, tradeSize, limitPrice, triggerPrice)</a> ⇒ <code>number</code></dt>
<dd><p>Provide a conservative estimate for the margin collateral required to close a leveraged stop/limit order.
The calculation would require the mark-price at execution and the index-price which are both unknown.</p></dd>
<dt><a href="#getRequiredMarginCollateral">getRequiredMarginCollateral(leverage, targetPos, perpParams, ammData, traderState, slippagePercent, accountForExistingMargin, accountForExistingPosition)</a> ⇒ <code>number</code></dt>
<dd><p>Get the amount of collateral required to obtain a given leverage with a given position size.
It accounts for trading fees, collateral already deposited, and slippage tolerance.</p></dd>
<dt><a href="#getMaximalMarginToWithdraw">getMaximalMarginToWithdraw(traderState, perpData, ammData)</a> ⇒</dt>
<dd><p>Maximal amount the trader can withdraw so that they still are initial margin safe</p>
<p>Uses prices based on the recent oracle data, which can differ from the contract's price entry.</p></dd>
<dt><a href="#getTraderPnL">getTraderPnL(traderState, ammData, perpParams, limitPrice)</a> ⇒ <code>number</code></dt>
<dd><p>Get the unrealized Profit/Loss of a trader using mark price as benchmark. Reported in Quote currency.</p></dd>
<dt><a href="#getTraderLeverage">getTraderLeverage(traderState, ammData)</a> ⇒ <code>number</code></dt>
<dd><p>Get the current leverage of a trader using mark price as benchmark.
See chapter &quot;Lemmas / Leverage&quot; in whitepaper</p></dd>
<dt><a href="#getTraderPnLInCC">getTraderPnLInCC(traderState, ammData, perpParams, price)</a> ⇒ <code>number</code></dt>
<dd><p>Get the unrealized Profit/Loss of a trader using a given exit price if specified, or the mark price otherwise.
Reported in collateral currency and includes upcoming funding payments.</p></dd>
<dt><a href="#getFundingFee">getFundingFee(traderState, perpData)</a> ⇒ <code>number</code></dt>
<dd><p>Get the unpaid, accumulated funding rate in collateral currency</p></dd>
<dt><a href="#getMidPrice">getMidPrice(perpData, ammData)</a> ⇒ <code>number</code></dt>
<dd><p>Get the mid-price based on 0 quantity (no bid-ask spread)
Uses the most recent index data (from Oracle), which might differ
from the stored data in the contract</p></dd>
<dt><a href="#getPrice">getPrice(tradeSize, perpData, ammData)</a> ⇒</dt>
<dd><p>Calculates the price using the most recent Oracle price data
(might differ from the oracle price stored in the contract)</p></dd>
<dt><a href="#getDepthMatrix">getDepthMatrix(perpData, ammData)</a> ⇒</dt>
<dd><p>Builds the depth matrix using the bid-ask spread to construct prices and trade amounts:</p>
<ul>
<li>Short prices are equi-spaced from the unit price of an infinitesimal short</li>
<li>Long prices are equi-spaced from the unit price of an infinitesimal long
e.g. for -0.4%, we find a trade amount k such that (price(-k) - price(-0)) / price(-0) = -0.4%
note that the mid-price is (price(+0) + price(-0)) / 2</li>
</ul>
<p>Uses prices based on the recent oracle data, which can differ from the contract's price entry.</p></dd>
<dt><a href="#isTraderMaintenanceMarginSafe">isTraderMaintenanceMarginSafe(traderState, perpData, ammData)</a> ⇒</dt>
<dd><p>Check whether trader is maintenance margin safe (i.e. cannot be liquidated yet)</p>
<p>Uses prices based on the recent oracle data, which can differ from the contract's price entry.</p></dd>
<dt><a href="#isTraderInitialMarginSafe">isTraderInitialMarginSafe(traderState, deltaCashCC, deltaPosBC, perpData, ammData)</a> ⇒</dt>
<dd><p>Check whether trader is initial margin safe (i.e. can increase position or withdraw margin)</p>
<p>Uses prices based on the recent oracle data, which can differ from the contract's price entry.</p></dd>
<dt><a href="#getMinimalSpread">getMinimalSpread(perpData, ammData)</a> ⇒</dt>
<dd><p>Return minimal spread that depends on Default Fund funding rate</p></dd>
<dt><a href="#getPerpetualCollateralType">getPerpetualCollateralType(ammData)</a> ⇒</dt>
<dd><p>internal function to get the type of collateral: quote, base, or quanto</p></dd>
<dt><a href="#calculateResultingPositionLeverage">calculateResultingPositionLeverage(traderState, ammState, perpParameters, orderSize, tradeLeverage, slippagePercent, keepPositionLeverage)</a> ⇒ <code>number</code></dt>
<dd><p>Calculates leverage of a resulting position.
It accounts for trading fees and current trader balance.
See also 'calculateLeverage'</p></dd>
<dt><a href="#calculateLeverage">calculateLeverage(targetPosition, targetMargin, traderState, ammState, perpParameters, slippagePercent)</a> ⇒ <code>number</code></dt>
<dd><p>Calculates leverage for new margin-collateral and position.
It accounts for trading fees and current trader balance.</p></dd>
<dt><a href="#getAverageEntryPrice">getAverageEntryPrice(traderState)</a> ⇒ <code>number</code></dt>
<dd><p>Calculates the average entry price for a given trader.
It returns NaN if the position is zero.</p></dd>
<dt><a href="#createOrderDigest">createOrderDigest(order, isNewOrder, managerAddress, chainId)</a> ⇒ <code>Promise.&lt;Buffer&gt;</code></dt>
<dd><p>Returns a digest for a limit or stop order (or its cancelation), that is to be signed.</p></dd>
<dt><a href="#getEstimatedMarginCollateralForTrader">getEstimatedMarginCollateralForTrader(perpParams, ammData, traderState)</a> ⇒ <code>number</code></dt>
<dd><p>Provides a conservative estimate of the margin needed for an order submitted by a trader,
conditional on all of the trader's open orders</p></dd>
<dt><a href="#getMinimalPositionSize">getMinimalPositionSize(PerpParameters)</a> ⇒ <code>number</code></dt>
<dd><p>Get the minimal position size for the perpetual</p></dd>
<dt><a href="#getMarginBalanceAtClosing">getMarginBalanceAtClosing(traderState, ammData, perpParams)</a> ⇒ <code>number</code></dt>
<dd><p>Get the margin balance of a given trader at closing in collateral currency.
Valuation is at AMM price, not mark price, and includes funding and trading fees.</p></dd>
</dl>

<a name="getMarkPrice"></a>

## getMarkPrice(ammData) ⇒ <code>number</code>
<p>Extract the mark-price from AMMState-data
Use most up to date price data, which can differ from stored value in contract</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>mark price</p>  

| Param | Type | Description |
| --- | --- | --- |
| ammData | <code>AMMState</code> | <p>Should contain current state of perpetual</p> |

<a name="getIndexPrice"></a>

## getIndexPrice(ammData) ⇒ <code>number</code>
<p>Extract the index-price from AMMState-data
Use most up to date price data, which can differ from stored value in contract</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>index price</p>  

| Param | Type | Description |
| --- | --- | --- |
| ammData | <code>AMMState</code> | <p>Should contain current state of perpetual</p> |

<a name="getQuantoPrice"></a>

## getQuantoPrice(ammData) ⇒ <code>number</code>
<p>Extract the quanto-price from AMMState-data.
E.g., if ETHUSD backed in BTC, the BTCUSD price is the quanto-price
Use most up to date price data, which can differ from stored value in contract</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>quanto price (non-zero if 3rd currency involved)</p>  

| Param | Type | Description |
| --- | --- | --- |
| ammData | <code>AMMState</code> | <p>Should contain current state of perpetual</p> |

<a name="getTradingFeeRate"></a>

## getTradingFeeRate(perpParams) ⇒ <code>number</code>
<p>Get the trading fee rate, so that fee = abs(position)*rate</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>fee relative to position size</p>  

| Param | Type | Description |
| --- | --- | --- |
| perpParams | <code>PerpParameters</code> | <p>Contains parameter of the perpetual</p> |

<a name="getTradingFee"></a>

## getTradingFee(number, perpParams) ⇒ <code>number</code>
<p>Get trading fee in collateral currency</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>fee relative to position size</p>  

| Param | Type | Description |
| --- | --- | --- |
| number | <code>deltaPosition</code> | <p>Traded amount</p> |
| perpParams | <code>PerpParameters</code> | <p>Contains parameter of the perpetual</p> |

<a name="getInitialMarginRate"></a>

## getInitialMarginRate(position, perpParams) ⇒ <code>number</code>
<p>Get initial margin rate</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>maintenance margin rate</p>  

| Param | Type | Description |
| --- | --- | --- |
| position | <code>number</code> | <p>The position for which we calculate the initial margin rate</p> |
| perpParams | <code>PerpParameters</code> | <p>Contains parameter of the perpetual</p> |

<a name="getMaintenanceMarginRate"></a>

## getMaintenanceMarginRate(position, perpParams) ⇒ <code>number</code>
<p>Get maintenance margin rate
The margin requirement depends on the position size.</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>maintenance margin rate</p>  

| Param | Type | Description |
| --- | --- | --- |
| position | <code>number</code> | <p>The position for which we calculate the maintenance margin rate</p> |
| perpParams | <code>PerpParameters</code> | <p>Contains parameter of the perpetual</p> |

<a name="getMaxInitialLeverage"></a>

## getMaxInitialLeverage(position, perpParams) ⇒ <code>number</code>
<p>Get the maximal leverage that is allowed by the initial margin requirement.
The margin requirement depends on the position size.
Use this function:
to determine the max leverage for new and existing positions</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>maximal leverage</p>  

| Param | Type | Description |
| --- | --- | --- |
| position | <code>number</code> | <p>The position for which we calculate the maximal initial leverage</p> |
| perpParams | <code>PerpParameters</code> | <p>Contains parameter of the perpetual</p> |

<a name="getSignedMaxAbsPositionForTrader"></a>

## getSignedMaxAbsPositionForTrader(direction, availableWalletBalance, perpParams, TraderState, ammData, poolData) ⇒ <code>number</code>
<p>Get minimal short or maximal long position for a given trader. Assumes maximal leverage and no open positions for trader.
Direction=-1 for short, 1 for long
Assumes maximal leverage
This function calculates the largest position considering</p>
<ul>
<li>leverage constraints</li>
<li>position size constraint by AMM</li>
<li>available funds in wallet balance and margin account</li>
<li>slippage from mid-price</li>
</ul>

**Kind**: global function  
**Returns**: <code>number</code> - <p>position-size in base-currency</p>  

| Param | Type | Description |
| --- | --- | --- |
| direction | <code>number</code> | <p>{-1, 1} Does the trader want to buy (1), or sell (-1)</p> |
| availableWalletBalance | <code>number</code> | <p>trader's available wallet balance</p> |
| perpParams | <code>PerpParameters</code> | <p>Contains parameter of the perpetual</p> |
| TraderState | <code>traderState</code> | <p>Contains trader state data</p> |
| ammData | <code>AMMState</code> | <p>Contains amm state data</p> |
| poolData | <code>LiqPoolState</code> | <p>Contains liq pool state data</p> |

<a name="getMaximalTradeSizeInPerpetual"></a>

## getMaximalTradeSizeInPerpetual(currentPos, direction, liqPool, ammData, perpParams) ⇒ <code>number</code>
<p>Get the maximal trade size for a trader with position currentPos (can be 0) for a given
perpetual, assuming enough margin is available (i.e. not considering leverage).</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>signed position size that the trader can enter</p>  

| Param | Type | Description |
| --- | --- | --- |
| currentPos | <code>number</code> | <p>The current position of the trade (base currency), negative if short</p> |
| direction | <code>number</code> | <p>{-1, 1} Does the trader want to buy (1), or sell (-1)</p> |
| liqPool | <code>LiqPoolState</code> | <p>Contains current liq pool state data</p> |
| ammData | <code>AMMState</code> | <p>Contains current price/state data</p> |
| perpParams | <code>PerpParameters</code> | <p>Contains parameter of the perpetual</p> |

<a name="getMaximalTradeSizeInPerpetualWithCurrentMargin"></a>

## getMaximalTradeSizeInPerpetualWithCurrentMargin(direction, availableWalletBalance, perpParams, TraderState, ammData, poolData) ⇒ <code>number</code>
<p>Get maximal trade size for trader without adding additional margin.
Use this when changing position size, which does not add margin.
Direction=-1 for short, 1 for long
This function calculates the largest trade considering</p>
<ul>
<li>leverage constraints</li>
<li>position size constraint by AMM</li>
<li>available funds in margin account</li>
</ul>

**Kind**: global function  
**Returns**: <code>number</code> - <p>maintenance margin rate</p>  

| Param | Type | Description |
| --- | --- | --- |
| direction | <code>number</code> | <p>{-1, 1} Does the trader want to buy (1), or sell (-1)</p> |
| availableWalletBalance | <code>number</code> | <p>trader's available wallet balance</p> |
| perpParams | <code>PerpParameters</code> | <p>Contains parameter of the perpetual</p> |
| TraderState | <code>traderState</code> | <p>Contains trader state data</p> |
| ammData | <code>AMMState</code> | <p>Contains amm state data</p> |
| poolData | <code>LiqPoolState</code> | <p>Contains liq pool state data</p> |

<a name="calculateSlippagePrice"></a>

## calculateSlippagePrice(currentMidPrice, slippagePercent, direction) ⇒ <code>number</code>
<p>Calculate the worst price, the trader is willing to accept compared to the provided price</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>worst acceptable price</p>  

| Param | Type | Description |
| --- | --- | --- |
| currentMidPrice | <code>number</code> | <p>The current price from which we calculate the slippage</p> |
| slippagePercent | <code>number</code> | <p>The slippage that the trader is willing to accept. The number is in decimals (0.01=1%).</p> |
| direction | <code>number</code> | <p>{-1, 1} Does the trader want to buy (1), or sell (-1)</p> |

<a name="calculateSlippagePriceFromMidPrice"></a>

## calculateSlippagePriceFromMidPrice(perpParams, ammData, slippagePercent, direction) ⇒ <code>number</code>
<p>Calculate the worst price, the trader is willing to accept compared to the mid-price calculated as the average
of price(+lot) and price(-lot)</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>worst acceptable price</p>  

| Param | Type | Description |
| --- | --- | --- |
| perpParams | <code>PerpParameters</code> | <p>Perpetual Parameters</p> |
| ammData | <code>AMMState</code> | <p>AMM state data</p> |
| slippagePercent | <code>number</code> | <p>The slippage that the trader is willing to accept. The number is in decimals (0.01=1%).</p> |
| direction | <code>number</code> | <p>{-1, 1} Does the trader want to buy (1), or sell (-1)</p> |

<a name="getQuote2CollateralFX"></a>

## getQuote2CollateralFX(ammData) ⇒ <code>number</code>
<p>Conversion rate quote to collateral
Use most up to date price data</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>conversion rate</p>  

| Param | Type | Description |
| --- | --- | --- |
| ammData | <code>AMMState</code> | <p>Contains current price/state data</p> |

<a name="getBase2CollateralFX"></a>

## getBase2CollateralFX(ammData, atMarkPrice) ⇒ <code>number</code>
<p>Conversion rate base to collateral
Use most up to date price data</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>conversion rate</p>  

| Param | Type | Description |
| --- | --- | --- |
| ammData | <code>AMMState</code> | <p>Contains current price/state data</p> |
| atMarkPrice | <code>boolean</code> | <p>conversion at spot or mark price</p> |

<a name="getBase2QuoteFX"></a>

## getBase2QuoteFX(ammData, atMarkPrice) ⇒ <code>number</code>
<p>Conversion rate base to quote
Use most up to date price data</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>conversion rate</p>  

| Param | Type | Description |
| --- | --- | --- |
| ammData | <code>AMMState</code> | <p>Contains current price/state data</p> |
| atMarkPrice | <code>boolean</code> | <p>conversion at spot or mark price</p> |

<a name="calculateApproxLiquidationPrice"></a>

## calculateApproxLiquidationPrice(traderState, ammData, perpParams, tradeSize, traderCashAddedCC) ⇒ <code>number</code>
<p>Calculate the price at which the perpetual will be liquidated
Example 1: trader has zero position and wants to trade 1 BTC --&gt; tradeSize=1, traderCashAddedCC from getRequiredMarginCollateral
Example 2: trader has a position and wants to trade an additional 0.5 BTC --&gt; tradeSize=0.5, traderCashAddedCC from getRequiredMarginCollateral
Example 3: trader already traded and wants to know current liq price --&gt; tradeSize = 0, traderCashAddedCC = 0
current liquidation price:</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>approximate liquidation price</p>  

| Param | Type | Description |
| --- | --- | --- |
| traderState | <code>TraderState</code> | <p>Trader state (perpQueries.queryTraderState)</p> |
| ammData | <code>AMMState</code> | <p>AMM state</p> |
| perpParams | <code>PerpParameters</code> | <p>Contains parameter of the perpetual</p> |
| tradeSize | <code>number</code> | <p>The trade size (base currency), negative if short</p> |
| traderCashAddedCC | <code>number</code> | <p>Cash of the trader that is added to the perpetual margin account if the trader trades use getRequiredMarginCollateral</p> |

<a name="getEstimatedMarginCollateralForLimitOrder"></a>

## getEstimatedMarginCollateralForLimitOrder(perpParams, ammData, leverage, tradeSize, limitPrice, triggerPrice) ⇒ <code>number</code>
<p>Provide a conservative estimate for the margin collateral required to close a leveraged stop/limit order.
The calculation would require the mark-price at execution and the index-price which are both unknown.</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>estimated margin balance to be approved for the wallet and contract</p>  

| Param | Type | Description |
| --- | --- | --- |
| perpParams | <code>PerpParameters</code> | <p>Contains parameter of the perpetual</p> |
| ammData | <code>AMMState</code> | <p>AMM state</p> |
| leverage | <code>number</code> | <p>The leverage that the trader wants to achieve, given the position size</p> |
| tradeSize | <code>number</code> | <p>The trader's (signed) trade size in base currency</p> |
| limitPrice | <code>number</code> | <p>limit price. Required for both stop orders and limit orders</p> |
| triggerPrice | <code>boolean</code> | <p>null or triggerPrice, required for stop orders</p> |

<a name="getRequiredMarginCollateral"></a>

## getRequiredMarginCollateral(leverage, targetPos, perpParams, ammData, traderState, slippagePercent, accountForExistingMargin, accountForExistingPosition) ⇒ <code>number</code>
<p>Get the amount of collateral required to obtain a given leverage with a given position size.
It accounts for trading fees, collateral already deposited, and slippage tolerance.</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>balance required to arrive at the perpetual contract to obtain requested leverage</p>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| leverage | <code>number</code> |  | <p>The leverage that the trader wants to achieve, given the position size</p> |
| targetPos | <code>number</code> |  | <p>The trader's (signed) target position in base currency</p> |
| perpParams | <code>PerpParameters</code> |  | <p>Contains parameter of the perpetual</p> |
| ammData | <code>AMMState</code> |  | <p>AMM state</p> |
| traderState | <code>TraderState</code> |  | <p>Trader state</p> |
| slippagePercent | <code>number</code> | <code>0</code> | <p>optional. Specify slippage compared to mid-price that the trader is willing to accept</p> |
| accountForExistingMargin | <code>boolean</code> | <code>true</code> | <p>optional, default true. subtracts existing margin and clamp to 0</p> |
| accountForExistingPosition | <code>boolean</code> | <code>true</code> | <p>optional, default true. If false, the margin for a trade is calculated</p> |

<a name="getMaximalMarginToWithdraw"></a>

## getMaximalMarginToWithdraw(traderState, perpData, ammData) ⇒
<p>Maximal amount the trader can withdraw so that they still are initial margin safe</p>
<p>Uses prices based on the recent oracle data, which can differ from the contract's price entry.</p>

**Kind**: global function  
**Returns**: <p>An array containing [prices, % deviation from mid price ((price - mid-price)/mid-price), trade amounts]</p>  

| Param | Type | Description |
| --- | --- | --- |
| traderState | <code>TraderState</code> | <p>Trader state (for account balances)</p> |
| perpData | <code>PerpParameters</code> | <p>Perpetual data</p> |
| ammData | <code>AMMState</code> | <p>AMM data</p> |

<a name="getTraderPnL"></a>

## getTraderPnL(traderState, ammData, perpParams, limitPrice) ⇒ <code>number</code>
<p>Get the unrealized Profit/Loss of a trader using mark price as benchmark. Reported in Quote currency.</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>PnL = value of position at mark price minus locked in value</p>  

| Param | Type | Description |
| --- | --- | --- |
| traderState | <code>TraderState</code> | <p>Trader state (for account balances)</p> |
| ammData | <code>AMMState</code> | <p>AMM state (for mark price and CCY conversion)</p> |
| perpParams | <code>PerpParameters</code> | <p>Contains parameter of the perpetual</p> |
| limitPrice | <code>number</code> | <p>optional exit price for which the PnL should be calculated</p> |

<a name="getTraderLeverage"></a>

## getTraderLeverage(traderState, ammData) ⇒ <code>number</code>
<p>Get the current leverage of a trader using mark price as benchmark.
See chapter &quot;Lemmas / Leverage&quot; in whitepaper</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>current leverage for the trader</p>  

| Param | Type | Description |
| --- | --- | --- |
| traderState | <code>TraderState</code> | <p>Trader state (for account balances)</p> |
| ammData | <code>AMMState</code> | <p>AMM state (for mark price and CCY conversion)</p> |

<a name="getTraderPnLInCC"></a>

## getTraderPnLInCC(traderState, ammData, perpParams, price) ⇒ <code>number</code>
<p>Get the unrealized Profit/Loss of a trader using a given exit price if specified, or the mark price otherwise.
Reported in collateral currency and includes upcoming funding payments.</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>PnL = value of position at mark price minus locked in value</p>  

| Param | Type | Description |
| --- | --- | --- |
| traderState | <code>TraderState</code> | <p>Trader state (for account balances)</p> |
| ammData | <code>AMMState</code> | <p>AMM state (for mark price and CCY conversion)</p> |
| perpParams | <code>PerpParameters</code> | <p>Contains parameter of the perpetual</p> |
| price | <code>number</code> | <p>optional exit price for which the PnL should be calculated</p> |

<a name="getFundingFee"></a>

## getFundingFee(traderState, perpData) ⇒ <code>number</code>
<p>Get the unpaid, accumulated funding rate in collateral currency</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>PnL = value of position at mark price minus locked in value</p>  

| Param | Type | Description |
| --- | --- | --- |
| traderState | <code>TraderState</code> | <p>Trader state (for account balances)</p> |
| perpData | <code>PerpParameters</code> | <p>Perp parameters</p> |

<a name="getMidPrice"></a>

## getMidPrice(perpData, ammData) ⇒ <code>number</code>
<p>Get the mid-price based on 0 quantity (no bid-ask spread)
Uses the most recent index data (from Oracle), which might differ
from the stored data in the contract</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>PnL = value of position at mark price minus locked in value</p>  

| Param | Type | Description |
| --- | --- | --- |
| perpData | <code>PerpParameters</code> | <p>Perp parameters</p> |
| ammData | <code>AMMState</code> | <p>AMM state (for mark price and CCY conversion)</p> |

<a name="getPrice"></a>

## getPrice(tradeSize, perpData, ammData) ⇒
<p>Calculates the price using the most recent Oracle price data
(might differ from the oracle price stored in the contract)</p>

**Kind**: global function  
**Returns**: <p>An array containing [prices, % deviation from mid price ((price - mid-price)/mid-price), trade amounts]</p>  

| Param | Type | Description |
| --- | --- | --- |
| tradeSize | <code>number</code> | <p>size of the trade</p> |
| perpData | <code>PerpParameters</code> | <p>Perpetual data</p> |
| ammData | <code>AMMState</code> | <p>AMM data</p> |

<a name="getDepthMatrix"></a>

## getDepthMatrix(perpData, ammData) ⇒
<p>Builds the depth matrix using the bid-ask spread to construct prices and trade amounts:</p>
<ul>
<li>Short prices are equi-spaced from the unit price of an infinitesimal short</li>
<li>Long prices are equi-spaced from the unit price of an infinitesimal long
e.g. for -0.4%, we find a trade amount k such that (price(-k) - price(-0)) / price(-0) = -0.4%
note that the mid-price is (price(+0) + price(-0)) / 2</li>
</ul>
<p>Uses prices based on the recent oracle data, which can differ from the contract's price entry.</p>

**Kind**: global function  
**Returns**: <p>An array containing [prices, % deviation from mid price ((price - mid-price)/mid-price), trade amounts]</p>  

| Param | Type | Description |
| --- | --- | --- |
| perpData | <code>PerpParameters</code> | <p>Perpetual data</p> |
| ammData | <code>AMMState</code> | <p>AMM data</p> |

<a name="isTraderMaintenanceMarginSafe"></a>

## isTraderMaintenanceMarginSafe(traderState, perpData, ammData) ⇒
<p>Check whether trader is maintenance margin safe (i.e. cannot be liquidated yet)</p>
<p>Uses prices based on the recent oracle data, which can differ from the contract's price entry.</p>

**Kind**: global function  
**Returns**: <p>An array containing [prices, % deviation from mid price ((price - mid-price)/mid-price), trade amounts]</p>  

| Param | Type | Description |
| --- | --- | --- |
| traderState | <code>TraderState</code> | <p>Trader state (for account balances)</p> |
| perpData | <code>PerpParameters</code> | <p>Perpetual data</p> |
| ammData | <code>AMMState</code> | <p>AMM data</p> |

<a name="isTraderInitialMarginSafe"></a>

## isTraderInitialMarginSafe(traderState, deltaCashCC, deltaPosBC, perpData, ammData) ⇒
<p>Check whether trader is initial margin safe (i.e. can increase position or withdraw margin)</p>
<p>Uses prices based on the recent oracle data, which can differ from the contract's price entry.</p>

**Kind**: global function  
**Returns**: <p>An array containing [prices, % deviation from mid price ((price - mid-price)/mid-price), trade amounts]</p>  

| Param | Type | Description |
| --- | --- | --- |
| traderState | <code>TraderState</code> | <p>Trader state (for account balances)</p> |
| deltaCashCC | <code>number</code> | <p>requested change in margin cash in collateral currency (plus to add, minus to remove)</p> |
| deltaPosBC | <code>number</code> | <p>requested change in position size (plus to add, minus to remove)</p> |
| perpData | <code>PerpParameters</code> | <p>Perpetual data</p> |
| ammData | <code>AMMState</code> | <p>AMM data</p> |

<a name="getMinimalSpread"></a>

## getMinimalSpread(perpData, ammData) ⇒
<p>Return minimal spread that depends on Default Fund funding rate</p>

**Kind**: global function  
**Returns**: <p>minimal bid-ask spread</p>  

| Param | Type | Description |
| --- | --- | --- |
| perpData | <code>PerpParameters</code> | <p>Perpetual data</p> |
| ammData | <code>AMMState</code> | <p>AMM data</p> |

<a name="getPerpetualCollateralType"></a>

## getPerpetualCollateralType(ammData) ⇒
<p>internal function to get the type of collateral: quote, base, or quanto</p>

**Kind**: global function  
**Returns**: <p>COLLATERAL_CURRENCY_BASE | COLLATERAL_CURRENCY_QUOTE | COLLATERAL_CURRENCY_QUANTO</p>  

| Param | Type | Description |
| --- | --- | --- |
| ammData | <code>AMMState</code> | <p>AMM data</p> |

<a name="calculateResultingPositionLeverage"></a>

## calculateResultingPositionLeverage(traderState, ammState, perpParameters, orderSize, tradeLeverage, slippagePercent, keepPositionLeverage) ⇒ <code>number</code>
<p>Calculates leverage of a resulting position.
It accounts for trading fees and current trader balance.
See also 'calculateLeverage'</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>leverage of resulting position after trade</p>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| traderState | <code>TraderState</code> |  |  |
| ammState | <code>AMMState</code> |  |  |
| perpParameters | <code>PerpParameters</code> |  |  |
| orderSize | <code>number</code> |  | <p>signed order size (coll.curr.)</p> |
| tradeLeverage | <code>number</code> |  | <p>leverage of trade (order)</p> |
| slippagePercent | <code>number</code> | <code>0</code> | <p>slippage tolerance, in decimals (1% is 0.01)</p> |
| keepPositionLeverage | <code>boolean</code> | <code>false</code> | <p>if true it returns the existing position leverage</p> |

<a name="calculateLeverage"></a>

## calculateLeverage(targetPosition, targetMargin, traderState, ammState, perpParameters, slippagePercent) ⇒ <code>number</code>
<p>Calculates leverage for new margin-collateral and position.
It accounts for trading fees and current trader balance.</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>current leverage for the trader</p>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| targetPosition | <code>number</code> |  | <p>new target position size, in base currency</p> |
| targetMargin | <code>number</code> |  | <p>new margin collateral after trade, in collateral currency</p> |
| traderState | <code>TraderState</code> |  | <p>trader state</p> |
| ammState | <code>AMMState</code> |  | <p>AMM state</p> |
| perpParameters | <code>PerpParameters</code> |  | <p>perp parameters</p> |
| slippagePercent | <code>number</code> | <code>0</code> | <p>slippage percent</p> |

<a name="getAverageEntryPrice"></a>

## getAverageEntryPrice(traderState) ⇒ <code>number</code>
<p>Calculates the average entry price for a given trader.
It returns NaN if the position is zero.</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>Average entry price: | locked-in-value / position-size |</p>  

| Param | Type |
| --- | --- |
| traderState | <code>TraderState</code> | 

<a name="createOrderDigest"></a>

## createOrderDigest(order, isNewOrder, managerAddress, chainId) ⇒ <code>Promise.&lt;Buffer&gt;</code>
<p>Returns a digest for a limit or stop order (or its cancelation), that is to be signed.</p>

**Kind**: global function  
**Returns**: <code>Promise.&lt;Buffer&gt;</code> - <p>signed order or signed cancelation of order</p>  

| Param | Type | Description |
| --- | --- | --- |
| order | <code>Order</code> | <p>order-struct to be signed</p> |
| isNewOrder | <code>boolean</code> | <p>true for order placement, fals for order cancellation</p> |
| managerAddress | <code>string</code> | <p>address of perpetual-manager</p> |
| chainId | <code>number</code> | <p>Chain ID for current network</p> |

<a name="getEstimatedMarginCollateralForTrader"></a>

## getEstimatedMarginCollateralForTrader(perpParams, ammData, traderState) ⇒ <code>number</code>
<p>Provides a conservative estimate of the margin needed for an order submitted by a trader,
conditional on all of the trader's open orders</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>Approximate margin collateral needed to fulfill all existing orders for trader</p>  

| Param | Type |
| --- | --- |
| perpParams | <code>PerpParameters</code> | 
| ammData | <code>AMMState</code> | 
| traderState | <code>TraderState</code> | 

<a name="getMinimalPositionSize"></a>

## getMinimalPositionSize(PerpParameters) ⇒ <code>number</code>
<p>Get the minimal position size for the perpetual</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>(Global min num lots per position) x (Perpetual lot size)</p>  

| Param | Type |
| --- | --- |
| PerpParameters | <code>perpParameters</code> | 

<a name="getMarginBalanceAtClosing"></a>

## getMarginBalanceAtClosing(traderState, ammData, perpParams) ⇒ <code>number</code>
<p>Get the margin balance of a given trader at closing in collateral currency.
Valuation is at AMM price, not mark price, and includes funding and trading fees.</p>

**Kind**: global function  
**Returns**: <code>number</code> - <p>Best approximation of the margin the trader would get if closing immediately.</p>  

| Param | Type | Description |
| --- | --- | --- |
| traderState | <code>TraderState</code> | <p>Trader state (for account balances)</p> |
| ammData | <code>AMMState</code> | <p>AMM state (for mark price and CCY conversion)</p> |
| perpParams | <code>PerpParameters</code> | <p>Contains parameter of the perpetual</p> |

