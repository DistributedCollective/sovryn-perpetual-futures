// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IPerpetualWithdrawAllManager {
    function withdrawAll(bytes32 _iPerpetualId) external;
}
