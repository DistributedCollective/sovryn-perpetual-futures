// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/functions/PerpetualRebalanceFunctions.sol";
import "./IMockPerpetualRebalanceFunctions.sol";
import "../perpetual/interfaces/IFunctionList.sol";
import "../libraries/Utils.sol";

contract MockPerpetualRebalanceFunctions is PerpetualRebalanceFunctions, IMockPerpetualRebalanceFunctions, IFunctionList {
    function splitAmount(
        uint16 _iPoolIndex,
        int128 _fAmount,
        bool _isWithdrawn
    ) external view override returns (int128, int128) {
        int128 amount1;
        int128 amount2;
        LiquidityPoolData storage liquidityPool = liquidityPools[_iPoolIndex];
        (amount1, amount2) = _splitAmount(liquidityPool, _fAmount, _isWithdrawn);
        return (amount1, amount2);
    }

    function hasTheSameSign(int128 _fX, int128 _fY) external pure override returns (bool) {
        return _hasTheSameSign(_fX, _fY);
    }

    function rebalance(bytes32 _iPerpetualId) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _rebalance(perpetual);
    }

    function increaseAMMFundCashForPerpetual(bytes32 _iPerpetualId, int128 _fAmount) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _increaseAMMFundCashForPerpetual(perpetual, _fAmount);
    }

    function hasOpenedPosition(int128 _fNewPos, int128 fDeltaPos) external pure override returns (bool) {
        return _hasOpenedPosition(_fNewPos, fDeltaPos);
    }

    function transferFromAMMMarginToPool(bytes32 _iPerpetualId, int128 _fAmount) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _transferFromAMMMarginToPool(perpetual, _fAmount);
    }

    function decreaseAMMFundCashForPerpetual(bytes32 _iPerpetualId, int128 _fAmount) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _decreaseAMMFundCashForPerpetual(perpetual, _fAmount);
    }

    function transferFromPoolToAMMMargin(bytes32 _iPerpetualId, int128 _fAmount) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _transferFromPoolToAMMMargin(perpetual, _fAmount);
    }

    function equalizeAMMMargin(bytes32 _iPerpetualId) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _equalizeAMMMargin(perpetual);
    }

    function getRebalanceMargin(bytes32 _iPerpetualId) external view override returns (int128) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _getRebalanceMargin(perpetual);
    }

    function updateKStar(bytes32 _iPerpetualId) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _updateKStar(perpetual);
    }

    function getFunctionList() external pure override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("MockPerpetualRebalanceFunctions");
        bytes4[] memory functionList = new bytes4[](11);
        functionList[0] = this.splitAmount.selector;
        functionList[1] = this.hasTheSameSign.selector;
        functionList[2] = this.rebalance.selector;
        functionList[3] = this.increaseAMMFundCashForPerpetual.selector;
        functionList[4] = this.hasOpenedPosition.selector;
        functionList[5] = this.transferFromAMMMarginToPool.selector;
        functionList[6] = this.decreaseAMMFundCashForPerpetual.selector;
        functionList[7] = this.transferFromPoolToAMMMargin.selector;
        functionList[8] = this.getRebalanceMargin.selector;
        functionList[9] = this.equalizeAMMMargin.selector;
        functionList[10] = this.updateKStar.selector;
        return (functionList, moduleName);
    }
}
