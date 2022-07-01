// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IPerpetualRebalanceLogic {
    function rebalance(bytes32 _iPerpetualId) external;
}
