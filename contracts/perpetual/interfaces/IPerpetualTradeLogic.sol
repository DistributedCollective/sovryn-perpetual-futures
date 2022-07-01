// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;
import "../interfaces/IPerpetualOrder.sol";

interface IPerpetualTradeLogic {
    function executeTrade(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _fTraderPos,
        int128 _fTradeAmount,
        int128 _fPrice,
        bool _isClose
    ) external returns (int128);

    function preTrade(
        bytes32 _iPerpetualId,
        IPerpetualOrder.Order memory _order
    ) external returns (int128, int128);

    function distributeFeesNoRef(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _fDeltaPositionBC,
        bool _hasOpened
    ) external returns (int128);

    function distributeFees(
        IPerpetualOrder.Order memory _order,
        bool _hasOpened
    ) external returns (int128);

    function validateStopPrice(
        bool _isLong,
        int128 _fMarkPrice,
        int128 _fTriggerPrice
    ) external pure;

    function getMaxSignedTradeSizeForPos(
        bytes32 _perpetualId,
        int128 _fCurrentTraderPos,
        int128 fTradeAmountBC
    ) external view returns (int128);
}
