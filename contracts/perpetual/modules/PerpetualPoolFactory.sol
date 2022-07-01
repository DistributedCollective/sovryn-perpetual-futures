// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import "../../oracle/OracleInterfaceID.sol";
import "./../functions/PerpetualUpdateFunctions.sol";
import "./../interfaces/IPerpetualPoolFactory.sol";
import "./../interfaces/IFunctionList.sol";
import "../../libraries/Utils.sol";

contract PerpetualPoolFactory is PerpetualUpdateFunctions, OracleInterfaceID, IFunctionList, IPerpetualPoolFactory {
    using ABDKMath64x64 for int128;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
    using ERC165Checker for address;

    function setPerpetualPoolFactory(address _shareTokenFactory) external override onlyOwner {
        shareTokenFactory = IShareTokenFactory(_shareTokenFactory);
    }

    /**
     * @notice Created new liquidity pool.
     *
     * @param   _treasuryAddress             The address of the protocol treasury.
     * @param   _marginTokenAddress          The address of the margin token.
     * @param   _iTargetPoolSizeUpdateTime   The timestamp in seconds.
     * @return Pool id
     */
    function createLiquidityPool(
        address _treasuryAddress,
        address _marginTokenAddress,
        uint64 _iTargetPoolSizeUpdateTime,
        uint64 _iPnLparticipantWithdrawalPeriod,
        int128 _fPnLparticipantWithdrawalPercentageLimit,
        int128 _fPnLparticipantWithdrawalMinAmountLimit,
        int128 _fMaxTotalTraderFunds
    ) external override onlyOwner returns (uint16) {
        _validateTreasuryAddress(_treasuryAddress);
        require(_marginTokenAddress != address(this) && _marginTokenAddress != address(0), "invalid marginTokenAddress");
        _validateTargetPoolSizeUpdateTime(_iTargetPoolSizeUpdateTime);
        _validateWithdrawaLimit(_iPnLparticipantWithdrawalPeriod, _fPnLparticipantWithdrawalPercentageLimit, _fPnLparticipantWithdrawalMinAmountLimit);

        iPoolCount++;
        LiquidityPoolData storage pool = liquidityPools[iPoolCount];
        pool.id = iPoolCount;
        pool.treasuryAddress = _treasuryAddress;

        pool.marginTokenAddress = _marginTokenAddress;
        pool.shareTokenAddress = shareTokenFactory.createShareToken();
        pool.iTargetPoolSizeUpdateTime = _iTargetPoolSizeUpdateTime;

        pool.iPnLparticipantWithdrawalPeriod = _iPnLparticipantWithdrawalPeriod;
        pool.fPnLparticipantWithdrawalPercentageLimit = _fPnLparticipantWithdrawalPercentageLimit;
        pool.fPnLparticipantWithdrawalMinAmountLimit = _fPnLparticipantWithdrawalMinAmountLimit;
        pool.fMaxTotalTraderFunds = _fMaxTotalTraderFunds;

        emit LiquidityPoolCreated(
            pool.id,
            _treasuryAddress,
            _marginTokenAddress,
            pool.shareTokenAddress,
            _iTargetPoolSizeUpdateTime,
            _iPnLparticipantWithdrawalPeriod,
            _fPnLparticipantWithdrawalPercentageLimit,
            _fPnLparticipantWithdrawalMinAmountLimit
        );

        return iPoolCount;
    }

    function setTargetPoolSizeUpdateTime(uint16 _poolId, uint64 _iTargetPoolSizeUpdateTime) external override onlyOwner {
        require(_poolId <= iPoolCount, "pool index out of range");
        _validateTargetPoolSizeUpdateTime(_iTargetPoolSizeUpdateTime);
        LiquidityPoolData storage pool = liquidityPools[_poolId];
        pool.iTargetPoolSizeUpdateTime = _iTargetPoolSizeUpdateTime;
        emit SetTargetPoolSizeUpdateTime(_poolId, _iTargetPoolSizeUpdateTime);
    }

    function setWithdrawalLimit(
        uint16 _poolId,
        uint64 _iPnLparticipantWithdrawalPeriod,
        int128 _fPnLparticipantWithdrawalPercentageLimit,
        int128 _fPnLparticipantWithdrawalMinAmountLimit
    ) external override onlyOwner {
        require(_poolId <= iPoolCount, "pool index out of range");
        _validateWithdrawaLimit(_iPnLparticipantWithdrawalPeriod, _fPnLparticipantWithdrawalPercentageLimit, _fPnLparticipantWithdrawalMinAmountLimit);
        LiquidityPoolData storage pool = liquidityPools[_poolId];
        pool.iPnLparticipantWithdrawalPeriod = _iPnLparticipantWithdrawalPeriod;
        pool.fPnLparticipantWithdrawalPercentageLimit = _fPnLparticipantWithdrawalPercentageLimit;
        pool.fPnLparticipantWithdrawalMinAmountLimit = _fPnLparticipantWithdrawalMinAmountLimit;
        emit SetWithdrawalLimit(_poolId, _iPnLparticipantWithdrawalPeriod, _fPnLparticipantWithdrawalPercentageLimit, _fPnLparticipantWithdrawalMinAmountLimit);
    }

    function _validateTreasuryAddress(address _treasuryAddress) internal view {
        require(_treasuryAddress != address(this) && _treasuryAddress != address(0), "invalid treasuryAddress");
    }

    function _validateTargetPoolSizeUpdateTime(uint64 _iTargetPoolSizeUpdateTime) internal pure {
        require(_iTargetPoolSizeUpdateTime >= 30 && _iTargetPoolSizeUpdateTime <= uint64(1 weeks), "invalid iTargetPoolSizeUpdateTime");
    }

    function _validateWithdrawaLimit(
        uint64 _iPnLparticipantWithdrawalPeriod,
        int128 _fPnLparticipantWithdrawalPercentageLimit,
        int128 _fPnLparticipantWithdrawalMinAmountLimit
    ) internal pure {
        require(_iPnLparticipantWithdrawalPeriod > 0 && _iPnLparticipantWithdrawalPeriod <= uint64(1 weeks), "invalid iPnLparticipantWithdrawalPeriod");
        require(
            _fPnLparticipantWithdrawalPercentageLimit > 0 && _fPnLparticipantWithdrawalPercentageLimit < ONE_64x64,
            "invalid fPnLparticipantWithdrawalPercentageLimit"
        );
        require(_fPnLparticipantWithdrawalMinAmountLimit > 0, "invalid fPnLparticipantWithdrawalMinAmountLimit");
    }

    /**
     * Run the liquidity pool. Can only called by the governance. Governance can create new
     * perpetual before or after running
     *
     * @param   _liqPoolID   Id that points to liquidity pool.
     */
    function runLiquidityPool(uint16 _liqPoolID) external override onlyOwner {
        require(_liqPoolID <= iPoolCount, "pool index out of range");
        LiquidityPoolData storage liquidityPool = liquidityPools[_liqPoolID];
        require(!liquidityPool.isRunning, "the liquidity pool is already running");

        uint256 length = liquidityPool.iPerpetualCount;
        require(length > 0, "there should be at least 1 perpetual to run");
        int128 fAMMFundCashCCSum;
        int128 fMinTargetSum;
        for (uint256 i = 0; i < length; i++) {
            bytes32 idx = perpetualIds[liquidityPool.id][i];
            PerpetualData storage perpetual = perpetuals[liquidityPool.id][idx];
            int128 fMinTarget = perpetual.fAMMMinSizeCC;
            if (perpetual.state == PerpetualState.INITIALIZING) {
                fAMMFundCashCCSum = fAMMFundCashCCSum.add(perpetual.fAMMFundCashCC);
                perpetual.fTargetAMMFundSize = fMinTarget;
                perpetual.fTargetDFSize = fMinTarget;
                fMinTargetSum = fMinTargetSum.add(fMinTarget);
                _setNormalState(perpetual);
            }
        }
        liquidityPool.fTargetDFSize = fMinTargetSum;
        liquidityPool.fTargetAMMFundSize = fMinTargetSum;
        liquidityPool.fAMMFundCashCC = fAMMFundCashCCSum;
        require(liquidityPool.fAMMFundCashCC > 0, "AMM pool cash required to run liquidity pool");

        liquidityPool.isRunning = true;
        emit RunLiquidityPool(_liqPoolID);

        _updateOraclePricesForPool(_liqPoolID);
    }

    function setAMMPerpLogic(address _AMMPerpLogic) external override onlyOwner {
        require(_AMMPerpLogic != address(0), "invalid address");
        ammPerpLogic = _AMMPerpLogic;
    }

    function setTreasury(uint16 _poolId, address _treasury) external override onlyOwner {
        require(_poolId <= iPoolCount, "pool index out of range");
        _validateTreasuryAddress(_treasury);
        LiquidityPoolData storage pool = liquidityPools[_poolId];
        address oldTreasury = pool.treasuryAddress;
        pool.treasuryAddress = _treasury;
        emit TransferTreasuryTo(_poolId, oldTreasury, _treasury);
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualPoolFactory");
        bytes4[] memory functionList = new bytes4[](7);
        functionList[0] = this.setPerpetualPoolFactory.selector;
        functionList[1] = this.createLiquidityPool.selector;
        functionList[2] = this.runLiquidityPool.selector;
        functionList[3] = this.setAMMPerpLogic.selector;
        functionList[4] = this.setTreasury.selector;
        functionList[5] = this.setTargetPoolSizeUpdateTime.selector;
        functionList[6] = this.setWithdrawalLimit.selector;
        return (functionList, moduleName);
    }
}
