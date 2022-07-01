// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IPerpetualDepositManager {
    function deposit(bytes32 _iPerpetualId, int128 _fAmount) external;

    function depositToDefaultFund(uint16 _poolId, int128 _fAmount) external;

    function withdrawFromDefaultFund(
        uint16 _poolId,
        address _receiver,
        int128 _fAmount
    ) external;

    function transferEarningsToTreasury(uint16 _poolId, int128 _fAmount) external;
}
