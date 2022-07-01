// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/proxy/Proxy.sol";
import "../../libraries/OrderFlags.sol";
import "../../interface/ISpotOracle.sol";
import "../functions/PerpetualRebalanceFunctions.sol";
import "../interfaces/IPerpetualTradeManager.sol";

import "../interfaces/IPerpetualDepositManager.sol";
import "../interfaces/IFunctionList.sol";
import "../../libraries/RSKAddrValidator.sol";
import "../../libraries/Utils.sol";
import "../functions/PerpetualHashFunctions.sol";
import "../interfaces/IPerpetualOrder.sol";

contract PerpetualTradeFunctions is PerpetualRebalanceFunctions, PerpetualHashFunctions {
    using ABDKMath64x64 for int128;
    using ConverterDec18 for int128;
    using OrderFlags for uint32;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

    /**
     * @notice check pre-conditions for trade function. Function will revert,
     *  return true (continue trade-function) or false (return without execution)
     * @param _order order struct of order to be executed
     * @return false if trade-function should return without execution.
     */
    function _checkTradePreCond(IPerpetualOrder.Order memory _order) internal view returns (bool) {
        _checkWhitelist(_order.traderAddr);
        require(_order.traderAddr != address(0), "invalid trader");
        if (_order.flags.isMarketOrder()) {
            require(_order.referrerAddr == address(0), "referrer can't be set for market order");
        }
        require(_order.fAmount != 0, "invalid amount");
        require(_order.iDeadline >= block.timestamp, "deadline exceeded");
        PerpetualData memory perpetual = _getPerpetual(_order.iPerpetualId);
        if (perpetual.state == PerpetualState.EMERGENCY) {
            // perpetual should be in NORMAL state
            // modifier might set the state to emergency, so in this case we return but do not
            // revert
            return false;
        }
        require(perpetual.state == PerpetualState.NORMAL, "perpetual should be in NORMAL state");
        require(!ISpotOracle(perpetual.oracleS2Addr).isMarketClosed(), "market is closed now");
        if (perpetual.eCollateralCurrency == AMMPerpLogic.CollateralCurrency.QUANTO) {
            require(!ISpotOracle(perpetual.oracleS3Addr).isMarketClosed(),
                "quanto market is closed now");
        }
        return true;
    }

    /**
     * @notice main trade function
     * @param _order order struct of order to be executed
     * @param _digest order-hash
     */
    function _trade(IPerpetualOrder.Order memory _order, bytes32 _digest) internal 
        updateFundingAndPrices(_order.iPerpetualId, _getPoolIdFromPerpetual(_order.iPerpetualId)) 
    {
        if (!_checkTradePreCond(_order)) {
            return;
        }
        // pretrade:
        //  - adjust amount if close-only,
        //  - (delta cash, delta pos)=querytrade(.)
        //  - check limit price
        // dotrade:
        //  - add position to AMM total pos via updateMargin
        //  - add position to trader pos via updateMargin
        //  - update openinterest
        // posttrade: withdraw fees, diminish fees if margin not sufficient
        // posttrade: update k, L, K EMAs

        //amount is the trader trade-size (base currency)
        bool isClose;
        
        int128 fPrice;
        int128 fPnLCC;
        int128 fNewPos;
        PerpetualData storage perpetual = _getPerpetual(_order.iPerpetualId);
        {
            // shrink trade-amount if close-only trade and amount too large
            // override trade amount in order
            (fPrice, _order.fAmount) = _getTradeLogic().preTrade(perpetual.id, _order);
            // override trade amount in order
            // if the traders closes/shrinks the position, we immediately exchange P&L into
            // collateral currency, and update the margin-cash
            int128 fTraderPos = marginAccounts[perpetual.id][_order.traderAddr].fPositionBC;
            fNewPos = fTraderPos.add(_order.fAmount);
            // ensure no rounding issues:
            if (fNewPos.abs() < perpetual.fLotSizeBC) {
                fNewPos = 0;
            }
            isClose = !_hasOpenedPosition(fNewPos, _order.fAmount);
            _checkMaxTotalTraderFundsExceeded(perpetual.id, isClose);
            
            // calculate and withdraw/deposit margin collateral depending on trade leverage choice
            if (!_doMarginCollateralActions(perpetual, fTraderPos, fPrice, _order, _digest)) {
                // if deposit for limit/stop orders fail the order is cancelled and we return here
                // with failed deposits on market orders the function _doMarginCollateralActions reverts
                return;
            }
            
            if (!isClose || (isClose && _order.fAmount.abs() > fTraderPos.abs())) {
                // we are flipping the position sign or increasing the trade size
                // update k star, ensure resulting position not too large
                _doOpeningTradeActions(perpetual, fTraderPos, fPrice, _order);
            }
            fPnLCC = _getTradeLogic().executeTrade(perpetual.id, _order.traderAddr, fTraderPos, _order.fAmount, fPrice, isClose);
        }

        // update AMM state, then distribute fees
        _getRebalanceLogic().rebalance(perpetual.id);
        // distribute fees
        fPnLCC = fPnLCC.sub(_getTradeLogic().distributeFees(_order, !isClose));

        require(_isTraderMarginSafe(perpetual, _order.traderAddr, !isClose), "trader margin unsafe");
        {
            bytes32 positionId = marginAccounts[perpetual.id][_order.traderAddr].positionId;
            emit Trade(perpetual.id, _order.traderAddr, positionId, _order, _digest, fNewPos, fPrice);
            emit RealizedPnL(perpetual.id, _order.traderAddr, positionId, fPnLCC);
        }
        if (fNewPos == 0) {
            // trader closed position, set positionId to zero
            marginAccounts[perpetual.id][_order.traderAddr].positionId = 0;
            // remove trader from active accounts and withdraw deposits
            _getMarginLogic().withdrawDepositFromMarginAccount(perpetual.id, _order.traderAddr);
        }
        _getUpdateLogic().updateDefaultFundTargetSize(perpetual.id);
    }

    /**
     * @notice Actions to be performed to achieve target leverage
     * @param _perpetual perpetual reference
     * @param _fTraderPos trader's position before trade
     * @param _fPrice price the trader gets for the specified trade amount
     * @param _order order struct
     * @param _digest digest of the order
     * @return true if trade should proceed, false if margin allocation did not work
     */
    function _doMarginCollateralActions(
        PerpetualData storage _perpetual,
        int128 _fTraderPos,
        int128 _fPrice,
        IPerpetualOrder.Order memory _order,
        bytes32 _digest
    ) internal returns (bool) {
        if ((_fTraderPos.add(_order.fAmount).abs() < _perpetual.fLotSizeBC) || _order.fLeverage <= 0) {
            // nothing to do, no leverage set or resulting position is zero
            return true;
        }
        // determine target leverage
        bool isOpen = _hasTheSameSign(_order.fAmount, _fTraderPos);
        bool isFlip = (_order.fAmount.abs() > _fTraderPos.abs()) && !isOpen;
        
        if (!isOpen && !isFlip && !_order.flags.keepPositionLeverageOnClose()) {
            // the order trades towards closing the position,
            // does not flip the position sign, and the
            // order instructions are to not touch the margin collateral
            // (!keepPositionLeverageOnClose)
            return true;
        }
        // now the leverage is either position leverage if !isFlip and !isOpen,
        // or trade leverage if isFlip. For position leverage we pass 0.
        int128 fTargetLeverage = isFlip || isOpen ? _order.fLeverage : int128(0);
        int128 fDeposit = _getMarginViewLogic().calcMarginForTargetLeverage(
            _perpetual.id,
            _fTraderPos,
            _fPrice,
            _order.fAmount,
            fTargetLeverage,
            _order.traderAddr,
            isOpen
        );        
        // correct for fees
        int128 fTotalFee;
        {
            int128 fx = _getBaseToCollateralConversionMultiplier(_perpetual, false);
            int128 fTreasuryFee = _perpetual.fTreasuryFeeRate;// will be set to CC amount
            int128 fPnLparticipantFee = _perpetual.fPnLPartRate;// will be set to CC amount
            int128 fReferralRebate = _perpetual.fReferralRebateCC;// will be set to CC amount
            int128 fTradeAmountCC = _order.fAmount.mul(fx);
            address referrer = _order.referrerAddr;
            (fTreasuryFee, fPnLparticipantFee, fReferralRebate) = _getAMMPerpLogic().getTradeFees(
                    fTradeAmountCC,
                    fTreasuryFee,
                    fPnLparticipantFee,
                    fReferralRebate,
                    referrer);
            fTotalFee = fTreasuryFee.add(fPnLparticipantFee).add(fReferralRebate);
        }
        fDeposit = fDeposit.add(fTotalFee);
        if (fDeposit > 0) {
            if(!_getMarginLogic().depositMarginForOpeningTrade(_perpetual.id, fDeposit, _order)) {
                // cancel order and terminate function
                _executeCancelOrder(_digest);
                return false;
            }
        } else if (fDeposit < 0) {
            _getMarginLogic().reduceMarginCollateral(_perpetual.id, _order.traderAddr, fDeposit.abs());
        }

        return true;
    }

    /**
     * @notice Actions to be performed when the trade increases the position size.
     * returns false if the trade should not proceed
     * @param _perpetual perpetual reference
     * @param _fTraderPos trader's position before trade
     * @param _fPrice price the trader gets for the specified trade amount
     * @param _order order struct
     */
    function _doOpeningTradeActions(
        PerpetualData storage _perpetual,
        int128 _fTraderPos,
        int128 _fPrice,
        IPerpetualOrder.Order memory _order
    ) internal {
        // pre condition: !isClose, i.e., the trade is (further) opening the position
        _updateKStar(_perpetual);
        // if trader opens a position the total position amount should be smaller than the max amount,
        // unless the trade decreases the AMM risk.
        int128 maxTradeDelta = _getTradeLogic().getMaxSignedTradeSizeForPos(_perpetual.id, _fTraderPos, _order.fAmount);
        
        require(_order.fAmount.abs() < maxTradeDelta.abs(), "Trade amount exceeds maximal trade amount for trader and AMM state");
        if (_fTraderPos == 0) {
            // trader opens a new position, generate position id
            marginAccounts[_perpetual.id][_order.traderAddr].positionId = keccak256(
                abi.encodePacked(_order.traderAddr, _perpetual.id, block.timestamp, _fPrice)
            );
        }
    }

    /**
     * @notice Add the order digest to the cancellation-mapping
     *  and emit the cancel event.
     * @param _digest digest of the order to be cancelled
     */
    function _executeCancelOrder(bytes32 _digest) internal {
        require(!canceledOrders[_digest], "order was canceled");
        canceledOrders[_digest] = true;
        emit PerpetualLimitOrderCancelled(_digest);
    }
}
