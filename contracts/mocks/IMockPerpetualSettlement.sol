// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

//import "../perpetual/core/PerpStorage.sol";

interface IMockPerpetualSettlement {
    function clearNextTraderInPerpetual(bytes32 _iPerpetualId) external returns (bool);

    function clearTrader(bytes32 _iPerpetualId, address _traderAddr) external returns (bool);

    function countMargin(bytes32 _iPerpetualId, address _traderAddr) external;

    function getNextActiveAccount(bytes32 _iPerpetualId) external view returns (address);

    function setRedemptionRate(
        uint16 _poolId,
        int128 _fTotalMarginBalance,
        int128 _fTotalCapital
    ) external;

    function resetAccount(bytes32 _iPerpetualId, address _traderAddr) external;

    function getSettleableMargin(bytes32 _iPerpetualId, address _traderAddr) external view returns (int128);

    function prepareRedemption(
        uint16 _poolId,
        int128 _fTotalEmrgAMMMarginBalance,
        int128 _fTotalEmrgAMMFundCashCC
    ) external view returns (int128, int128);
}
