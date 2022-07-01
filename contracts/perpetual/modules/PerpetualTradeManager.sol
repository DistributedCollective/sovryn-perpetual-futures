// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../interfaces/IPerpetualTradeManager.sol";
import "../interfaces/IFunctionList.sol";
import "../functions/PerpetualTradeFunctions.sol";

contract PerpetualTradeManager is PerpetualTradeFunctions, IFunctionList, IPerpetualTradeManager {
    /**
     * Trade using order object with the following fields:
     * iPerpetualId  global id for perpetual
     * traderAddr    address of trader
     * fAmount       amount in base currency to be traded
     * fLimitPrice   limit price
     * iDeadline     deadline for price (seconds timestamp)
     * referrerAddr  address of abstract referrer
     * flags         trade flags
     */
    function trade(Order memory _order) external override {
        require(_order.traderAddr == msgSender(), "sender should be set in an order");
        bytes32 digest = _getDigest(_order, address(this), true);
        _trade(_order, digest);
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualTradeManager");
        bytes4[] memory functionList = new bytes4[](1);
        functionList[0] = this.trade.selector;
        return (functionList, moduleName);
    }
}
