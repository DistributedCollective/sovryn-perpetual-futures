// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IMockPerpetualTreasury {
    function mintShareTokens(
        uint16 _poolId,
        address _account,
        uint256 _amount
    ) external;

    function getShareAmountToMint(uint16 _poolId, int128 _fAmount) external view returns (int128);

    function checkWithdrawalRestrictions(
        uint16 _poolId,
        address _user,
        int128 _fAmount
    ) external;
}
