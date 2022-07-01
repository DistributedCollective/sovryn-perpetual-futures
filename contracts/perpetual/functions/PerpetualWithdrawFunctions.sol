// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../../interface/ISpotOracle.sol";
import "./PerpetualRebalanceFunctions.sol";

contract PerpetualWithdrawFunctions is PerpetualRebalanceFunctions {
    using ABDKMath64x64 for int128;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

    function _rebalanceAndWithdraw(
        PerpetualData storage _perpetual,
        address _traderAddr,
        int128 _fAmount
    ) internal {
        _getRebalanceLogic().rebalance(_perpetual.id);
        _withdraw(_perpetual, _traderAddr, _fAmount);
        address marginTokenAddr = liquidityPools[_perpetual.poolId].marginTokenAddress;
        _transferFromVaultToUser(marginTokenAddr, _traderAddr, _fAmount);
        emit TokensWithdrawn(_perpetual.id, _traderAddr, _fAmount);
    }

    function _withdraw(
        PerpetualData storage _perpetual,
        address _traderAddr,
        int128 _fAmount
    ) internal {
        bytes32 perpId = _perpetual.id;
        require(marginAccounts[perpId][_traderAddr].fPositionBC == 0 || !ISpotOracle(_perpetual.oracleS2Addr).isMarketClosed(), "market is closed");
        _updateTraderMargin(_perpetual, _traderAddr, _fAmount.neg());
        require(_getMarginViewLogic().isInitialMarginSafe(perpId, _traderAddr), "margin is unsafe after withdrawal");
        bool isEmptyAccount = _isEmptyAccount(_perpetual, _traderAddr);
        if (isEmptyAccount && _traderAddr != address(this)) {
            activeAccounts[perpId].remove(_traderAddr);
        }
    }

    function _validateInputDataWithdraw(
        PerpetualData storage _perpetual,
        int128 _fAmount
    ) internal view {
        require(_perpetual.state == PerpetualState.NORMAL || _perpetual.state == PerpetualState.CLEARED, "should be in NORMAL/CLEARED state");
        require(_fAmount > 0, "invalid amount");
        //it will fail if account.fCashCC >= _fAmount with error: if margin is unsafe after withdrawal
    }
}
