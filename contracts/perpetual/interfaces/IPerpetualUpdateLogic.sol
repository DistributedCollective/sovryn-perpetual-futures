// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IPerpetualUpdateLogic {
    function updateAMMTargetFundSize(bytes32 _iPerpetualId, int128 fTargetFundSize) external;

    function updateDefaultFundTargetSizeRandom(uint16 _iPoolIndex) external;

    function updateDefaultFundTargetSize(bytes32 _iPerpetualId) external;

    function updateFundingAndPricesBefore(bytes32 _iPerpetualId0, bytes32 _iPerpetualId1) external;

    function updateFundingAndPricesAfter(bytes32 _iPerpetualId0, bytes32 _iPerpetualId1) external;
}
