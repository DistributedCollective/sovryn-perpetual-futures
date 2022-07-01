// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/modules/PerpetualLiquidator.sol";
import "./IMockPerpetualLiquidator.sol";
import "../libraries/Utils.sol";

contract MockPerpetualLiquidator is PerpetualLiquidator, IMockPerpetualLiquidator {
    using ABDKMath64x64 for int128;

    function getPositionAmountToLiquidate(bytes32 _iPerpetualId, address _traderAddr) external view override returns (int128) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _getPositionAmountToLiquidate(perpetual, _traderAddr);
    }

    function getBaseToQuoteConversionMultiplier(bytes32 _iPerpetualId, bool _isMarkPriceRequest) external view override returns (int128) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _getBaseToQuoteConversionMultiplier(perpetual, _isMarkPriceRequest);
    }

    function getFunctionList() external pure override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("MockPerpetualLiquidator");
        bytes4[] memory functionList = new bytes4[](3);
        functionList[0] = this.liquidateByAMM.selector;
        functionList[1] = this.getPositionAmountToLiquidate.selector;
        functionList[2] = this.getBaseToQuoteConversionMultiplier.selector;
        return (functionList, moduleName);
    }
}
