// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../functions/PerpetualBaseFunctions.sol";
import "../interfaces/IPerpetualDepositManager.sol";
import "./../functions/PerpetualUpdateFunctions.sol";
import "../interfaces/IFunctionList.sol";
import "../../libraries/Utils.sol";

contract PerpetualDepositManager is PerpetualBaseFunctions, PerpetualUpdateFunctions, IFunctionList, IPerpetualDepositManager {
    using ABDKMath64x64 for int128;
    using ConverterDec18 for int128;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

    /**
     * Deposit margin to the margin account.
     * Can only be called when the perpetual's state is "NORMAL".
     * This method increases the trader's `cash` amount (margin account).
     *
     * @param   _iPerpetualId  The id of the perpetual in the liquidity pool.
     * @param   _fAmount     The amount of collateral in 'collateral currency' to deposit.
     */
    function deposit(bytes32 _iPerpetualId, int128 _fAmount) external override nonReentrant {
        address traderAddr = msgSender();
        _checkWhitelist(traderAddr);

        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _validateInputData(perpetual, _fAmount);

        address marginTokenAddr = liquidityPools[perpetual.poolId].marginTokenAddress;
        _transferFromUserToVault(marginTokenAddr, traderAddr, _fAmount);
        _deposit(perpetual, traderAddr, _fAmount);
    }

    /**
     * Deposit to the default fund.
     *
     * @param   _poolId      Reference to liquidity pool
     * @param   _fAmount     The amount of collateral in 'collateral currency' to deposit.
     */
    function depositToDefaultFund(uint16 _poolId, int128 _fAmount) external override onlyOwner {
        require(_poolId <= iPoolCount, "pool index out of range");
        require(_fAmount > 0, "invalid amount");

        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        _transferFromUserToVault(pool.marginTokenAddress, msgSender(), _fAmount);
        pool.fDefaultFundCashCC = pool.fDefaultFundCashCC.add(_fAmount);

        emit UpdateDefaultFundCash(_poolId, _fAmount, pool.fDefaultFundCashCC);
    }

    /**
     * Withdraw from the default fund. Only allowed if pool not running.
     *
     * @param   _poolId      Reference to liquidity pool
     * @param   _receiver    The receiver address
     * @param   _fAmount     The amount of collateral in 'collateral currency' to withdraw.
     */
    function withdrawFromDefaultFund(
        uint16 _poolId,
        address _receiver,
        int128 _fAmount
    ) external override onlyOwner {
        require(_poolId <= iPoolCount, "pool index out of range");
        require(_fAmount > 0, "invalid amount");

        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        require(!pool.isRunning, "withdrawal from running pool not allowed");
        require(pool.fDefaultFundCashCC >= _fAmount, "amount isn't available");

        if (_receiver == address(0)) {
            _receiver = msgSender();
        }
        pool.fDefaultFundCashCC = pool.fDefaultFundCashCC.sub(_fAmount);
        _transferFromVaultToUser(pool.marginTokenAddress, _receiver, _fAmount);
        emit UpdateDefaultFundCash(_poolId, _fAmount.neg(), pool.fDefaultFundCashCC);
    }

    function _deposit(
        PerpetualData storage _perpetual,
        address _traderAddr,
        int128 _fAmount
    ) internal updateFundingAndPrices(_perpetual.id, _perpetual.poolId) {
        _updateTraderMargin(_perpetual, _traderAddr, _fAmount);
        if (_traderAddr != address(this)) {
            activeAccounts[_perpetual.id].add(_traderAddr);
        }
        emit TokensDeposited(_perpetual.id, _traderAddr, _fAmount);
    }

    function _validateInputData(PerpetualData storage _perpetual, int128 _fAmount) internal view {
        require(_perpetual.state == PerpetualState.NORMAL, "perpetual should be in NORMAL state");
        require(_fAmount > 0, "invalid amount");
    }

    /**
     * Governance withdraws AMM gains from the default fund to treasury address
     *
     * @param   _poolId      Reference to liquidity pool
     * @param   _fAmount     Amount to be withdrawn. If earnings<amount, earnings are withdrawn.
     *
     */
    function transferEarningsToTreasury(uint16 _poolId, int128 _fAmount) external override onlyOwner {
        require(_poolId <= iPoolCount, "pool index out of range");

        
        PerpStorage.LiquidityPoolData storage liquidityPool = liquidityPools[_poolId];
        // force update of target default fund size
        _updateDefaultFundTargetSizeRandom(_poolId);

        // calculate amount beyond target sizes
        int128 fEarningsDF = liquidityPool.fDefaultFundCashCC.sub(liquidityPool.fTargetDFSize);
        int128 fEarningsAMM = liquidityPool.fAMMFundCashCC.sub(liquidityPool.fTargetAMMFundSize);
        if (fEarningsAMM < 0) {
            fEarningsDF = fEarningsDF.add(fEarningsAMM);
        }
        // withdraw min of fAmount and total earnings
        if (_fAmount < fEarningsDF) {
            fEarningsDF = _fAmount;
        }
        int128 newDFFundSize = liquidityPool.fDefaultFundCashCC;
        // withdraw amount beyond target size
        if (fEarningsDF > 0) {
            address mgnTokenAddr = liquidityPool.marginTokenAddress;
            address treasuryAddress = liquidityPool.treasuryAddress;
            // adjust default fund for earnings withdrawn
            newDFFundSize = newDFFundSize.sub(fEarningsDF);
            liquidityPool.fDefaultFundCashCC = newDFFundSize;
            // transfer tokens
            _transferFromVaultToUser(mgnTokenAddr, treasuryAddress, fEarningsDF);
        }
        
        emit TransferEarningsToTreasury(_poolId, fEarningsDF, newDFFundSize);
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualDepositManager");
        bytes4[] memory functionList = new bytes4[](4);
        functionList[0] = this.deposit.selector;
        functionList[1] = this.depositToDefaultFund.selector;
        functionList[2] = this.withdrawFromDefaultFund.selector;
        functionList[3] = this.transferEarningsToTreasury.selector;
        return (functionList, moduleName);
    }
}
