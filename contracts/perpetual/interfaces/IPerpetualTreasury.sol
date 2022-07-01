// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IPerpetualTreasury {
    function addLiquidity(uint16 _iPoolIndex, int128 _fTokenAmount) external;

    function addAMMLiquidityToPerpetual(bytes32 _iPerpetualId, int128 _fTokenAmount) external;

    function removeLiquidity(
        uint16 _iPoolIndex,
        int128 _fShareAmount) external;

    function addAmmGovernanceAddress(address _gAddress) external;

    function removeAmmGovernanceAddress(address _gAddress) external;

    function getTokenAmountToReturn(uint16 _poolId, int128 _fShareAmount) external view returns (int128);

    function getAmountForPeriod(uint16 _poolId, address _user) external view returns (int128);
}
