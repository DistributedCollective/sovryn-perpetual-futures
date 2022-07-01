// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/functions/PerpetualUpdateFunctions.sol";
import "./IMockPerpetualUpdateFunctions.sol";
import "../perpetual/interfaces/IFunctionList.sol";
import "../libraries/Utils.sol";

contract MockPerpetualUpdateFunctions is PerpetualUpdateFunctions, IMockPerpetualUpdateFunctions, IFunctionList {
    function mockGetUpdatedTargetAMMFundSize(bytes32 _iPerpetualId, bool _isBaseline) external view override returns (int128) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _getUpdatedTargetAMMFundSize(perpetual, perpetual.eCollateralCurrency, _isBaseline);
    }

    function mockUpdateAMMTargetFundSize(bytes32 _iPerpetualId, int128 _fTargetDD) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _updateAMMTargetFundSize(perpetual, _fTargetDD);
    }

    function mockUpdateDefaultFundTargetSizeRandom(uint16 _iPoolIndex, bool force) external override {
        if (force) {
            LiquidityPoolData storage liquidityPool = liquidityPools[_iPoolIndex];
            uint256 length = liquidityPool.iPerpetualCount;
            for (uint256 i = 0; i < length; i++) {
                bytes32 id = perpetualIds[liquidityPool.id][i];
                PerpetualData storage perpetual = perpetuals[liquidityPool.id][id];
                perpetual.iLastTargetPoolSizeTime = uint64(block.timestamp) - 86401;
                _updateDefaultFundTargetSize(perpetual.id);
            }
        } else {
            _updateDefaultFundTargetSizeRandom(_iPoolIndex);
        }
    }

    function mockUpdateDefaultFundTargetSize(bytes32 _iPerpetualId, bool force) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        if (force) {
            perpetual.iLastTargetPoolSizeTime = uint64(block.timestamp) - 86401;
            _updateDefaultFundTargetSize(perpetual.id);
        } else {
            _updateDefaultFundTargetSize(perpetual.id);
        }
    }

    function updateFundingRatesInPerp(bytes32 _iPerpetualId) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _updateFundingRatesInPerp(perpetual);
    }

    function updateFundingRate(bytes32 _iPerpetualId) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _updateFundingRate(perpetual);
    }

    function accumulateFundingInPerp(bytes32 _iPerpIdx, uint64 _iTimeElapsed) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpIdx);
        perpetual.iLastFundingTime = uint64(block.timestamp) - _iTimeElapsed;
        _accumulateFundingInPerp(perpetual);
    }

    function updateOraclePricesForPool(uint16 _iPoolIndex) external override {
        _updateOraclePricesForPool(_iPoolIndex);
    }

    function increaseDefaultFundCash(uint16 _iPoolIndex, int128 _fAmount) external override {
        LiquidityPoolData storage liquidityPool = liquidityPools[_iPoolIndex];
        _increaseDefaultFundCash(liquidityPool, _fAmount);
    }


    function getFunctionList() external pure override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("MockPerpetualUpdateFunctions");
        bytes4[] memory functionList = new bytes4[](10);
        functionList[0] = this.updateFundingRate.selector;
        functionList[1] = this.mockUpdateAMMTargetFundSize.selector;
        functionList[2] = this.accumulateFundingInPerp.selector;
        functionList[3] = this.updateFundingRatesInPerp.selector;
        functionList[4] = this.accumulateFundingInPerp.selector;
        functionList[5] = this.mockGetUpdatedTargetAMMFundSize.selector;
        functionList[6] = this.mockUpdateDefaultFundTargetSize.selector;
        functionList[7] = this.mockUpdateDefaultFundTargetSizeRandom.selector;
        functionList[8] = this.updateOraclePricesForPool.selector;
        functionList[9] = this.increaseDefaultFundCash.selector;
        return (functionList, moduleName);
    }
}
