// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/core/PerpStorage.sol";

interface IMockPerpetualLiquidator {
    function getPositionAmountToLiquidate(bytes32 _iPerpetualId, address _traderAddr) external view returns (int128);

    function getBaseToQuoteConversionMultiplier(bytes32 _iPerpetualId, bool _isMarkPriceRequest) external view returns (int128);
}
