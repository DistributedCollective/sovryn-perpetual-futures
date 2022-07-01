// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/modules/PerpetualSettlement.sol";
import "./IMockPerpetualSettlement.sol";
import "../libraries/Utils.sol";

contract MockPerpetualSettlement is PerpetualSettlement, IMockPerpetualSettlement {
    function clearNextTraderInPerpetual(bytes32 _iPerpetualId) external override returns (bool) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _clearNextTraderInPerpetual(perpetual);
    }

    function clearTrader(bytes32 _iPerpetualId, address _traderAddr) external override returns (bool) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _clearTrader(perpetual, _traderAddr);
    }

    function countMargin(bytes32 _iPerpetualId, address _traderAddr) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _countMargin(perpetual, _traderAddr);
    }

    function getNextActiveAccount(bytes32 _iPerpetualId) external view override returns (address) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _getNextActiveAccount(perpetual);
    }

    function setRedemptionRate(
        uint16 _poolId,
        int128 _fTotalMarginBalance,
        int128 _fTotalCapital
    ) external override {
        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        _setRedemptionRate(pool, _fTotalMarginBalance, _fTotalCapital);
    }

    function resetAccount(bytes32 _iPerpetualId, address _traderAddr) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _resetAccount(perpetual, _traderAddr);
    }

    function getSettleableMargin(bytes32 _iPerpetualId, address _traderAddr) external view override returns (int128) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _getSettleableMargin(perpetual, _traderAddr);
    }

    function prepareRedemption(
        uint16 _poolId,
        int128 _fTotalEmrgAMMMarginBalance,
        int128 _fTotalEmrgAMMFundCashCC
    ) external view override returns (int128, int128) {
        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        return _prepareRedemption(pool, _fTotalEmrgAMMMarginBalance, _fTotalEmrgAMMFundCashCC);
    }

    function getFunctionList() external pure override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("MockPerpetualSettlement");
        bytes4[] memory functionList = new bytes4[](10);
        functionList[0] = this.getSettleableMargin.selector;
        functionList[1] = this.clearNextTraderInPerpetual.selector;
        functionList[2] = this.clearTrader.selector;
        functionList[3] = this.countMargin.selector;
        functionList[4] = this.getNextActiveAccount.selector;
        functionList[5] = this.setRedemptionRate.selector;
        functionList[6] = this.resetAccount.selector;
        // parent:
        functionList[7] = this.settleNextTraderInPool.selector;
        functionList[8] = this.settle.selector;

        functionList[9] = this.prepareRedemption.selector;
        return (functionList, moduleName);
    }
}
