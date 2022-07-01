// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/core/PerpStorage.sol";
import "../perpetual/interfaces/IPerpetualOrder.sol";

interface IMockPerpetualTradeManager {
    function delegateDistributeFees(
        IPerpetualOrder.Order memory _order,
        bool _hasOpened
    ) external returns (int128);
}
