// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../functions/PerpetualRebalanceFunctions.sol";
import "../interfaces/IPerpetualSettlement.sol";
import "../interfaces/IFunctionList.sol";
import "../../libraries/Utils.sol";

//test logs:
//import "../../libraries/ConverterDec18.sol";
//import "hardhat/console.sol";

/*
    This contract contains 2 main functions: settleNextTraderInPool and settle:
        If the perpetual pool moves into emergency mode, governance (or anyone)
        calls settleNextTraderInPool until every trader is processed. This will sum up
        the available margin of open positions.
        Once all traders are processed, settleNextTraderInPool calls _setRedemptionRate
        which determines how much from the PnL the trader receives back. Usually all of it,
        but in case there is not enough capital in the pool, the loss is shared.
        setRedemption rate sets the perpetual status to cleared.
    settle:
        Once settleNextTraderInPool is finished (all Emergency-perpetuals in CLEARED state),
        traders or governance can call 'settle' to pay the trader the amount owed.
*/

contract PerpetualSettlement is PerpetualRebalanceFunctions, IFunctionList, IPerpetualSettlement {
    using ABDKMath64x64 for int128;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
    //logs: using ConverterDec18 for int128; 

    /**
     * @notice  Settle next active accounts in the perpetuals that are in emergency state.
     *          If all active accounts are cleared for all emergency perpetuals in the pool,
     *          the clear process is done and the perpetual state
     *          changes to "CLEARED". Active means the trader's account has a position.
     *
     * @param   _id  The index of the liquidity pool.
     */
    function settleNextTraderInPool(uint16 _id) external override nonReentrant returns (bool) {
        LiquidityPoolData storage liquidityPool = liquidityPools[_id];
        uint256 length = liquidityPool.iPerpetualCount;
        int128 fTotalTraderMarginBalance; //sum of trader margin in each perpetual, in collateral currency
        int128 fTotalEmrgAMMMarginBalance; //in collateral currency
        int128 fTotalEmrgAMMFundCashCC; // AMM fund cash + margin cash of all AMMs that are in emergency mode
        bool isAllCleared = true;
        uint256 iEmergencyCount;
        for (uint256 i = 0; i < length; i++) {
            bytes32 idx = perpetualIds[liquidityPool.id][i];
            PerpetualData storage perpetual = perpetuals[liquidityPool.id][idx];
            if (perpetual.state == PerpetualState.EMERGENCY) {
                isAllCleared = isAllCleared && _clearNextTraderInPerpetual(perpetual);
                fTotalTraderMarginBalance = fTotalTraderMarginBalance.add(perpetual.fTotalMarginBalance);
                fTotalEmrgAMMMarginBalance = fTotalEmrgAMMMarginBalance.add(_getMarginViewLogic().getMarginBalance(perpetual.id, address(this)));
                MarginAccount storage account = marginAccounts[perpetual.id][address(this)];
                fTotalEmrgAMMFundCashCC = fTotalEmrgAMMFundCashCC.add(perpetual.fAMMFundCashCC).add(account.fCashCC);
                iEmergencyCount = iEmergencyCount + 1;
            }
        }
        /* Test log:
        if(isAllCleared) {
            console.log("contract all cleared");
            console.logInt(int256(iEmergencyCount));
        }
        -----------*/

        // if all trades cleared
        if (isAllCleared && iEmergencyCount > 0) {
            // Total capital of pools to be settled (=AMM margin and AMM pool cash) and the
            // liquidity pool PnL participant cash + default fund cash
            int128 fTotalCapitalCC = liquidityPool.fPnLparticipantsCashCC.add(liquidityPool.fDefaultFundCashCC);
            fTotalCapitalCC = fTotalCapitalCC.add(fTotalEmrgAMMFundCashCC);
            // ready to set redemption rate and mark perpetuals as cleared
            // the redemption rate ensures that the trader margin payments does not exceed fTotalCapitalCC
            _setRedemptionRate(liquidityPool, fTotalTraderMarginBalance, fTotalCapitalCC);

            int128 withdrawFromParticipationFund;
            int128 withdrawFromDF; // can be negative (adding)
            (withdrawFromParticipationFund, withdrawFromDF) = _prepareRedemption(
                liquidityPool,
                fTotalEmrgAMMMarginBalance,
                fTotalEmrgAMMFundCashCC
            );
            /* test log:
            console.log("liquidityPool.fDefaultFundCashCC=");
            console.logInt(liquidityPool.fDefaultFundCashCC.toDec18());
            console.log("fTotalTraderMarginBalance=");
            console.logInt(fTotalTraderMarginBalance.toDec18());
            console.log("fTotalEmrgAMMMarginBalance=");
            console.logInt(fTotalEmrgAMMMarginBalance.toDec18());
            console.log("fTotalEmrgAMMFundCashCC=");
            console.logInt(fTotalEmrgAMMFundCashCC.toDec18());
            console.log("withdraw from df=");
            console.logInt(withdrawFromDF.toDec18());
            console.log("df:=");
            console.logInt(liquidityPool.fDefaultFundCashCC.sub(withdrawFromDF).toDec18());
            //-----------*/

            liquidityPool.fDefaultFundCashCC = liquidityPool.fDefaultFundCashCC.sub(withdrawFromDF);
            liquidityPool.fPnLparticipantsCashCC = liquidityPool.fPnLparticipantsCashCC.sub(withdrawFromParticipationFund);
            liquidityPool.fAMMFundCashCC = liquidityPool.fAMMFundCashCC.sub(fTotalEmrgAMMFundCashCC);
        }
        return isAllCleared;
    }

    /**
     * @notice  Calculates the amount of funds left after each trader is settled.
     *          The remaining funds (perpetual AMM margin+AMM fund), if any, are credited to the default fund
     *          (belongs to the liquidity pool).
     *          If no funds left, they are drawn from the participation fund and default fund.
     *
     * @param   _liquidityPool                  Liquidity pool
     * @param   _fTotalEmrgAMMMarginBalance     Total AMM margin balance for all emergency-state pools
     * @param   _fTotalEmrgAMMFundCashCC        Total AMM fund cash for all emergency-state perpetuals
     */
    function _prepareRedemption(
        LiquidityPoolData memory _liquidityPool,
        int128 _fTotalEmrgAMMMarginBalance,
        int128 _fTotalEmrgAMMFundCashCC
    ) internal pure returns (int128, int128) {
        // correct the amm margin, amm cash, default fund, liquidity provider pool,
        // so that no funds are locked.
        // 1) AMM pool cash is already subtracted in _setRedemptionRate. So we add it back to the default fund
        //    together with the AMM margin, if anything left
        // 2) We correct the LiqPool default fund and participation fund, by subtracting amounts needed

        //int128 _fTotalTraderMarginBalanceToPay = _fTotalTraderMarginBalance.mul(_liquidityPool.fRedemptionRate);
        //int128 withdrawFromDF = _fTotalTraderMarginBalanceToPay.sub(_fTotalEmrgAMMMarginBalance).sub(_fTotalEmrgAMMFundCashCC);
        /*
            1) If redemption rate=1 this means there are enough funds to pay out all traders.
            The system owns the margin balance + amm funds => the rest belongs to the traders,
            so we send the margin balance + amm funds to the default fund (can be negative)
            2) If redemption rate<1 we just scale the margin balance accordingly as we do for each trader
        */
        int128 fMgnBalanceToKeep = _fTotalEmrgAMMMarginBalance.mul(_liquidityPool.fRedemptionRate);
        int128 withdrawFromDF = fMgnBalanceToKeep.neg().sub(_fTotalEmrgAMMFundCashCC);

        int128 withdrawFromParticipationFund;
        // if withdrawFromDF<0, we will credit that to the default fund,
        // otherwise tap default fund/Liquidity Provider Pool to withdraw from
        if (withdrawFromDF > 0) {
            // AMM margin and AMM pool is not sufficient to cover the trader gains
            // draw liq pool and then default fund
            withdrawFromParticipationFund = withdrawFromDF;
            withdrawFromDF = 0;
            if (withdrawFromParticipationFund > _liquidityPool.fPnLparticipantsCashCC) {
                withdrawFromDF = withdrawFromParticipationFund.sub(_liquidityPool.fPnLparticipantsCashCC);
                withdrawFromParticipationFund = _liquidityPool.fPnLparticipantsCashCC;
                require(withdrawFromDF >= 0, "error in redemption rate calculation");
            }
        }
        return (withdrawFromParticipationFund, withdrawFromDF);
    }

    /**
     * @notice  Settle next active accounts in a perpetual that is in emergency state.
     *          If all active accounts are cleared, the clear progress is done.
     *          Active means the trader's account is not empty in the perpetual.
     *          Empty means cash and position are zero
     *
     * @param   _perpetual  Reference to perpetual
     * @return  true if last trader was cleared
     */
    function _clearNextTraderInPerpetual(PerpetualData storage _perpetual) internal returns (bool) {
        require(_perpetual.state == PerpetualState.EMERGENCY, "perpetual must be in EMERGENCY state");
        return (activeAccounts[_perpetual.id].length() == 0 || _clearTrader(_perpetual, _getNextActiveAccount(_perpetual)));
    }

    /**
     * @notice  clear the given trader, that is, add their margin
     *          to total margin, remove trader from active accounts
     *
     * @param   _perpetual  Reference to perpetual
     * @return  true if last trader was cleared
     */
    function _clearTrader(PerpetualData storage _perpetual, address _traderAddr) internal returns (bool) {
        require(activeAccounts[_perpetual.id].length() > 0, "no account to clear");
        require(activeAccounts[_perpetual.id].contains(_traderAddr), "account cannot be cleared or already cleared");
        _countMargin(_perpetual, _traderAddr);
        activeAccounts[_perpetual.id].remove(_traderAddr);
        emit Clear(_perpetual.id, _traderAddr);
        return (activeAccounts[_perpetual.id].length() == 0);
    }

    /**
     * @dev     Sum up the total margin of open trades.
     *          -> counted margin = max(0, pure_trader_margin) * (pos!=0)
     *          The total margin is shared if not enough
     *          cash in system (last resort).
     *          Check the margin balance of trader's account, update total margin.
     *          If the margin of the trader's account is not positive, it will be counted as 0.
     *          Position = zero is not counted because the trader who has no position will get
     *          back the full cash.
     *
     * @param   _perpetual   The reference of perpetual storage.
     * @param   _traderAddr  The address of the trader to be counted.
     */
    function _countMargin(PerpetualData storage _perpetual, address _traderAddr) internal {
        require(_traderAddr != address(this), "AMM not part of margin count");
        int128 margin = _getMarginViewLogic().getMarginBalance(_perpetual.id, _traderAddr);
        if (margin <= 0) {
            // the margin is negative (trader was not liquidated on time)
            // this will not be paid back, hence we have to subtract this amount
            // from the AMM margin. We do this by adding the negative margin to the
            // AMM cash
            MarginAccount storage account = marginAccounts[_perpetual.id][address(this)];
            account.fCashCC = account.fCashCC.add(margin);
            return;
        }
        int128 pos = marginAccounts[_perpetual.id][_traderAddr].fPositionBC;
        if (pos != 0) {
            _perpetual.fTotalMarginBalance = _perpetual.fTotalMarginBalance.add(margin);
        }
        /* Test logs:
        console.log("trader margin=");
        console.logInt(margin.toDec18());
        */
    }

    /**
     * Get the address of the next active account in the perpetual.
     * AMM is not in active account list
     * @param   _perpetual   The reference of perpetual storage.
     * @return  The address of the next active account.
     */
    function _getNextActiveAccount(PerpetualData storage _perpetual) internal view returns (address) {
        require(activeAccounts[_perpetual.id].length() > 0, "no active account");
        return activeAccounts[_perpetual.id].at(0);
    }

    /**
     * Set redemption rate, mark perpetuals as cleared
     *
     * @param   _liquidityPool       The reference to liquidity pool.
     * @param   _fTotalMarginBalance total margin balance for all perpetuals in the pool that
     *                               need settlement
     * @param   _fTotalCapital       total capital (default fund, amm pools, participation fund, amm margin)
     */
    function _setRedemptionRate(
        LiquidityPoolData storage _liquidityPool,
        int128 _fTotalMarginBalance,
        int128 _fTotalCapital
    ) internal {
        if (_fTotalCapital < _fTotalMarginBalance) {
            // not enough funds, shrink payments proportionally
            // div rounds down
            _liquidityPool.fRedemptionRate = _fTotalCapital.div(_fTotalMarginBalance);
        } else {
            _liquidityPool.fRedemptionRate = ONE_64x64;
        }
        // set cleared state for all perpetuals that need to be settled
        uint256 length = _liquidityPool.iPerpetualCount;
        uint256 clearCount;
        for (uint256 i = 0; i < length; i++) {
            bytes32 idx = perpetualIds[_liquidityPool.id][i];
            PerpetualData storage perpetual = perpetuals[_liquidityPool.id][idx];
            if (perpetual.state == PerpetualState.EMERGENCY) {
                perpetual.state = PerpetualState.CLEARED;
                // remove liquidity pool cash and target default fund/AMM pool sizes from liquidity pool
                _liquidityPool.fTargetAMMFundSize = _liquidityPool.fTargetAMMFundSize.sub(perpetual.fTargetAMMFundSize);
                _liquidityPool.fTargetDFSize = _liquidityPool.fTargetDFSize.sub(perpetual.fTargetDFSize);
                // set AMM fund cash and AMM margin account to zero
                perpetual.fAMMFundCashCC = 0;
                _resetAccount(perpetual, address(this));
                emit SetClearedState(perpetual.id);
            }
            if (perpetual.state == PerpetualState.CLEARED) {
                clearCount++;
            }
        }
        if (clearCount == length) {
            _liquidityPool.isRunning = false;
        }
    }

    /**
     * @notice  If the state of the perpetual is "CLEARED", governance or the trader themselves can settle
     *          trader's account in the perpetual. Which means to calculate how much the collateral should be returned
     *          to the trader, return it to trader's wallet and clear the trader's cash and position in the perpetual.
     * @dev     Settle transfers tokens only. All internal accounting takes place before settle when state not CLEARED yet
     * @param   _perpetualID  The index of the perpetual in the liquidity pool
     * @param   _traderAddr   The address of the trader.
     */
    function settle(bytes32 _perpetualID, address _traderAddr) external override nonReentrant {
        // either governance can return funds to trader or trader himself
        require(msgSender() == _traderAddr || ammGovernanceAddresses.contains(msgSender()));
        require(_traderAddr != address(0), "invalid trader");

        PerpetualData storage perpetual = _getPerpetual(_perpetualID);
        require(perpetual.state == PerpetualState.CLEARED, "perpetual should be in CLEARED state");
        int128 marginToReturn = _getSettleableMargin(perpetual, _traderAddr);
        _resetAccount(perpetual, _traderAddr);
        if (marginToReturn > 0) {
            address marginTokenAddress = _getLiquidityPoolFromPerpetual(perpetual.id).marginTokenAddress;
            _transferFromVaultToUser(marginTokenAddress, _traderAddr, marginToReturn);
        }
        emit Settle(perpetual.id, _traderAddr, marginToReturn);
    }

    /**
     * Reset the trader's account in the perpetual to empty, which means all variables 0
     * @param _perpetual  The perpetual object
     * @param _traderAddr The address of the trader
     */
    function _resetAccount(PerpetualData storage _perpetual, address _traderAddr) internal {
        MarginAccount storage account = marginAccounts[_perpetual.id][_traderAddr];
        account.fCashCC = 0;
        account.fLockedInValueQC = 0;
        account.fPositionBC = 0;
    }

    /**
     * @dev Get the settleable margin of the trader in the perpetual in collateral currency
     *      This is the margin that the trader can withdraw when the state of the perpetual is "CLEARED".
     *      If the state of the perpetual is not "CLEARED", the settleable margin is always zero
     * @param _perpetual  The perpetual object
     * @param _traderAddr The address of the trader
     * @return The settleable margin of the trader in the perpetual
     */
    function _getSettleableMargin(PerpetualData storage _perpetual, address _traderAddr) internal view returns (int128) {
        int128 marginCC = _getMarginViewLogic().getMarginBalance(_perpetual.id, _traderAddr);
        if (marginCC < 0) {
            return 0;
        }
        if (_traderAddr == address(this)) {
            // the AMM itself is already accounted for
            return 0;
        }
        int128 fPos = marginAccounts[_perpetual.id][_traderAddr].fPositionBC;
        int128 fRate = ONE_64x64;
        // if the position is zero, the trader does not participate in loss-sharing
        // i.e., they receive the full margin balance (=cash).
        if (fPos != 0) {
            // rate is 0 if not set yet
            uint16 poolId = perpetualPoolIds[_perpetual.id];
            fRate = liquidityPools[poolId].fRedemptionRate;
        }
        marginCC = marginCC.mul(fRate);
        return marginCC;
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualSettlement");
        bytes4[] memory functionList = new bytes4[](2);
        functionList[0] = this.settleNextTraderInPool.selector;
        functionList[1] = this.settle.selector;
        return (functionList, moduleName);
    }
}
