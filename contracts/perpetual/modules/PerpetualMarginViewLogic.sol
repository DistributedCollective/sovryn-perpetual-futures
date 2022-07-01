// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/proxy/Proxy.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../interfaces/IPerpetualMarginViewLogic.sol";
import "../functions/PerpetualRebalanceFunctions.sol";
import "../interfaces/IFunctionList.sol";
import "../../libraries/Utils.sol";
import "../../libraries/OrderFlags.sol";


contract PerpetualMarginViewLogic is IPerpetualMarginViewLogic, IFunctionList, PerpetualRebalanceFunctions {
    using ABDKMath64x64 for int128;
    using ConverterDec18 for int128;
    using OrderFlags for uint32;

    /**
     * @notice Calculate amount of margin to be added so that the leverage
     * equals the target leverage for fTradeAmountBC at the price _fPrice.
     * Pre-fees.
     * @param _iPerpetualId perpetual id
     * @param _fTraderPos trader's position before trade
     * @param _fPrice price the trader gets for the specified trade amount
     * @param _fTradeAmountBC amount to be traded
     * @param _fTargetLeverage trade leverage, if set to zero we set the leverage of the
     *          resulting trade to the current position leverage, capped by max leverage
     * @param _traderAddr address of the trader
     * @param _ignorePosBalance agnostic about current trader position (when opening)
     * @return margin cash needed
     */
    function calcMarginForTargetLeverage(
        bytes32 _iPerpetualId,
        int128 _fTraderPos,
        int128 _fPrice,
        int128 _fTradeAmountBC,
        int128 _fTargetLeverage,
        address _traderAddr,
        bool _ignorePosBalance
    ) external view override returns (int128) {
        PerpStorage.PerpetualData memory perpetual = _getPerpetual(_iPerpetualId);
        // determine current position leverage
        int128 fS3 = _getCollateralToQuoteConversionMultiplier(perpetual);
        int128 fS2Mark = _getPerpetualMarkPrice(perpetual);
        
        int128 b0 = _ignorePosBalance ? int128(0) : _getMarginBalance(perpetual, _traderAddr);

        if (_fTargetLeverage == 0) {
            // leverage is to be set to position leverage
            _fTargetLeverage = _fTraderPos.abs().mul(fS2Mark);
            _fTargetLeverage = _fTargetLeverage.div(fS3).div(b0);
            // make sure leverage is not higher than initial margin requirement
            int128 fNewPos = _fTraderPos.add(_fTradeAmountBC);
            int128 fMaxLvg = ONE_64x64.div( _getInitialMarginRate(fNewPos, perpetual) );
            if (_fTargetLeverage > fMaxLvg) {
                _fTargetLeverage = fMaxLvg;
            }
        }
        // calculate required deposit for new position
        _fTraderPos = _ignorePosBalance ? int128(0) : _fTraderPos;
        return _getAMMPerpLogic().getDepositAmountForLvgPosition(
            _fTraderPos, b0, _fTradeAmountBC, _fTargetLeverage, _fPrice, fS2Mark, fS3);   
    }

    /**
     * @dev Get the margin of the trader in the perpetual at markprice (collateral currency).
     *      If trader=AMM the margin is calculated at the spot index.
     *      Settlement price is used if perpetual state not normal.
     *      Margin_cc = unrealized P&L + cash - funding
     *             = locked-in value * fx_q2c + position * fx_b2c(at mark price) + cash
     * @param _iPerpetualId    The perpetual id
     * @param _traderAddr   The address of the trader
     * @return The margin of the trader for the given the perpetual.
     */
    function getMarginBalance(bytes32 _iPerpetualId, address _traderAddr) external view override returns (int128) {
        PerpStorage.PerpetualData memory perpetual = _getPerpetual(_iPerpetualId);
        return _getMarginBalance(perpetual, _traderAddr);
    }

    function _getMarginBalance(PerpStorage.PerpetualData memory _perpetual, address _traderAddr) internal view returns (int128) {
        bool atMark = _traderAddr != address(this) || _perpetual.state != PerpetualState.NORMAL;
        // base to collateral currency conversion
        int128 fConversionB2C = _getBaseToCollateralConversionMultiplier(_perpetual, atMark);
        // quote to collateral currency conversion
        int128 fConversionC2Q = _getCollateralToQuoteConversionMultiplier(_perpetual);
        int128 fLockedInValueCC = marginAccounts[_perpetual.id][_traderAddr].fLockedInValueQC.div(fConversionC2Q);
        int128 fCashCC = _getAvailableCash(_perpetual, _traderAddr);
        int128 fMargin = marginAccounts[_perpetual.id][_traderAddr].fPositionBC.mul(fConversionB2C).add(fCashCC);
        fMargin = fMargin.sub(fLockedInValueCC);
        return fMargin;
    }

    /**
     * Check if the trader is maintenance margin safe in the perpetual, which means
     * margin >= maintenance margin, true if position = 0
     * @param _iPerpetualId The perpetual id
     * @param _traderAddr The address of the trader
     * @return boolean, true if the trader is maintenance margin safe in the perpetual
     */
    function isMaintenanceMarginSafe(bytes32 _iPerpetualId, address _traderAddr) external view override returns (bool) {
        PerpStorage.PerpetualData memory perpetual = _getPerpetual(_iPerpetualId);
        if (_getTraderPosition(perpetual, _traderAddr) == 0) {
            return true;
        }
        int128 threshold = _getMaintenanceMargin(perpetual, _traderAddr);
        return (_getMarginBalance(perpetual, _traderAddr) >= threshold);
    }

    /**
     * Available margin: (margin collateral + PnL) - initial margin
     * Hence we reserve the initial margin at the current price.
     * @param   _iPerpetualId          The perpetual id
     * @param   _traderAddr         The address of the trader
     * @param   _isInitialMargin    True will calculate difference to initial margin, fals to maintenance margin
     * @return  The available margin of the trader in the perpetual. If trader=AMM margin is calculated at index price.
     */
    function getAvailableMargin(
        bytes32 _iPerpetualId,
        address _traderAddr,
        bool _isInitialMargin
    ) external view override returns (int128) {
        PerpStorage.PerpetualData memory perpetual = _getPerpetual(_iPerpetualId);
        return _getAvailableMargin(perpetual, _traderAddr, _isInitialMargin);
    }

    function _getAvailableMargin(
        PerpStorage.PerpetualData memory _perpetual,
        address _traderAddr,
        bool _isInitialMargin
    ) internal view returns (int128) {
        int128 fInitialMarginCC;
        if (marginAccounts[_perpetual.id][_traderAddr].fPositionBC != 0) {
            // if the position remains open, we reserve the initial/maintenance margin at the current price
            if (_isInitialMargin) {
                fInitialMarginCC = _getInitialMargin(_perpetual, _traderAddr);
            } else {
                fInitialMarginCC = _getMaintenanceMargin(_perpetual, _traderAddr);
            }
        }
        
        int128 fAvailableMargin = _getMarginBalance(_perpetual, _traderAddr);
        fAvailableMargin = fAvailableMargin.sub(fInitialMarginCC);

        return fAvailableMargin;
    }

    /**
     * @dev     Check if the trader is initial margin safe in the perpetual, which means available margin >= 0
     * @param   _iPerpetualId   The perpetual id
     * @param   _traderAddr      The address of the trader
     * @return  boolean, true if the trader is initial margin safe in the perpetual
     */
    function isInitialMarginSafe(bytes32 _iPerpetualId, address _traderAddr) external view override returns (bool) {
        PerpStorage.PerpetualData memory perpetual = _getPerpetual(_iPerpetualId);
        return (_getAvailableMargin(perpetual, _traderAddr, true) >= 0);
    }

    /**
     * @dev Get the initial margin of the trader in the perpetual in collateral currency.
     *      Initial margin = price * abs(position) * initial margin rate
     * @param _iPerpetualId        The perpetual id
     * @param _traderAddr       The address of the trader
     * @return The initial margin of the trader in the perpetual. If trader=AMM margin is calculated at index price.
     */
    function getInitialMargin(bytes32 _iPerpetualId, address _traderAddr) external view override returns (int128) {
        PerpStorage.PerpetualData memory perpetual = _getPerpetual(_iPerpetualId);
        return _getInitialMargin(perpetual, _traderAddr);
    }

    function _getInitialMargin(PerpStorage.PerpetualData memory _perpetual, address _traderAddr) internal view returns (int128) {
        bool isMark = _traderAddr != address(this);
        // base to collateral currency conversion
        int128 fConversionB2C = _getBaseToCollateralConversionMultiplier(_perpetual, isMark);
        int128 pos = marginAccounts[_perpetual.id][_traderAddr].fPositionBC;
        int128 m = _getInitialMarginRate(pos, _perpetual);
        return pos.mul(fConversionB2C).mul(m).abs();
    }

    /**
     * @dev Get the maintenance margin of the trader in the perpetual in collateral currency.
     *      Maintenance margin = price * abs(position) * maintenance margin rate
     * @param _iPerpetualId        The perpetual id
     * @param _traderAddr       The address of the trader
     * @return The maintenance margin of the trader in the perpetual
     */
    function getMaintenanceMargin(bytes32 _iPerpetualId, address _traderAddr) external view override returns (int128) {
        PerpStorage.PerpetualData memory perpetual = _getPerpetual(_iPerpetualId);
        return _getMaintenanceMargin(perpetual, _traderAddr);
    }

    function _getMaintenanceMargin(PerpStorage.PerpetualData memory _perpetual, address _traderAddr) internal view returns (int128) {
        // base to collateral currency conversion
        bool atMark = _traderAddr != address(this);
        int128 fConversionB2C = _getBaseToCollateralConversionMultiplier(_perpetual, atMark);
        int128 pos = marginAccounts[_perpetual.id][_traderAddr].fPositionBC;
        int128 m = _getMaintenanceMarginRate(pos, _perpetual);
        return pos.mul(fConversionB2C).mul(m).abs();
    }

    /**
     * Calculate maintenance margin rate (alpha_mntnc + beta * pos)
     * @param _fPositionSizeBC  The position size
     * @param _perpetual        The perpetual object
     * @return maintenance margin rate (=1/leverage)
     */
    function _getMaintenanceMarginRate(int128 _fPositionSizeBC, PerpetualData memory _perpetual) internal pure returns (int128) {
        int128 m = _getInitialMarginRate(_fPositionSizeBC, _perpetual);
        m = m.sub(_perpetual.fInitialMarginRateAlpha.sub(_perpetual.fMaintenanceMarginRateAlpha));
        return m;
    }

    /**
     * Check if the trader's margin safe in the perpetual, which means margin >= 0 or position=0
     * @param   _iPerpetualId   The perpetual id
     * @param   _traderAddr     The address of the trader
     * @return  True if the trader is initial margin safe in the perpetual
     */
    function isMarginSafe(bytes32 _iPerpetualId, address _traderAddr) external view override returns (bool) {
        PerpStorage.PerpetualData memory perpetual = _getPerpetual(_iPerpetualId);
        if (_getTraderPosition(perpetual, _traderAddr) == 0) {
            return true;
        }
        return _getMarginBalance(perpetual, _traderAddr) >= 0;
    }

    /**
     * Get the trader (or AMM) position (in base currency) in the perpetual
     * @param _perpetual The perpetual object
     * @param _traderAddr The address of the trader
     * @return The trader position of in the perpetual
     */
    function _getTraderPosition(PerpStorage.PerpetualData memory _perpetual, address _traderAddr) internal view returns (int128) {
        return marginAccounts[_perpetual.id][_traderAddr].fPositionBC;
    }

    /**
     * Calculate initial margin rate (alpha_initial + beta * pos)
     * @param _fPositionSizeBC  The position size
     * @param _perpetual        The perpetual object
     * @return initial margin rate (=1/leverage)
     */
    function _getInitialMarginRate(int128 _fPositionSizeBC, PerpStorage.PerpetualData memory _perpetual) internal pure returns (int128) {
        int128 m = _perpetual.fInitialMarginRateAlpha.add(_perpetual.fMarginRateBeta.mul(_fPositionSizeBC.abs()));
        if (m > _perpetual.fInitialMarginRateCap) {
            m = _perpetual.fInitialMarginRateCap;
        }
        return m;
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualMarginViewLogic");
        bytes4[] memory functionList = new bytes4[](8);
        functionList[0] = this.calcMarginForTargetLeverage.selector;
        functionList[1] = this.getMarginBalance.selector;
        functionList[2] = this.isMaintenanceMarginSafe.selector;
        functionList[3] = this.getAvailableMargin.selector;
        functionList[4] = this.isInitialMarginSafe.selector;
        functionList[5] = this.getInitialMargin.selector;
        functionList[6] = this.getMaintenanceMargin.selector;
        functionList[7] = this.isMarginSafe.selector;
        return (functionList, moduleName);
    }
}
