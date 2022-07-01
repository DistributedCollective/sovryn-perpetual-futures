# Stop Loss / Take Profit Orders
In addition to limit orders we want the traders to be
able to enter take profit and stop loss orders.

A form of *take profit orders* for long positions can be achieved by creating a limit order that has an opposite position size (sell order) and a limit price higher than the current market price.

*Example: we buy BTC at 40k
and want to take profit at 45k. So after buying at 40k, 
we enter a sell limit order for 45k.* 

For short positions, the opposite holds, that is, we create
a buy limit order with a limit price lower than the current market price.

In contrast, *stop loss orders* cannot be emulated with limit orders
as we explain below. Therefore,
after a detailed explanation of these statements, the rest of this section focuses on stop loss orders.

### Explanation stop loss
We assume we have a long or short position and want to enter
an order that provides us loss protection (stop loss):

|  | **We are long** | **We are short** |
|---|---|---|
|**Stop loss**| *sell* if markprice < trigger | *buy* if markprice > trigger |

We cannot place any of these orders as limit orders at the moment when we want to post them: (1) our desired price for the sell order is lower than current price so the order would
be filled immediately, (2) our desired price for the buy order is higher than current price so the order would be filled immediately
Hence, we need a different order type that is only executed once
a trigger price is reached.

### Explanation take profit
We assume we have a long or short position and want to enter
an order that closes our position at a profit once the
price moved (take profit):

|  | **We are long** | **We are short** |
|---|---|---|
|**Take profit**| *sell* if markprice > trigger | *buy* if markprice < trigger |

To achieve this, we can place a limit order: (1) We are long and place a
short order (opposite direction) with a higher limit price.
The order will only be executed once market prices moved up and people
are willing to buy a higher amount.
(2) We are short and place a long order (opposite direction) with a lower
limit price. The order will only be executed once market prices dropped
and people are willing to sell at a lower price.
Hence we can emulate take profit orders with limit orders.

## Summary Stop Orders
We now summarize the main choices and provide more details for 
each decision in the following paragraphs.

*Stop loss orders* require a new type of order that is only executable,
once the 'relevant' price (for example the mid-price, alternatively
the index price, or mark-price) reaches a threshold or trigger price.

We implement *stop orders*, instead of *stop loss orders*. The former is not tied to another position. The reason is that *stop orders* are more general and the blockchain implementation is simpler.

The *relevant price* for stop orders is the *mark price*. The mark price
is a moving average of the mid-price and therefore less volatile than
the mid-price or index price, hence price spikes will not trigger a stop order execution. The mark price is typically closer to the potential execution price than the index price.

The *trigger* is memoryless, meaning that if the mark price
met the trigger condition for a period of time but the order was
not executed, the order cannot
be executed if the trigger condition is no longer fulfilled.
This differs from some exchanges (e.g., Binance) but saves on
required incentivation fees and to some minds is even more intuitive.

In addition to the trigger price, the trader also provides a *limit price*
for stop orders. For a stop sell order,
the order is only executed if the mark price is below the trigger
price, and the execution price is above the limit price. Both
conditions have to be met. Accordingly, for a stop buy order, the
order is only executed if the mark price is above the trigger price,
and the execution price is below the limit price.



## Why decoupled stop orders

We offer *stop orders* that are not tied to the original position,
meaning that if the user creates a market order and wants to limit
their potential loss on this order, 
they create one or several stop orders
that will not be cancelled if the original market order was closed.

There are two reasons why this choice is very flexible.

(1) The trader might want to enter a stop order without having a
positon tied to it. For example, ''buy if BTC drops below X''.

(2) Traders would want to split a given order in separate stop loss
orders. For example, from a position of 1 BTC the trader may wish to
close half of it at a price drop of 5% and the rest at a drop of 10%
compared to the purchase price. 

## Memoryless Trigger and Execution Price

The execution should be triggered only once the
mark price reaches a given threshold. At the same time,
the trader does not accept unlimited slippage. 
Instead of defining a slippage percentage and a price
to what that slippage applies to, we directly 
require the user to provide a limit price.

Only if both conditions (limit price and trigger price)
are met, the order can be executed:


|  |**Action**| **Condition 1** | **Condition 2** |
|---|---|---|---|
|**Stop Buy** | Buy if | markprice > trigger | execution price < limit price |
|**Stop Sell** | Sell if | markprice < trigger | execution price > limit price |