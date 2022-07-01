// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../interfaces/IFunctionList.sol";
import "../../libraries/RSKAddrValidator.sol";
import "../interfaces/IPerpetualLimitTradeManager.sol";
import "../functions/PerpetualTradeFunctions.sol";

contract PerpetualLimitTradeManager is PerpetualTradeFunctions, IFunctionList, IPerpetualLimitTradeManager {
    using OrderFlags for uint32;

    function tradeBySig(Order memory _order, bytes memory signature) external override {
        bytes32 digest = _getDigest(_order, address(this), true);

        address signatory = ECDSA.recover(digest, signature);

        //Verify address is not null and PK is not null either.
        require(RSKAddrValidator.checkPKNotZero(signatory), "invalid signature or PK");

        require(!executedOrders[digest], "order already executed");
        require(!canceledOrders[digest], "order was canceled");
        executedOrders[digest] = true;

        require(signatory == _order.traderAddr, "invalid signature");

        if (_order.flags.isStopOrder()) {
            require(_order.fTriggerPrice > 0, "positive trigger price required for stop orders");
            PerpetualData storage perpetual = _getPerpetual(_order.iPerpetualId);
            _getTradeLogic().validateStopPrice(_order.fAmount > 0, _getPerpetualMarkPrice(perpetual), _order.fTriggerPrice);
        }

        _trade(_order, digest);
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualLimitTradeManager");
        bytes4[] memory functionList = new bytes4[](1);
        functionList[0] = this.tradeBySig.selector;
        return (functionList, moduleName);
    }
}
