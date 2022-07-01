// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/core/PerpStorage.sol";
import "../perpetual/functions/AMMPerpLogic.sol";

interface IMockPerpetualBaseFunctions {
    function getBaseToCollateralConversionMultiplier(bytes32 _iPerpetualId, bool _isMarkPriceRequest) external view returns (int128);

    function getCollateralToQuoteConversionMultiplier(bytes32 _iPerpetualId) external view returns (int128);

    function updateMarkPrice(bytes32 _iPerpetualId) external;

    function prepareAMMAndMarketData(bytes32 _iPerpetualId, int128 _fTradeAmount)
        external
        returns (AMMPerpLogic.AMMVariables memory, AMMPerpLogic.MarketVariables memory);

    function transferFromUserToVault(
        address _marginTknAddr,
        address _userAddr,
        int128 _fAmount
    ) external;

    function transferFromVaultToUser(
        address _marginTknAddr,
        address _traderAddr,
        int128 _fAmount
    ) external;

    function getTotalTraderFunds(bytes32 _iPerpetualId) external view returns (int128);
}
