// SPDX-License-Identifier: MIT
/*
 * Treasury manages the liquidity pool and the default fund.
 * Treasury takes care of price updates
 */
pragma solidity 0.8.13;

import "../../libraries/ConverterDec18.sol";
import "../../interface/ISpotOracle.sol";
import "../../interface/IShareToken.sol";
import "../functions/PerpetualRebalanceFunctions.sol";
import "../interfaces/IPerpetualTreasury.sol";
import "../interfaces/IFunctionList.sol";
import "../../libraries/Utils.sol";

contract PerpetualTreasury is PerpetualRebalanceFunctions, IFunctionList, IPerpetualTreasury {
    using ABDKMath64x64 for int128;
    using ABDKMath64x64 for int256;
    using ConverterDec18 for int128;
    using ConverterDec18 for int256;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

    /**
     * @notice  Adds liquidity to the liquidity pool.
     *          Liquidity provider deposits collateral and retrieves share tokens in exchange.
     *          The ratio of added cash to share token is determined by current liquidity.
     *          Can only called when the pool is running and there are perpetuals in normal state.
     *
     * @param   _poolId         Reference to liquidity pool
     * @param   _fTokenAmount   The amount of tokens in collateral currency to add. 64.64 float
     */
    function addLiquidity(uint16 _poolId, int128 _fTokenAmount) external override 
        nonReentrant updateFundingAndPrices(bytes32(0), _poolId) 
    {
        _validateLiquidityData(_poolId, _fTokenAmount);
        LiquidityPoolData storage pool = liquidityPools[_poolId];
        _checkPoolState(pool);

        _rebalance(pool);
        address user = msgSender();
        _transferFromUserToVault(pool.marginTokenAddress, user, _fTokenAmount);

        int128 fShareToMint = _getShareAmountToMint(pool, _fTokenAmount);
        IShareToken(pool.shareTokenAddress).mint(user, fShareToMint.toUDec18());
        _increasePoolCash(pool, _fTokenAmount);

        emit LiquidityAdded(_poolId, user, _fTokenAmount.toUDec18(), fShareToMint.toUDec18());
    }

    /**
     * @notice  Adds liquidity to the AMM pool for a given perpetual.
     *
     * @param   _iPerpetualId   perpetual identifier
     * @param   _fTokenAmount   The amount of token to add. ABDK 64.64
     */
    function addAMMLiquidityToPerpetual(bytes32 _iPerpetualId, int128 _fTokenAmount) external override nonReentrant onlyAmmGovernance {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        PerpStorage.LiquidityPoolData storage pool = liquidityPools[perpetual.poolId];
        _transferFromUserToVault(pool.marginTokenAddress, msgSender(), _fTokenAmount);
        perpetual.fAMMFundCashCC = perpetual.fAMMFundCashCC.add(_fTokenAmount);
        // fund cash will be added to the pool.fAMMFundCashCC if the pool is 
        // started or the perpetual is turned on, hence the following condition
        if (pool.isRunning && perpetual.state == PerpetualState.NORMAL) {
            pool.fAMMFundCashCC = pool.fAMMFundCashCC.add(_fTokenAmount);
        }
        emit UpdateAMMFundCash(_iPerpetualId, perpetual.fAMMFundCashCC, pool.fAMMFundCashCC);
    }

    /**
     * @notice  Removes liquidity from the liquidity pool.
     *          Liquidity providers redeems share token then gets collateral back.
     *          The amount of collateral retrieved differs from the amount when liquidity was added,
     *          due to profit and loss.
     *          Can only be called if there is no perpetual in emergency state.
     *          Pool must be running at least one perpetual in CLEARED or NORMAL state.
     *
     * @param   _poolId             Reference to liquidity pool
     * @param   _fShareAmount       The amount of share token to remove. 64.64 fixed point number.
     */
    function removeLiquidity(
        uint16 _poolId,
        int128 _fShareAmount
    ) external override nonReentrant updateFundingAndPrices(bytes32(0), _poolId) {
        _validateLiquidityData(_poolId, _fShareAmount);
        LiquidityPoolData storage pool = liquidityPools[_poolId];
        _isLPWithdrawValid(pool);
        address user = msgSender();
        IERC20 shareToken = IERC20(pool.shareTokenAddress);

        uint256 shareAmountU256 = _fShareAmount.toUDec18();
        if (shareAmountU256 > shareToken.balanceOf(user)) {
            // not enough share balance, shrink to available balance
            shareAmountU256 = shareToken.balanceOf(user);
            _fShareAmount = int256(shareAmountU256).fromDec18();
        }
        
        int128 fTokenAmountToReturn = _getTokenAmountToReturn(pool, _fShareAmount);
        _checkWithdrawalRestrictions(pool, user, fTokenAmountToReturn);

        IShareToken(pool.shareTokenAddress).burn(user, shareAmountU256);
        _transferFromVaultToUser(pool.marginTokenAddress, user, fTokenAmountToReturn);
        _decreasePoolCash(pool, fTokenAmountToReturn);
        _addCheckpoint(pool, user, fTokenAmountToReturn);

        emit LiquidityRemoved(_poolId, user, fTokenAmountToReturn.toUDec18(), shareAmountU256);
    }

    /**
     * @notice  Validates input data.
     *
     * @param   _poolId      Reference to liquidity pool
     * @param   _fAmount     The amount of token to add. 64.64 float
     */
    function _validateLiquidityData(uint16 _poolId, int128 _fAmount) internal view {
        require(_poolId <= iPoolCount, "pool index out of range");
        require(_fAmount > 0, "invalid amount");
    }

    /**
     * @notice Checks pool state.
     * @dev throws error if pool isn't running or doesn't have active perpetuals
     *
     * @param   _pool    Reference to liquidity pool
     */
    function _checkPoolState(LiquidityPoolData storage _pool) internal view {
        require(_pool.isRunning, "pool not running");
        uint256 length = perpetualIds[_pool.id].length;
        bool isActivePerpetuals;
        for (uint256 i = 0; i < length; i++) {
            bytes32 id = perpetualIds[_pool.id][i];
            PerpetualData storage perpetual = perpetuals[_pool.id][id];
            if (perpetual.state == PerpetualState.NORMAL) {
                isActivePerpetuals = true;
                break;
            }
        }
        require(isActivePerpetuals, "no active perpetual");
    }

    /**
     * @notice Checks whether LP can remove liquidity: no pool in emergency
     * and at least one pool cleared or normal
     * @dev throws error if pool isn't running or doesn't have active perpetuals
     *
     * @param   _pool    Reference to liquidity pool
     */
    function _isLPWithdrawValid(LiquidityPoolData storage _pool) internal view {
        require(_pool.isRunning, "pool not running");
        uint256 length = perpetualIds[_pool.id].length;
        bool isWithdrawValid;
        for (uint256 i = 0; i < length; i++) {
            bytes32 id = perpetualIds[_pool.id][i];
            PerpetualData storage perpetual = perpetuals[_pool.id][id];
            require(perpetual.state != PerpetualState.EMERGENCY, "no withdraw in emergency");
            if (perpetual.state == PerpetualState.NORMAL || perpetual.state == PerpetualState.CLEARED) {
                isWithdrawValid = true;
            }
        }
        require(isWithdrawValid, "no active perpetual");
    }



    /**
     * @notice  Calculates amount of share tokens to be minted.
     *
     * @param   _pool        Reference to liquidity pool
     * @param   _fAmount     The amount of token to add. 64.64 float
     */
    function _getShareAmountToMint(LiquidityPoolData storage _pool, int128 _fAmount) internal view returns (int128) {
        int128 fShareTotalSupply = int256(IERC20(_pool.shareTokenAddress).totalSupply()).fromDec18();
        int128 fShareToMint;
        if (fShareTotalSupply == 0) {
            fShareToMint = _fAmount;
        } else {
            fShareToMint = _fAmount.mul(fShareTotalSupply).div(_pool.fPnLparticipantsCashCC);
        }
        return fShareToMint;
    }

    /**
     * @notice  Calculates amount of tokens to be returned.
     *
     * @param   _pool        Reference to liquidity pool
     * @param   _fShareAmount     The amount of share token to burn. 64.64 float
     */
    function _getTokenAmountToReturn(LiquidityPoolData storage _pool, int128 _fShareAmount) internal view returns (int128) {
        int128 fShareTotalSupply = int256(IERC20(_pool.shareTokenAddress).totalSupply()).fromDec18();
        int128 fTokenAmountToReturn;
        if (_pool.fPnLparticipantsCashCC == 0) {
            fTokenAmountToReturn = 0;
        } else {
            fTokenAmountToReturn = _fShareAmount.mul(_pool.fPnLparticipantsCashCC).div(fShareTotalSupply);
        }
        return fTokenAmountToReturn;
    }

    /**
     * @notice  Adds checkpoint for the given user.
     *
     * @param   _pool            Reference to liquidity pool.
     * @param   _user            The address of user account.
     * @param   _fShareAmount    The amount of share token to remove. The amount always use 64.64 float.
     */
    function _addCheckpoint(
        LiquidityPoolData storage _pool,
        address _user,
        int128 _fShareAmount
    ) internal {
        checkpoints[_pool.id][_user].push(Checkpoint(uint64(block.timestamp), _fShareAmount));
    }

    /**
     * @notice Calculates amount of share tokens user has withdrawn during a withdrawal period.
     *
     * @param   _pool   Reference to liquidity pool.
     * @param   _user   The address of user account.
     */
    function _getAmountForPeriod(LiquidityPoolData storage _pool, address _user) internal view returns (int128) {
        int128 fAmount;
        uint256 length = checkpoints[_pool.id][_user].length;
        if (length == 0) {
            return fAmount;
        }
        for (uint256 i = length; i > 0; i--) {
            Checkpoint storage checkpoint = checkpoints[_pool.id][_user][i - 1];
            if (uint64(block.timestamp) - checkpoint.timestamp > _pool.iPnLparticipantWithdrawalPeriod) {
                break;
            }
            fAmount = fAmount.add(checkpoint.amount);
        }
        return fAmount;
    }

    /**
     * @notice  Adds withdrawal restrictions.
     * @dev throws error if iPnLparticipantWithdrawalPeriod was set and amountForPeriod + _fShareAmount > fPnLparticipantsCashCC * fPnLparticipantsWithdrawalPercentageLimit / 100
     *
     * @param   _pool            Reference to liquidity pool.
     * @param   _user            The address of user account.
     * @param   _fAmount         The amount of token to return. The amount always use 64.64 float.
     */
    function _checkWithdrawalRestrictions(
        LiquidityPoolData storage _pool,
        address _user,
        int128 _fAmount
    ) internal view {
        if (_pool.iPnLparticipantWithdrawalPeriod > 0) {
            int128 fAmountForPeriod = _getAmountForPeriod(_pool, _user);
            int128 fAmountLimit = _pool.fPnLparticipantsCashCC.mul(_pool.fPnLparticipantWithdrawalPercentageLimit);
            if (fAmountLimit < _pool.fPnLparticipantWithdrawalMinAmountLimit) {
                fAmountLimit = _pool.fPnLparticipantWithdrawalMinAmountLimit;
            }
            require(fAmountForPeriod.add(_fAmount) <= fAmountLimit, "withdraw limit exceeded");
        }
    }

    /**
     * To re-balance the AMM margin to the initial margin for all perpetuals in the given pool.
     *
     * @param   _pool Reference to liquidity pool
     */
    function _rebalance(LiquidityPoolData storage _pool) internal {
        uint256 length = _pool.iPerpetualCount;
        for (uint256 i = 0; i < length; i++) {
            bytes32 id = perpetualIds[_pool.id][i];
            PerpetualData storage perpetual = perpetuals[_pool.id][id];
            _rebalance(perpetual);
        }
    }

    function addAmmGovernanceAddress(address _gAddress) external override onlyOwner {
        require(_gAddress != address(0), "cannot add 0 address");
        ammGovernanceAddresses.add(_gAddress);
        emit AddAmmGovernanceAddress(_gAddress);
    }

    function removeAmmGovernanceAddress(address _gAddress) external override onlyOwner {
        ammGovernanceAddresses.remove(_gAddress);
        emit RemoveAmmGovernanceAddress(_gAddress);
    }

    function getTokenAmountToReturn(uint16 _poolId, int128 _fShareAmount) external view override returns (int128) {
        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        return _getTokenAmountToReturn(pool, _fShareAmount);
    }

    function getAmountForPeriod(uint16 _poolId, address _user) external view override returns (int128) {
        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        return _getAmountForPeriod(pool, _user);
    }

    modifier onlyAmmGovernance() {
        require(ammGovernanceAddresses.contains(msgSender()), "onlyGovernance address allowed");
        _;
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualTreasury");
        bytes4[] memory functionList = new bytes4[](7);
        functionList[0] = this.addLiquidity.selector;
        functionList[1] = this.removeLiquidity.selector;
        functionList[2] = this.addAmmGovernanceAddress.selector;
        functionList[3] = this.removeAmmGovernanceAddress.selector;
        functionList[4] = this.addAMMLiquidityToPerpetual.selector;
        functionList[5] = this.getTokenAmountToReturn.selector;
        functionList[6] = this.getAmountForPeriod.selector;
        return (functionList, moduleName);
    }
}
