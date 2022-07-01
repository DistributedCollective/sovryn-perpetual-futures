// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/modules/PerpetualTradeLogic.sol";
import "../perpetual/interfaces/IFunctionList.sol";
import "./IMockPerpetualTradeLogic.sol";
import "./IMockSOVLibraryEvents.sol";
import "../libraries/ConverterDec18.sol";
import "../libraries/Utils.sol";

contract MockAddEventsPerpetualTradeLogic is
    PerpetualTradeLogic, /*, IPerpetualUpdateLogic*/
    IMockSOVLibraryEvents
{
    using ConverterDec18 for int128;
    using ConverterDec18 for int256;

    function distributeFees(
        IPerpetualOrder.Order memory _order,
        bool _hasOpened
    ) external override returns (int128) {
        emit MockDistributeFees(_order.iPerpetualId, _order.traderAddr, _order.referrerAddr, _order.fAmount, _hasOpened);
        return 0;
    }

    /*function getFunctionList() external pure override returns (bytes4[] memory, bytes32) {
        bytes4[] memory functionList = new bytes4[](7);
        functionList[0] = this.preTrade.selector;
        functionList[1] = this.getMaxTradeSizesForPos.selector;
        functionList[2] = this.executeTrade.selector;
        functionList[3] = this.updateAMMTargetPoolSize.selector;
        functionList[4] = this.updateFundingAndPricesBefore.selector;
        functionList[5] = this.updateFundingAndPricesAfter.selector;
        functionList[6] = this.distributeFees.selector;
        return (functionList, moduleName);
    }*/
    function getFunctionList() external pure override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("MockAddEventsPerpetualTradeLogic");
        bytes4[] memory functionList = new bytes4[](4);
        functionList[0] = this.executeTrade.selector;
        functionList[1] = this.preTrade.selector;
        functionList[2] = this.distributeFees.selector;
        functionList[3] = this.getMaxSignedTradeSizeForPos.selector;
        return (functionList, moduleName);
    }
}
