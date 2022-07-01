// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "./../functions/PerpetualUpdateFunctions.sol";
import "./../interfaces/IFunctionList.sol";
import "../../libraries/Utils.sol";

contract PerpetualUpdateLogic is PerpetualUpdateFunctions, IPerpetualUpdateLogic, IFunctionList {
    function updateAMMTargetFundSize(bytes32 _iPerpetualId, int128 fTarget) external override onlyThis {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _updateAMMTargetFundSize(perpetual, fTarget);
    }

    function updateDefaultFundTargetSizeRandom(uint16 _iPoolIndex) external override onlyThis {
        _updateDefaultFundTargetSizeRandom(_iPoolIndex);
    }

    function updateDefaultFundTargetSize(bytes32 _iPerpetualId) external override onlyThis {
        _updateDefaultFundTargetSize(_iPerpetualId);
    }

    function updateFundingAndPricesBefore(bytes32 _iPerpetualId0, bytes32 _iPerpetualId1) external override onlyThis {
        PerpetualData storage perpetual1 = _getPerpetual(_iPerpetualId0);
        _accumulateFundingInPerp(perpetual1);
        PerpetualData storage perpetual2 = _getPerpetual(_iPerpetualId1);
        _accumulateFundingInPerp(perpetual2);
        _updateOraclePricesForPerp(perpetual1);
        _updateOraclePricesForPerp(perpetual2);
        
    }

    function updateFundingAndPricesAfter(bytes32 _iPerpetualId0, bytes32 _iPerpetualId1) external override onlyThis {
        PerpetualData storage perpetual1 = _getPerpetual(_iPerpetualId0);
        _updateFundingRatesInPerp(perpetual1);
         PerpetualData storage perpetual2 = _getPerpetual(_iPerpetualId1);
        _updateFundingRatesInPerp(perpetual2);
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualUpdateLogic");
        bytes4[] memory functionList = new bytes4[](5);
        functionList[0] = this.updateAMMTargetFundSize.selector;
        functionList[1] = this.updateFundingAndPricesBefore.selector;
        functionList[2] = this.updateFundingAndPricesAfter.selector;
        functionList[3] = this.updateDefaultFundTargetSize.selector;
        functionList[4] = this.updateDefaultFundTargetSizeRandom.selector;
        return (functionList, moduleName);
    }
}
