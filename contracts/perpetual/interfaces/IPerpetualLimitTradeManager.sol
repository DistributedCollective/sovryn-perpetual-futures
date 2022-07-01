// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "./IPerpetualOrder.sol";

interface IPerpetualLimitTradeManager is IPerpetualOrder {
    function tradeBySig(Order memory _order, bytes memory signature) external;
}
