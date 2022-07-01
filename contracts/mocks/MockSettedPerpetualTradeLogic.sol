// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/modules/PerpetualTradeLogic.sol";
import "../perpetual/interfaces/IFunctionList.sol";
import "./IMockPerpetualTradeLogic.sol";
import "./IMockSOVLibraryEvents.sol";
import "../libraries/ConverterDec18.sol";
import "../libraries/Utils.sol";
import "hardhat/console.sol";

contract MockSettedPerpetualTradeLogic is PerpetualTradeLogic, IPerpetualUpdateLogic, IMockSOVLibraryEvents {
    using ConverterDec18 for int128;
    using ConverterDec18 for int256;
    using ABDKMath64x64 for int128;

    function preTrade(
        bytes32 _iPerpetualId,
        IPerpetualOrder.Order memory _order
    ) external override returns (int128, int128) {
        int128 fAmount = _order.fAmount;
        int128 fLimitPrice = _order.fLimitPrice;
        address traderAddr = _order.traderAddr;
        emit MockPreTrade(_iPerpetualId, traderAddr, fAmount, fLimitPrice, _order.flags);
        // mock stuff:
        int128 fPrice = fLimitPrice;
        return (fPrice, fAmount);
    }

    function getMaxSignedTradeSizeForPos(
        bytes32 _iPerpetualId,
        int128 _fCurrentTraderPos,
        int128 fTradeAmountBC
    ) external view override returns (int128) {
        int128 fNewPos = _fCurrentTraderPos.add(fTradeAmountBC);
        int128 fMaxMock = fNewPos < 0 ? int256(10**21).fromDec18().neg() : int256(10**21).fromDec18();
        return fMaxMock;
    }

    function executeTrade(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _fTraderPos,
        int128 _fTradeAmount,
        int128 _fPrice,
        bool _isClose
    ) external override returns (int128) {
        int128 fDeltaCashCC = _fTradeAmount.mul(_fPrice);
        
        emit MockExecuteTrade(_iPerpetualId, _traderAddr, _fTraderPos, _fTradeAmount, fDeltaCashCC, _isClose);
        return fDeltaCashCC;
    }

    function updateAMMTargetFundSize(bytes32 _iPerpetualId, int128 fTarget) external override {
        emit MockUpdateAMMTargetFundSize(_iPerpetualId);
    }

    function updateDefaultFundTargetSizeRandom(uint16 _iPoolIdx) external override {
        emit MockUpdateDefaultFundTargetSizeRandom(_iPoolIdx);
    }

    function updateDefaultFundTargetSize(bytes32 _iPerpetualIdx) external override {
        emit MockUpdateDefaultFundTargetSize(_iPerpetualIdx);
    }


    function updateFundingAndPricesBefore(bytes32 _iPerpetualId0, bytes32 _iPerpetualId1) external override {}

    function updateFundingAndPricesAfter(bytes32 _iPerpetualId0, bytes32 _iPerpetualId1) external override {}

    function distributeFees(
       IPerpetualOrder.Order memory _order,
        bool _hasOpened
    ) external override returns (int128) {
        emit MockDistributeFees(_order.iPerpetualId, _order.traderAddr, _order.referrerAddr, _order.fAmount, _hasOpened);
        return 0;
    }

    function getFunctionList() external pure override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("MockSettedPerpetualTradeLogic");
        bytes4[] memory functionList = new bytes4[](6);
        functionList[0] = this.preTrade.selector;
        functionList[1] = this.getMaxSignedTradeSizeForPos.selector;
        functionList[2] = this.executeTrade.selector;
        functionList[3] = this.updateFundingAndPricesBefore.selector;
        functionList[4] = this.updateFundingAndPricesAfter.selector;
        functionList[5] = this.distributeFees.selector;
        return (functionList, moduleName);
    }
}
