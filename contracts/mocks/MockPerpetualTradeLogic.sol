// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/modules/PerpetualTradeLogic.sol";
import "../perpetual/interfaces/IFunctionList.sol";
import "./IMockPerpetualTradeLogic.sol";
import "../libraries/Utils.sol";

contract MockPerpetualTradeLogic is PerpetualTradeLogic, IMockPerpetualTradeLogic {
    event PreTradeResult(int128 fPrice, int128 fAmount);
    using ConverterDec18 for int128;

    function preTrade(
        bytes32 _iPerpetualId,
        IPerpetualOrder.Order memory _order
    ) external override returns (int128, int128) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        int128 fPrice;
        int128 fAmount;
        (fPrice, fAmount) = _preTrade(perpetual, _order.traderAddr, _order.fAmount, _order.fLimitPrice, _order.flags);
        emit PreTradeResult(fPrice, fAmount);
        return (fPrice, fAmount);
    }

    function validatePrice(
        bool _isLong,
        int128 _fPrice,
        int128 _fPriceLimit
    ) external pure override {
        _validatePrice(_isLong, _fPrice, _fPriceLimit);
    }

    function shrinkToMaxPositionToClose(int128 _fPosition, int128 _fAmount) external view override returns (int128) {
        return _shrinkToMaxPositionToClose(_fPosition, _fAmount);
    }

    function updateAverageTradeExposures(bytes32 _iPerpetualId, int128 _fTradeAmount) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _updateAverageTradeExposures(perpetual, _fTradeAmount);
    }

    function updateMargin(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _fDeltaPosition,
        int128 _fDeltaCashCC,
        int128 _fDeltaLockedInValueQC
    ) external override {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _updateMargin(perpetual, _traderAddr, _fDeltaPosition, _fDeltaCashCC, _fDeltaLockedInValueQC);
    }

    function transferFee(
        uint16 _poolId,
        bytes32 _iPerpetualId,
        address _traderAddr,
        address _referrerAddr,
        int128 _fPnLparticipantFee,
        int128 _fReferralRebate,
        int128 _fDefaultFundContribution,
        int128 _fAMMCashContribution
    ) external override {
        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _transferFee(pool, perpetual, _traderAddr, _referrerAddr, _fPnLparticipantFee, _fReferralRebate, _fDefaultFundContribution, _fAMMCashContribution);
    }

    function queryPriceFromAMM(bytes32 _iPerpetualId, int128 _fTradeAmount) external view override returns (int128) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _queryPriceFromAMM(perpetual, _fTradeAmount);
    }

    function calculateContributions(uint16 _poolId, int128 _fTreasuryFee) external view override returns (int128, int128) {
        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        return _calculateContributions(pool, _fTreasuryFee);
    }

    function calculateFees(
        bytes32 _iPerpetualId,
        address _traderAddr,
        address _referrerAddr,
        int128 _fDeltaPosCC,
        bool _hasOpened
    )
        external
        view
        override
        returns (
            int128,
            int128,
            int128
        )
    {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _calculateFees(perpetual, _traderAddr, _referrerAddr, _fDeltaPosCC, _hasOpened);
    }

    /* function isTraderMarginSafe(
        bytes32 _iPerpetualId,
        address _traderAddr,
        bool _hasOpened
    ) external view override returns (bool) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _isTraderMarginSafe(perpetual, _traderAddr, _hasOpened);
    }
     function isMarginSafe(bytes32 _iPerpetualId, address _traderAddr) external view override returns (bool) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _isMarginSafe(perpetual, _traderAddr);
    }
    */

    function roundToLot(int128 _fAmountBC, int128 fLotSizeBC) external pure override returns (int128) {
        return _roundToLot(_fAmountBC, fLotSizeBC);
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("MockPerpetualTradeLogic");
        bytes4[] memory functionList = new bytes4[](10);
        functionList[0] = this.updateAverageTradeExposures.selector;
        functionList[1] = this.updateMargin.selector;
        functionList[2] = this.transferFee.selector;
        functionList[3] = this.queryPriceFromAMM.selector;
        functionList[4] = this.calculateFees.selector;
        functionList[5] = this.calculateContributions.selector;
        //functionList[6] = this.isTraderMarginSafe.selector;
        //functionList[6] = this.isMarginSafe.selector;
        functionList[6] = this.validatePrice.selector;
        functionList[7] = this.shrinkToMaxPositionToClose.selector;
        functionList[8] = this.preTrade.selector;
        functionList[9] = this.roundToLot.selector;
        return (functionList, moduleName);
    }
}
