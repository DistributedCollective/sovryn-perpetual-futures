// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "./IPerpetualOrder.sol";

interface IPerpetualMarginViewLogic is IPerpetualOrder {
    function calcMarginForTargetLeverage(
        bytes32 _iPerpetualId,
        int128 _fTraderPos,
        int128 _fPrice,
        int128 _fTradeAmountBC,
        int128 _fTargetLeverage,
        address _traderAddr,
        bool _ignorePosBalance
    ) external view returns (int128);

    function getMarginBalance(bytes32 _iPerpetualId, address _traderAddr) external view returns (int128);

    function isMaintenanceMarginSafe(bytes32 _iPerpetualId, address _traderAddr) external view returns (bool);

    function getAvailableMargin(
        bytes32 _iPerpetualId,
        address _traderAddr,
        bool _isInitialMargin
    ) external view returns (int128);

    function isInitialMarginSafe(bytes32 _iPerpetualId, address _traderAddr) external view returns (bool);

    function getInitialMargin(bytes32 _iPerpetualId, address _traderAddr) external view returns (int128);

    function getMaintenanceMargin(bytes32 _iPerpetualId, address _traderAddr) external view returns (int128);

    function isMarginSafe(bytes32 _iPerpetualId, address _traderAddr) external view returns (bool);
}
