// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/functions/AMMPerpLogic.sol";

interface IMockPerpetualSetter {
    function setPerpetualState(bytes32 _iPerpetualId, uint256 _state) external;

    function setPnLparticipantsCashCC(uint16 _poolId, int128 _fPnLparticipantsCashCC) external;

    function setTraderPosition(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _position
    ) external;

    function setTraderFCashCC(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _fCashCC
    ) external;

    function setMarginAccount(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _fLockedInValueQC,
        int128 _fCashCC,
        int128 _fPositionBC
    ) external;

    function setPerpetualFees(
        bytes32 _iPerpetualId,
        int128 _fTreasuryFeeRate,
        int128 _fPnLPartRate,
        int128 _fReferralRebateCC
    ) external;

    function setTargetAMMFundSize(uint16 _poolId, int128 value) external;

    function setTargetDFSize(uint16 _poolId, int128 value) external;

    function setAMMFundCashCC(uint16 _poolId, int128 value) external;

    function setDefaultFundCashCC(uint16 _poolId, int128 value) external;

    function setUnitAccumulatedFunding(bytes32 _iPerpetualId, int128 _value) external;

    function setCurrentAMMExposureEMAs(
        bytes32 _iPerpetualId,
        int128 ema0,
        int128 ema1
    ) external;

    function setCurrentTraderExposureEMA(bytes32 _iPerpetualId, int128 ema) external;

    function setDFLambda(
        bytes32 _iPerpetualId,
        int128 lambda0,
        int128 lambda1
    ) external;

    function setGenericPriceData(
        bytes32 _iPerpetualId,
        string memory _varName,
        int128 _fSPX
    ) external;

    function setGenericPerpInt128(
        bytes32 _iPerpetualId,
        string memory _varName,
        int128 _value
    ) external;

    function isStringEqual(string memory _a, string memory _b) external view returns (bool);

    function setCollateralCurrency(bytes32 _iPerpetualId, int256 _ccyIdx) external;

    function setGenericPairData(
        bytes32 _iPerpetualId,
        string memory _varName,
        int128 _value1,
        int128 _value2
    ) external;

    function setPerpPriceUpdateTime(bytes32 _iPerpetualId, uint64 _iPriceUpdateTimeSec) external;

    function setLiqPoolRedemptionRate(bytes32 _iPerpetualId, int128 _fRate) external;
}
