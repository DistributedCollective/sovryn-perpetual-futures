// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/core/PerpStorage.sol";

interface IMockPerpetualTradeLogic {
    function validatePrice(
        bool _isLong,
        int128 _fPrice,
        int128 _fPriceLimit
    ) external pure;

    function shrinkToMaxPositionToClose(int128 _fPosition, int128 _fAmount) external view returns (int128);

    function updateAverageTradeExposures(bytes32 _iPerpetualId, int128 _fTradeAmount) external;

    function updateMargin(
        bytes32 _iPerpetualId,
        address _traderAddr,
        int128 _fDeltaPosition,
        int128 _fDeltaCashCC,
        int128 _fDeltaLockedInValueQC
    ) external;

    function transferFee(
        uint16 _poolId,
        bytes32 _iPerpetualId,
        address _traderAddr,
        address _referrerAddr,
        int128 _fPnLparticipantFee,
        int128 _fReferralRebate,
        int128 _fDefaultFundContribution,
        int128 _fAMMCashContribution
    ) external;

    function queryPriceFromAMM(bytes32 _iPerpetualId, int128 _fTradeAmount) external view returns (int128);

    function calculateContributions(uint16 _poolId, int128 _fTreasuryFee) external view returns (int128, int128);

    function calculateFees(
        bytes32 _iPerpetualId,
        address _traderAddr,
        address _referrerAddr,
        int128 _fDeltaPosCC,
        bool _hasOpened
    )
        external
        view
        returns (
            int128,
            int128,
            int128
        );

    function roundToLot(int128 _fAmountBC, int128 fLotSizeBC) external view returns (int128);
}
