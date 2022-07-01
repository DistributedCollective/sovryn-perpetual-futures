// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "./IPerpetualOrder.sol";

interface IPerpetualTradeManager is IPerpetualOrder {
    function trade(Order memory _order) external;
}
