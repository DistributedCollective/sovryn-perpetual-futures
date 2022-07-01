// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../interfaces/IFunctionList.sol";
import "../../libraries/RSKAddrValidator.sol";
import "../functions/PerpetualTradeFunctions.sol";
import "../interfaces/IPerpetualOrderManager.sol";

contract PerpetualOrderManager is PerpetualTradeFunctions, IFunctionList, IPerpetualOrderManager {
    /**
     * @notice Adds the order digest to the mapping of cancelled orders.
     * @param _order order struct of order to be cancelled
     * @param _signature signature of order and cancel-flag
     */
    function cancelOrder(Order memory _order, bytes memory _signature) external override {
        bytes32 digest = _getDigest(_order, address(this), true);

        // allow only signed cancel
        bytes32 cancelDigest = _getDigest(_order, address(this), false);
        address signatory = ECDSA.recover(cancelDigest, _signature);
        require(signatory == _order.traderAddr, "trader must sign cancel order");
        //Verify address is not null and PK is not null either.
        require(RSKAddrValidator.checkPKNotZero(signatory), "invalid signature or PK");
        _executeCancelOrder(digest);
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualOrderManager");
        bytes4[] memory functionList = new bytes4[](1);
        functionList[0] = this.cancelOrder.selector;
        return (functionList, moduleName);
    }
}
