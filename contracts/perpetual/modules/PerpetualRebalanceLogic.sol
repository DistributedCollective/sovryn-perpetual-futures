// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../functions/PerpetualRebalanceFunctions.sol";
import "../interfaces/IPerpetualRebalanceLogic.sol";
import "../interfaces/IFunctionList.sol";
import "../../libraries/Utils.sol";

contract PerpetualRebalanceLogic is PerpetualRebalanceFunctions, IFunctionList, IPerpetualRebalanceLogic {
    /**
     * @dev     To re-balance the AMM margin to the initial margin.
     *          Transfer margin between the perpetual and the various cash pools, then
     *          update the AMM's cash in perpetual margin account.
     *
     * @param   _iPerpetualId The perpetual id in the liquidity pool
     */
    function rebalance(bytes32 _iPerpetualId) external override onlyThis {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _rebalance(perpetual);
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualRebalanceLogic");
        bytes4[] memory functionList = new bytes4[](1);
        functionList[0] = this.rebalance.selector;
        return (functionList, moduleName);
    }
}
