// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IPerpetualSettlement {
    function settleNextTraderInPool(uint16 _id) external returns (bool);

    function settle(bytes32 _perpetualID, address _traderAddr) external;
}
