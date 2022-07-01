// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "./../functions/PerpetualWithdrawFunctions.sol";
import "./../interfaces/IPerpetualWithdrawAllManager.sol";
import "./../interfaces/IFunctionList.sol";
import "../../interface/ISpotOracle.sol";
import "../../libraries/Utils.sol";

contract PerpetualWithdrawAllManager is PerpetualWithdrawFunctions, IFunctionList, IPerpetualWithdrawAllManager {
    /**
     * @dev     Withdraw margin from the trader's account of the perpetual. The trader's cash will decrease.
     *          Deactivate the perpetual for the trader if the account in the perpetual is empty after withdrawing.
     *          Empty means cash and position are zero.
     *
     * @param   _iPerpetualId   The id of the perpetual in the liquidity pool
     */
    function withdrawAll(bytes32 _iPerpetualId) external override nonReentrant updateFundingAndPrices(_iPerpetualId, perpetualPoolIds[_iPerpetualId]) {
        address traderAddr = msgSender();
        _checkWhitelist(traderAddr);

        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        MarginAccount storage account = marginAccounts[_iPerpetualId][traderAddr];
        require(account.fPositionBC == 0, "position should be zero");
        int128 fAmount = account.fCashCC;
        _validateInputDataWithdraw(perpetual, fAmount);

        _rebalanceAndWithdraw(perpetual, traderAddr, fAmount);
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualWithdrawAllManager");
        bytes4[] memory functionList = new bytes4[](1);
        functionList[0] = this.withdrawAll.selector;
        return (functionList, moduleName);
    }
}
