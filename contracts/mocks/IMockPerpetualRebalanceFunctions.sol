// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/functions/AMMPerpLogic.sol";
import "../perpetual/interfaces/IPerpetualRebalanceLogic.sol";

interface IMockPerpetualRebalanceFunctions is IPerpetualRebalanceLogic {
    function splitAmount(
        uint16 _iPoolIndex,
        int128 _fAmount,
        bool _isWithdrawn
    ) external view returns (int128, int128);

    function hasTheSameSign(int128 _fX, int128 _fY) external pure returns (bool);

    function increaseAMMFundCashForPerpetual(bytes32 _iPerpetualId, int128 _fAmount) external;

    function hasOpenedPosition(int128 _fNewPos, int128 fDeltaPos) external pure returns (bool);

    function transferFromAMMMarginToPool(bytes32 _iPerpetualId, int128 _fAmount) external;

    function decreaseAMMFundCashForPerpetual(bytes32 _iPerpetualId, int128 _fAmount) external;

    function transferFromPoolToAMMMargin(bytes32 _iPerpetualId, int128 _fAmount) external;

    function getRebalanceMargin(bytes32 _iPerpetualId) external view returns (int128);

    function equalizeAMMMargin(bytes32 _iPerpetualId) external;

    function updateKStar(bytes32 _iPerpetualId) external;
}
