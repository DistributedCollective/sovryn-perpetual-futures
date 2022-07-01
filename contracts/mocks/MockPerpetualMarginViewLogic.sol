// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/modules/PerpetualMarginViewLogic.sol";

contract MockPerpetualMarginViewLogic is PerpetualMarginViewLogic {
    /**
     * Calculate maintenance margin rate (alpha_mntnc + beta * pos)
     * @param _fPositionSizeBC  The position size
     * @param _perpetual        The perpetual object
     * @return maintenance margin rate (=1/leverage)
     */
    function getMaintenanceMarginRate(int128 _fPositionSizeBC, PerpetualData memory _perpetual) external pure returns (int128) {
        return _getMaintenanceMarginRate(_fPositionSizeBC, _perpetual);
    }

    /**
     * Calculate initial margin rate (alpha_initial + beta * pos)
     * @param _fPositionSizeBC  The position size
     * @param _perpetual        The perpetual object
     * @return initial margin rate (=1/leverage)
     */
    function getInitialMarginRate(int128 _fPositionSizeBC, PerpStorage.PerpetualData memory _perpetual) external pure returns (int128) {
        return _getInitialMarginRate(_fPositionSizeBC, _perpetual);
    }
}
