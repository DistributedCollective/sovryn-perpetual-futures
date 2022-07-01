// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "./IPerpetualOrder.sol";

interface IPerpetualOrderManager is IPerpetualOrder {
    function cancelOrder(Order memory _order, bytes memory signature) external;
}
