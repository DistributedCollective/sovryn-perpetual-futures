// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "./../functions/PerpetualWithdrawFunctions.sol";
import "./../interfaces/IPerpetualWithdrawManager.sol";
import "./../interfaces/IFunctionList.sol";
import "../../interface/ISpotOracle.sol";
import "../../libraries/Utils.sol";

contract PerpetualWithdrawManager is PerpetualWithdrawFunctions, IFunctionList, IPerpetualWithdrawManager {
    using ABDKMath64x64 for int128;

    /**
     * @dev     Withdraw margin from the trader's account of the perpetual. The trader's cash will decrease.
     *          Trader must be initial margin safe in the perpetual after withdrawing.
     *          To avoid dust position, the minimal resulting cash amount is set to the referall rebate size.
     *          There is no relation between referallRebateSize and a margin deposit, 
     *          however referallRebateSize is a small collateral currency amount that can serve 
     *          as minimal withdrawal amount.
     *          Deactivate the perpetual for the trader if the account in the perpetual is empty after withdrawing.
     *          Empty means cash and position are zero.
     *
     * @param   _iPerpetualId   The id of the perpetual in the liquidity pool
     * @param   _fAmount        The amount of collateral to withdraw
     */
    function withdraw(bytes32 _iPerpetualId, int128 _fAmount) external override 
        nonReentrant updateFundingAndPrices(_iPerpetualId, perpetualPoolIds[_iPerpetualId]) 
    {
        address traderAddr = msgSender();
        _checkWhitelist(traderAddr);

        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        MarginAccount storage account = marginAccounts[_iPerpetualId][traderAddr];
        int128 fNewCash = account.fCashCC.sub(_fAmount);
        if (account.fPositionBC==0 && fNewCash < perpetual.fReferralRebateCC) {
            // resulting cash position very small,
            // set withdrawal amount to available cash
            _fAmount = account.fCashCC;
        }
        _validateInputDataWithdraw(perpetual, _fAmount);

        _rebalanceAndWithdraw(perpetual, traderAddr, _fAmount);
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualWithdrawManager");
        bytes4[] memory functionList = new bytes4[](1);
        functionList[0] = this.withdraw.selector;
        return (functionList, moduleName);
    }
}
