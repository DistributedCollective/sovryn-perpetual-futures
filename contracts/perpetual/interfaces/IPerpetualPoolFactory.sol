// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IPerpetualPoolFactory {
    function setPerpetualPoolFactory(address _shareTokenFactory) external;

    function createLiquidityPool(
        address _treasuryAddress,
        address _marginTokenAddress,
        uint64 _iTargetPoolSizeUpdateTime,
        uint64 _iPnLparticipantWithdrawalPeriod,
        int128 _fPnLparticipantWithdrawalPercentageLimit,
        int128 _fPnLparticipantWithdrawalMinAmountLimit,
        int128 _fMaxTotalTraderFunds
    ) external returns (uint16);

    function runLiquidityPool(uint16 _liqPoolID) external;

    function setAMMPerpLogic(address _AMMPerpLogic) external;

    function setTreasury(uint16 _liqPoolID, address _treasury) external;

    function setTargetPoolSizeUpdateTime(uint16 _poolId, uint64 _iTargetPoolSizeUpdateTime) external;

    function setWithdrawalLimit(
        uint16 _poolId,
        uint64 _iPnLparticipantWithdrawalPeriod,
        int128 _fPnLparticipantWithdrawalPercentageLimit,
        int128 _fPnLparticipantWithdrawalMinAmountLimit
    ) external;
}
