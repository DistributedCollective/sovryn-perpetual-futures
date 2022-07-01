// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/modules/PerpetualTradeLogic.sol";
import "../perpetual/interfaces/IFunctionList.sol";
import "./IMockPerpetualTradeLogic.sol";
import "hardhat/console.sol";
import "./MockPerpetualTradeLogic.sol";

contract MockWithoutRestrictionPerpetualTradeLogic is MockPerpetualTradeLogic {
    function executeTrade(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _fTraderPos,
        int128 _fTradeAmount,
        int128 _fPrice,
        bool _isClose
    ) external override returns (int128) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _executeTrade(perpetual, _traderAddr, _fTraderPos, _fTradeAmount, _fPrice, _isClose);
    }

    function getFunctionList() external pure override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("MockWithoutRestrictionPerpetualTradeLogic");
        bytes4[] memory functionList = new bytes4[](1);
        functionList[0] = this.executeTrade.selector;
        return (functionList, moduleName);
    }
}
