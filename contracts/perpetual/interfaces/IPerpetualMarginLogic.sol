// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "./IPerpetualOrder.sol";

interface IPerpetualMarginLogic is IPerpetualOrder {
    function depositMarginForOpeningTrade(
        bytes32 _iPerpetualId,
        int128 _fDepositRequired,
        Order memory _order
    ) external returns (bool);

    function withdrawDepositFromMarginAccount(bytes32 _iPerpetualId, address _traderAddr) external;

    function reduceMarginCollateral(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _fAmountToWithdraw
    ) external;
}
