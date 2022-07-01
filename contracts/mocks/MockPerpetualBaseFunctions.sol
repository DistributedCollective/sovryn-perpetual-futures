// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/functions/PerpetualBaseFunctions.sol";

import "../perpetual/modules/PerpetualMarginLogic.sol";
import "./IMockPerpetualBaseFunctions.sol";
import "../perpetual/interfaces/IFunctionList.sol";
import "../libraries/Utils.sol";

contract MockPerpetualBaseFunctions is PerpetualBaseFunctions, IMockPerpetualBaseFunctions, IFunctionList {
    function getBaseToCollateralConversionMultiplier(bytes32 _iPerpetualId, bool _isMarkPriceRequest) public view override returns (int128) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _getBaseToCollateralConversionMultiplier(perpetual, _isMarkPriceRequest);
    }

    function getCollateralToQuoteConversionMultiplier(bytes32 _iPerpetualId) public view override returns (int128) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _getCollateralToQuoteConversionMultiplier(perpetual);
    }

    function updateMarkPrice(bytes32 _iPerpetualId) public override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        uint64 iCurrentTimeSec = uint64(block.timestamp);
        _updateMarkPrice(perpetual, iCurrentTimeSec);
    }

    event AMMAndMarketDataResult(AMMPerpLogic.AMMVariables ammVars, AMMPerpLogic.MarketVariables mktVars);

    function prepareAMMAndMarketData(bytes32 _iPerpetualId, int128 _fTradeAmount)
        public
        override
        returns (AMMPerpLogic.AMMVariables memory, AMMPerpLogic.MarketVariables memory)
    {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        AMMPerpLogic.AMMVariables memory ammvars;
        AMMPerpLogic.MarketVariables memory mktvars;
        (ammvars, mktvars) = _prepareAMMAndMarketData(perpetual);
        emit AMMAndMarketDataResult(ammvars, mktvars);
        return (ammvars, mktvars);
    }

    function transferFromUserToVault(
        address _marginTknAddr,
        address _userAddr,
        int128 _fAmount
    ) public override {
        _transferFromUserToVault(_marginTknAddr, _userAddr, _fAmount);
    }

    function transferFromVaultToUser(
        address _marginTknAddr,
        address _traderAddr,
        int128 _fAmount
    ) public override {
        _transferFromVaultToUser(_marginTknAddr, _traderAddr, _fAmount);
    }

    function getTotalTraderFunds(bytes32 _perpetualId) external view override returns (int128) {
        return _getTotalTraderFunds(_perpetualId);
    }

    function getFunctionList() external pure override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("MockPerpetualBaseFunctions");
        bytes4[] memory functionList = new bytes4[](7);
        /*
        functionList[0] = this.getInitialMarginRate.selector;
        functionList[1] = this.getMaintenanceMargin.selector;
        functionList[2] = this.getMaintenanceMarginRate.selector;
        functionList[3] = this.getAvailableMargin.selector;
        functionList[6] = this.getInitialMargin.selector;
        functionList[7] = this.getMarginBalance.selector;
        functionList[12] = this.isInitialMarginSafe.selector;
        */
        functionList[0] = this.getBaseToCollateralConversionMultiplier.selector;
        functionList[1] = this.getCollateralToQuoteConversionMultiplier.selector;
        functionList[2] = this.updateMarkPrice.selector;
        functionList[3] = this.prepareAMMAndMarketData.selector;
        functionList[4] = this.transferFromUserToVault.selector;
        functionList[5] = this.transferFromVaultToUser.selector;
        functionList[6] = this.getTotalTraderFunds.selector;
        return (functionList, moduleName);
    }
}
