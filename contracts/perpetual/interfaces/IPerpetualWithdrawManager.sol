// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IPerpetualWithdrawManager {
    function withdraw(bytes32 _iPerpetualId, int128 _fAmount) external;
}
