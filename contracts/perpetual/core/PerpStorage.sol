// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

//import "@openzeppelin/contracts-upgradeable/utils/EnumerableSetUpgradeable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "../../interface/IShareTokenFactory.sol";
import "../../libraries/ABDKMath64x64.sol";
import "./../functions/AMMPerpLogic.sol";
import "../../libraries/EnumerableSetUpgradeable.sol";
import "../../libraries/EnumerableBytes4Set.sol";
import "../../gsn/BaseRelayRecipient.sol";

contract PerpStorage is Ownable, ReentrancyGuard, BaseRelayRecipient {
    using ABDKMath64x64 for int128;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
    using EnumerableBytes4Set for EnumerableBytes4Set.Bytes4Set; // enumerable map of bytes4 or addresses
    /**
     * @notice  Perpetual state:
     *          - INVALID:      Uninitialized or not non-existent perpetual.
     *          - INITIALIZING: Only when LiquidityPoolData.isRunning == false. Traders cannot perform operations.
     *          - NORMAL:       Full functional state. Traders are able to perform all operations.
     *          - EMERGENCY:    Perpetual is unsafe and the perpetual needs to be settled.
     *          - CLEARED:      All margin accounts are cleared. Traders can withdraw remaining margin balance.
     */
    enum PerpetualState {
        INVALID,
        INITIALIZING,
        NORMAL,
        EMERGENCY,
        CLEARED
    }

    // margin and liquidity pool are held in 'collateral currency' which can be either of
    // quote currency, base currency, or quanto currency

    int128 internal constant ONE_64x64 = 0x10000000000000000; // 2^64
    int128 internal constant FUNDING_INTERVAL_SEC = 0x70800000000000000000; //3600 * 8 * 0x10000000000000000 = 8h in seconds scaled by 2^64 for ABDKMath64x64
    int128 internal constant CEIL_PNL_SHARE = 0xc000000000000000; //=0.75: participants get PnL proportional to min[PFund/(PFund+allAMMFundSizes), 75%]
    int128 internal constant CEIL_AMT_FUND_WITHDRAWAL = 0xc000000000000000; //=0.75: maximal relative amount we withdraw from the default fund and stakers in rebalance
    int128 internal constant PRICE_MOVE_THRESHOLD = 0x068db8bac710cb; //0.0001... =1 bps: if index price changes more than that, we rebalance
    int128 internal constant MIN_NUM_LOTS_PER_POSITION = 0x0a0000000000000000; // 10, minimal position size in number of lots
    // at target, 1% of missing amount is transferred
    // at every rebalance
    bool internal whitelistActive;
    uint16 internal iPoolCount;
    address internal ammPerpLogic;

    IShareTokenFactory internal shareTokenFactory;

    //pool id (incremental index, starts from 1) => pool data
    mapping(uint16 => LiquidityPoolData) internal liquidityPools;

    //bytes32 id = keccak256(abi.encodePacked(poolId, perpetualIndex));
    //perpetual id (hash(poolId, perpetualIndex)) => pool id
    mapping(bytes32 => uint16) internal perpetualPoolIds;

    /**
     * @notice  Data structure to store oracle price data.
     */
    struct OraclePriceData {
        int128 fPrice;
        uint64 time;
        bool isInSignificant; // set to true if price change is not significant
    }

    /**
     * @notice  Data structure to store user margin information.
     */
    struct MarginAccount {
        int128 fLockedInValueQC; // unrealized value locked-in when trade occurs in
        int128 fCashCC; // cash in collateral currency (base, quote, or quanto)
        int128 fPositionBC; // position in base currency (e.g., 1 BTC for BTCUSD)
        int128 fUnitAccumulatedFundingStart; // accumulated funding rate
        bytes32 positionId; // unique id for the position (for given trader, and perpetual). Current position, zero otherwise.
    }

    /**
     * @notice  Store information for a given perpetual market.
     */
    struct PerpetualData {
        // Perpetual AMM state
        PerpetualState state;
        //keccak256(abi.encodePacked(poolId, perpetualIndex)), perpetualIndex starts from 1
        uint16 poolId;
        
        address oracleS2Addr; //parameter: base-quote pair
        address oracleS3Addr; //parameter: quanto index
        
        //prices
        OraclePriceData currentMarkPremiumRate; //relative diff to index price EMA, used for markprice.. was: currentPremiumRateEMA
        int128 fCurrentPremiumRate; //signed relative diff to index price
        int128 fSettlementMarkPremiumRate; //relative diff to index price EMA, used for markprice..was: settlementPremiumRateEMA
        int128 fSettlementS2PriceData; //base-quote pair
        int128 fSettlementS3PriceData; //quanto index
        int128 premiumRatesEMA; // EMA of premium rate
        // funding state
        int128 fCurrentFundingRate;
        int128 fUnitAccumulatedFunding; //accumulated funding in collateral currency
        
        int128 fOpenInterest; //open interest is the amount of long positions in base currency or, equiv., the amount of short positions.
        int128 fAMMFundCashCC; // fund-cash in this perpetual - not margin
        int128 fkStar; // signed trade size that minimizes the AMM risk
        int128 fkStarSide; // corresponds to sign(-k*)
        // base parameters
        int128 fInitialMarginRateAlpha; //parameter: initial margin
        int128 fMarginRateBeta; //parameter: initial margin increase factor m=alpha+beta*pos
        int128 fInitialMarginRateCap; //parameter: initial margin stops growing at cap
        int128 fMaintenanceMarginRateAlpha; //parameter: required maintenance margin
        int128 fTreasuryFeeRate; //parameter: fee that the treasury earns
        int128 fPnLPartRate; //parameter: fee that the PnL participants earn
        int128 fReferralRebateCC; //parameter: referall rebate in collateral currency
        int128 fLiquidationPenaltyRate; //parameter: penalty if AMM closes the position and not the trader
        int128 fMinimalSpread; //parameter: minimal spread between long and short perpetual price
        int128 fMinimalSpreadInStress; //parameter: minimal spread between long and short perpetual price if Default Fund underfunded
        int128 fLotSizeBC; //parameter: minimal trade unit (in base currency) to avoid dust positions
        // risk parameters for underlying instruments
        int128 fFundingRateClamp; // parameter: funding rate clamp between which we charge 1bps
        int128 fMarkPriceEMALambda; // parameter: Lambda parameter for EMA used in mark-price for funding rates
        int128 fSigma2; // parameter: volatility of base-quote pair
        int128 fSigma3; // parameter: volatility of quanto-quote pair
        int128 fRho23; // parameter: correlation of quanto/base returns
        AMMPerpLogic.CollateralCurrency eCollateralCurrency; //parameter: in what currency is the collateral held?
        // risk parameters for default fund / AMM fund
        int128[2] fStressReturnS2; // parameter: negative and positive stress returns for base-quote asset
        int128[2] fStressReturnS3; // parameter: negative and positive stress returns for quanto-quote asset
        int128 fDFCoverNRate; // parameter: cover-n rule for default fund. E.g., fDFCoverNRate=0.05 -> we try to cover 5% of active accounts with default fund
        int128[2] fDFLambda; // parameter: EMA lambda for AMM and trader exposure K,k: EMA*lambda + (1-lambda)*K. 0 regular lambda, 1 if current value exceeds past
        int128[2] fAMMTargetDD; // parameter: target distance to default (=inverse of default probability), [0] baseline [1] stress
        int128 fAMMMinSizeCC; // parameter: minimal size of AMM pool, regardless of current exposure
        int128 fMinimalTraderExposureEMA; // parameter: minimal value for fCurrentTraderExposureEMA that we don't want to undershoot
        int128 fMinimalAMMExposureEMA; // parameter: minimal value for fCurrentTraderExposureEMA that we don't want to undershoot
        int128 fMaximalTradeSizeBumpUp; // parameter: >1, users can create a maximal position of size fMaximalTradeSizeBumpUp*fCurrentAMMExposureEMA
        //  this is to avoid overly large trades that would put the AMM at risk

        // users
        int128 fTotalMarginBalance; //calculated for settlement, in collateral currency
        int128 fMaxPositionBC; // max position in base currency (e.g., 1 BTC for BTCUSD);

        // state: default fund sizing
        int128 fTargetAMMFundSize; //target AMM fund size
        int128 fTargetDFSize; // target default fund size
        int128[2] fCurrentAMMExposureEMA; // 0: negative aggregated exposure (storing negative value), 1: positive
        int128 fCurrentTraderExposureEMA; // trade amounts (storing absolute value)
        
        bytes32 id;
        bool isBaselineAMMFundState; // whether to rebalance towards fAMMTargetDD[0] or fAMMTargetDD[1]
        uint64 iLastFundingTime; //timestamp since last funding rate payment
        uint64 iPriceUpdateTimeSec; // timestamp since last oracle update
        uint64 iLastTargetPoolSizeTime; //timestamp (seconds) since last update of fTargetDFSize and fTargetAMMFundSize
    }

    // users
    mapping(bytes32 => EnumerableSetUpgradeable.AddressSet) internal activeAccounts; //perpetualId => traderAddressSet
    // accounts
    mapping(bytes32 => mapping(address => MarginAccount)) internal marginAccounts;

    struct Checkpoint {
        uint64 timestamp;
        int128 amount; //amount of tokens returned
    }

    struct LiquidityPoolData {
        //index, starts from 1
        uint16 id;
        uint64 iTargetPoolSizeUpdateTime; //parameter: timestamp in seconds. How often would we want to update the target size of the pool?
        //parameters
        address treasuryAddress; // parameter: address for the protocol treasury
        address marginTokenAddress; //parameter: address of the margin token
        address shareTokenAddress; //
        
        // liquidity state (held in collateral currency)
        int128 fPnLparticipantsCashCC; //addLiquidity/removeLiquidity + profit/loss - rebalance
        int128 fAMMFundCashCC; //profit/loss - rebalance (sum of cash in individual perpetuals)
        int128 fDefaultFundCashCC; //profit/loss
        int128 fTargetAMMFundSize; //target AMM pool size for all perpetuals in pool (sum)
        int128 fTargetDFSize; //target default fund size for all perpetuals in pool        
        
        // Liquidity provider restrictions
        //percentage of total fPnLparticipantsCashCC (e.g. 10%)
        int128 fPnLparticipantWithdrawalPercentageLimit;
        //the withdrawal limitation period
        uint64 iPnLparticipantWithdrawalPeriod;//<--TODO UINT64
        
        //minimum amount of tokens to be restricted for the withdrawal (e.g. 1000)
        int128 fPnLparticipantWithdrawalMinAmountLimit;
        int128 fRedemptionRate; // used for settlement in case of AMM default
        int128 fMaxTotalTraderFunds; // total trader funds allowed across all perpetuals in this pool
        uint16 iPerpetualCount;
        bool isRunning;
    }
    
    //pool id => perpetual id list
    mapping(uint16 => bytes32[]) internal perpetualIds;

    //pool id => perpetual id => data
    mapping(uint16 => mapping(bytes32 => PerpetualData)) internal perpetuals;

    //pool id => user => array of checkpoint data
    mapping(uint16 => mapping(address => Checkpoint[])) internal checkpoints;

    /// @dev user => flag whether user has admin role.
    /// @dev recommended that multisig be an admin
    //mapping(address => bool) internal ammGovernanceAddresses;
    EnumerableSetUpgradeable.AddressSet internal ammGovernanceAddresses;

    /// @dev flag whether MarginTradeOrder was already executed
    mapping(bytes32 => bool) internal executedOrders;

    /// @dev flag whether MarginTradeOrder was canceled
    mapping(bytes32 => bool) internal canceledOrders;

    //current prices
    mapping(address => OraclePriceData) internal oraclePriceData;

    EnumerableSetUpgradeable.AddressSet internal whitelisted;  

    mapping(bytes32 => EnumerableBytes4Set.Bytes4Set) internal moduleActiveFuncSignatureList;
    mapping(bytes32 => address) internal moduleNameToAddress;
    mapping(address => bytes32) internal moduleAddressToModuleName;
}
