// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;
import "./IPerpetualOrder.sol";

/**
 * @notice  The libraryEvents defines events that will be raised from modules (contract/modules).
 * @dev     DO REMEMBER to add new events in modules here.
 */
interface ISOVLibraryEvents {
    // PerpetualModule
    event Clear(bytes32 indexed perpetualId, address indexed trader);
    event Settle(bytes32 indexed perpetualId, address indexed trader, int256 amount);
    event SetNormalState(bytes32 indexed perpetualId);
    event SetEmergencyState(
        bytes32 indexed perpetualId,
        int128 fSettlementMarkPremiumRate,
        int128 fSettlementS2Price,
        int128 fSettlementS3Price
    );
    event SetClearedState(bytes32 indexed perpetualId);
    event UpdateUnitAccumulatedFunding(bytes32 perpetualId, int128 unitAccumulativeFunding);

    // Participation pool
    event LiquidityAdded(uint64 indexed poolId, address indexed user, uint256 tokenAmount, uint256 shareAmount);
    event LiquidityRemoved(uint64 indexed poolId, address indexed user, uint256 tokenAmount, uint256 shareAmount);

    // setters
    event SetOracles(bytes32 indexed perpetualId, address[2] oracles);
    event SetPerpetualBaseParameters(bytes32 indexed perpetualId, int128[11] baseParams);
    event SetPerpetualRiskParameters(bytes32 indexed perpetualId, int128[5] underlyingRiskParams, int128[13] defaultFundRiskParams);
    event TransferTreasuryTo(uint64 indexed poolId, address oldTreasury, address newTreasury);
    event SetParameter(bytes32 indexed perpetualId, string name, int128 value);
    event SetParameterPair(bytes32 indexed perpetualId, string name, int128 value1, int128 value2);

    event SetTargetPoolSizeUpdateTime(uint16 indexed poolId, uint64 targetPoolSizeUpdateTime);
    event SetWithdrawalLimit(
        uint16 indexed poolId,
        uint64 PnLparticipantWithdrawalPeriod,
        int128 PnLparticipantWithdrawalPercentageLimit,
        int128 PnLparticipantWithdrawalMinAmountLimit
    );

    // funds
    event UpdateAMMFundCash(bytes32 indexed perpetualId, int128 fNewAMMFundCash, int128 fNewLiqPoolTotalAMMFundsCash);
    event UpdateParticipationFundCash(uint16 indexed poolId, int128 fDeltaAmountCC, int128 fNewFundCash);
    event UpdateDefaultFundCash(uint16 indexed poolId, int128 fDeltaAmountCC, int128 fNewFundCash);

    // TradeModule
    /*event Trade(
        bytes32 indexed perpetualId,
        address indexed trader,
        bytes32 indexed positionId,
        bytes32 orderDigest,
        uint32 orderFlags,
        int128 tradeAmountBC,
        int128 newPositionSizeBC,
        int128 price,
        int128 limitPrice
    );*/
     
    event Trade(
        bytes32 indexed perpetualId,
        address indexed trader,
        bytes32 indexed positionId,
        IPerpetualOrder.Order order,
        bytes32 orderDigest,
        int128 newPositionSizeBC,
        int128 price
    );

    event UpdateMarginAccount(
        bytes32 indexed perpetualId,
        address indexed trader,
        bytes32 indexed positionId,
        int128 fPositionBC,
        int128 fCashCC,
        int128 fLockedInValueQC,
        int128 fFundingPaymentCC,
        int128 fOpenInterestBC
    );

    event Liquidate(
        bytes32 perpetualId,
        address indexed liquidator,
        address indexed trader,
        bytes32 indexed positionId,
        int128 amountLiquidatedBC,
        int128 liquidationPrice,
        int128 newPositionSizeBC
    );
    event TransferFeeToReferrer(bytes32 indexed perpetualId, address indexed trader, address indexed referrer, int128 referralRebate);
    event RealizedPnL(bytes32 indexed perpetualId, address indexed trader, bytes32 indexed positionId, int128 pnlCC);
    event PerpetualLimitOrderCancelled(bytes32 indexed orderHash);
    event DistributeFees(uint16 indexed poolId, bytes32 indexed perpetualId, address indexed trader, int128 protocolFeeCC, int128 participationFundFeeCC);

    // PerpetualManager/factory
    event RunLiquidityPool(uint16 _liqPoolID);
    event LiquidityPoolCreated(
        uint16 id,
        address treasuryAddress,
        address marginTokenAddress,
        address shareTokenAddress,
        uint64 iTargetPoolSizeUpdateTime,
        uint64 iPnLparticipantWithdrawalPeriod,
        int128 fPnLparticipantWithdrawalPercentageLimit,
        int128 fPnLparticipantWithdrawalMinAmountLimit
    );
    event PerpetualCreated(
        uint16 poolId,
        bytes32 id,
        address[2] oracles,
        int128[11] baseParams,
        int128[5] underlyingRiskParams,
        int128[13] defaultFundRiskParams,
        uint256 eCollateralCurrency
    );

    event TokensDeposited(bytes32 indexed perpetualId, address indexed trader, int128 amount);
    event TokensWithdrawn(bytes32 indexed perpetualId, address indexed trader, int128 amount);

    event UpdatePrice(
        bytes32 indexed perpetualId,
        address indexed oracleS2Addr,
        address indexed oracleS3Addr,
        int128 spotPriceS2,
        uint64 timePriceS2,
        int128 spotPriceS3,
        uint64 timePriceS3
    );

    event UpdateMarkPrice(bytes32 indexed perpetualId, int128 fMarkPricePremium, int128 fSpotIndexPrice);

    event UpdateFundingRate(bytes32 indexed perpetualId, int128 fFundingRate);

    event UpdateAMMFundTargetSize(
        bytes32 indexed perpetualId,
        uint16 indexed liquidityPoolId,
        int128 fAMMFundCashCCInPerpetual,
        int128 fTargetAMMFundSizeInPerpetual,
        int128 fAMMFundCashCCInPool,
        int128 fTargetAMMFundSizeInPool
    );

    event UpdateDefaultFundTargetSize(uint16 indexed liquidityPoolId, int128 fDefaultFundCashCC, int128 fTargetDFSize);

    event UpdateReprTradeSizes(
        bytes32 indexed perpetualId,
        int128 fCurrentTraderExposureEMA,
        int128 fCurrentAMMExposureEMAShort,
        int128 fCurrentAMMExposureEMALong
    );

    event RemoveAmmGovernanceAddress(address indexed gAddress);
    event AddAmmGovernanceAddress(address indexed gAddress);
    event TransferEarningsToTreasury(uint16 _poolId, int128 fEarnings, int128 newDefaultFundSize);
}
