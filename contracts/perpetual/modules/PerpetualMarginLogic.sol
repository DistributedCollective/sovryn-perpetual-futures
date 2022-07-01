// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/proxy/Proxy.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../../libraries/OrderFlags.sol";
import "../../interface/ISpotOracle.sol";
import "../functions/PerpetualRebalanceFunctions.sol";
import "../interfaces/IPerpetualTradeManager.sol";

import "../interfaces/IPerpetualDepositManager.sol";
import "../interfaces/IFunctionList.sol";
import "../../libraries/RSKAddrValidator.sol";
import "../../libraries/Utils.sol";
import "../interfaces/IPerpetualMarginLogic.sol";

contract PerpetualMarginLogic is PerpetualRebalanceFunctions, IFunctionList, IPerpetualMarginLogic {
    using ABDKMath64x64 for int128;
    using ConverterDec18 for int128;
    using OrderFlags for uint32;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

    /*
     * If the trader opens a position (either flip, or increase of notional) 
     * and the leverage amount is set (>0),
     * the contract withdraws an amount from the trader wallet and deposits
     * it into the trader's Perpetuals collateral account so that the
     * leverage is equal to the targeted leverage when entering the requested
     * position size.
     * @param   _iPerpetualId       reference to perpetual
     * @param   _fDepositRequired   64.64 fixed point number. Required deposit (can be negative)
     * @param   _traderAddr         address of trader
     * @return false if deposit not available/approved
     */
    function depositMarginForOpeningTrade(
        bytes32 _iPerpetualId,
        int128 _fDepositRequired,
        Order memory _order
    ) external override onlyThis returns (bool) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _depositMarginForOpeningTrade(perpetual, _fDepositRequired, _order);
    }

    /*
     * Withdraw trader margin deposits from margin account to achieve
     * This is used to achieve a target leverage when reducing position size.
     * (without rebalancing the AMM).
     * Emits TokensWithdrawn event
     * Will revert if position is zero or negative.
     * @param   _iPerpetualId        reference to perpetual
     * @param   _address             trader address
     * @param   _fAmountToWithdraw   amount that we withdraw
     */
    function reduceMarginCollateral(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _fAmountToWithdraw
    ) external override onlyThis {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _reduceMarginCollateral(perpetual, _traderAddr, _fAmountToWithdraw);
    }

    /*
     * Withdraw all trader deposits (without rebalancing the AMM).
     * Emits TokensWithdrawn event
     * Will revert if position not zero.
     * @param   _iPerpetualId    reference to perpetual
     * @param   _address         trader address
     */
    function withdrawDepositFromMarginAccount(bytes32 _iPerpetualId, address _traderAddr) external override onlyThis {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _withdrawDepositFromMarginAccount(perpetual, _traderAddr);
    }

    function _depositMarginForOpeningTrade(
        PerpetualData storage _perpetual,
        int128 _fDepositRequired,
        Order memory _order
    ) internal returns (bool) {
        address marginTokenAddr = liquidityPools[_perpetual.poolId].marginTokenAddress;
        if (_order.traderAddr != address(this)) {
            activeAccounts[_perpetual.id].add(_order.traderAddr);
        }
        // check if allowance set and enough cash available
        if (!_order.flags.isMarketOrder() && !_isDepositAllowed(marginTokenAddr, _order.traderAddr, _fDepositRequired)) {
            // we don't check for market orders because we are ok with a revert.
            // for limit/stop orders we have to cancel the order
            return false;
        }
        _transferFromUserToVault(marginTokenAddr, _order.traderAddr, _fDepositRequired);
        _updateTraderMargin(_perpetual, _order.traderAddr, _fDepositRequired);
        emit TokensDeposited(_perpetual.id, _order.traderAddr, _fDepositRequired);
        return true;
    }

    function _isDepositAllowed(
        address _marginTknAddr,
        address _userAddr,
        int128 _fAmount
    ) internal view returns (bool) {
        uint256 ufAmountD18 = _fAmount.toUDec18();
        IERC20Upgradeable marginToken = IERC20Upgradeable(_marginTknAddr);
        uint256 balance = marginToken.balanceOf(_userAddr);
        if (balance < ufAmountD18) {
            return false;
        }
        uint256 allowance = marginToken.allowance(_userAddr, address(this));
        if (allowance < ufAmountD18) {
            return false;
        }
        return true;
    }

    /*
     * Internal function to withdraw trader margin deposits
     * Will revert if position is zero, or amount <=0
     * @param   _perpetual           reference to perpetual
     * @param   _address             trader address
     * @param   _fAmountToWithdraw   amount that we withdraw
     */
    function _reduceMarginCollateral(
        PerpetualData memory _perpetual,
        address _traderAddr,
        int128 _fAmountToWithdraw
    ) internal {
        MarginAccount storage account = marginAccounts[_perpetual.id][_traderAddr];
        require(_fAmountToWithdraw > 0, "reduce mgn coll must be positive");
        // amount to withdraw could be larger than margin deposit in case the trader has a very positive
        // P&L
        account.fCashCC = account.fCashCC.sub(_fAmountToWithdraw);
        address marginTokenAddr = liquidityPools[_perpetual.poolId].marginTokenAddress;
        _transferFromVaultToUser(marginTokenAddr, _traderAddr, _fAmountToWithdraw);
        emit TokensWithdrawn(_perpetual.id, _traderAddr, _fAmountToWithdraw);
    }

    function _withdrawDepositFromMarginAccount(PerpetualData memory _perpetual, address _traderAddr) internal {
        MarginAccount storage account = marginAccounts[_perpetual.id][_traderAddr];
        require(account.fPositionBC == 0, "pos must be 0 to withdraw all");
        int128 fCashToMove = account.fCashCC;
        account.fCashCC = 0;
        activeAccounts[_perpetual.id].remove(_traderAddr);
        address marginTokenAddr = liquidityPools[_perpetual.poolId].marginTokenAddress;
        _transferFromVaultToUser(marginTokenAddr, _traderAddr, fCashToMove);
        emit TokensWithdrawn(_perpetual.id, _traderAddr, fCashToMove);
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualMarginLogic");
        bytes4[] memory functionList = new bytes4[](3);
        functionList[0] = this.depositMarginForOpeningTrade.selector;
        functionList[1] = this.withdrawDepositFromMarginAccount.selector;
        functionList[2] = this.reduceMarginCollateral.selector;
        return (functionList, moduleName);
    }
}
