// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IPerpetualFactory {
    function createPerpetual(
        uint16 _iPoolId,
        address[2] calldata _oracles,
        int128[11] calldata _baseParams,
        int128[5] calldata _underlyingRiskParams,
        int128[13] calldata _defaultFundRiskParams,
        uint256 _eCollateralCurrency
    ) external;

    function activatePerpetual(bytes32 _perpetualId) external;

    function setEmergencyState(bytes32 _iPerpetualId) external;

    function setPerpetualOracles(bytes32 _iPerpetualId, address[2] calldata _oracles) external;

    function setPerpetualBaseParams(bytes32 _iPerpetualId, int128[11] calldata _baseParams) external;

    function setPerpetualRiskParams(
        bytes32 _iPerpetualId,
        int128[5] calldata _underlyingRiskParams,
        int128[13] calldata _defaultFundRiskParams
    ) external;

    function setPerpetualParam(
        bytes32 _iPerpetualId,
        string memory _varName,
        int128 _value
    ) external;

    function setPerpetualParamPair(
        bytes32 _iPerpetualId,
        string memory _name,
        int128 _value1,
        int128 _value2
    ) external;
}
