// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "./IMockPerpetualTradeManager.sol";
import "../perpetual/modules/PerpetualTradeLogic.sol";
import "../perpetual/modules/PerpetualTradeManager.sol";
import "../libraries/Utils.sol";

contract MockPerpetualTradeManager is PerpetualTradeManager, IMockPerpetualTradeManager {
    function delegateDistributeFees(
        IPerpetualOrder.Order memory _order,
        bool _hasOpened
    ) external override returns (int128) {
        return _getTradeLogic().distributeFees(_order, _hasOpened);
    }

    function getFunctionList() external pure override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("MockPerpetualTradeManager");
        bytes4[] memory functionList = new bytes4[](1);
        functionList[0] = this.delegateDistributeFees.selector;
        return (functionList, moduleName);
    }
}
