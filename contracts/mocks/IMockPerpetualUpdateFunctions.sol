// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/functions/AMMPerpLogic.sol";

interface IMockPerpetualUpdateFunctions {
    function mockUpdateAMMTargetFundSize(bytes32 _iPerpetualId, int128 _fTargetDD) external;

    function mockUpdateDefaultFundTargetSizeRandom(uint16 _iPoolIndex, bool force) external;
    function mockUpdateDefaultFundTargetSize(bytes32 _iPerpetualId, bool force) external;

    function mockGetUpdatedTargetAMMFundSize(bytes32 _iPerpetualId, bool isBaseline) external view returns (int128);

    function accumulateFundingInPerp(bytes32 _iPerpIdx, uint64 _iCurrentTS) external;

    function updateFundingRatesInPerp(bytes32 _iPerpetualId) external;

    function updateFundingRate(bytes32 _iPerpetualId) external;
    
    function increaseDefaultFundCash(uint16 _iPoolIndex, int128 _fAmount) external;
    
    function updateOraclePricesForPool(uint16 _iPoolIndex) external;
}
