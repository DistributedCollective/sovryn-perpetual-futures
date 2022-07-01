// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../core/PerpStorage.sol";
import "../interfaces/ISOVLibraryEvents.sol";
import "../../libraries/ConverterDec18.sol";
import "../../libraries/EnumerableSetUpgradeable.sol";
import "../interfaces/IPerpetualRebalanceLogic.sol";

contract PerpetualBaseFunctions is PerpStorage, ISOVLibraryEvents {
    using ABDKMath64x64 for int128;
    using ConverterDec18 for int128;
    using ConverterDec18 for int256;
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

    function _getLiquidityPoolFromPerpetual(bytes32 _Id) internal view returns (LiquidityPoolData storage) {
        uint16 poolId = perpetualPoolIds[_Id];
        return liquidityPools[poolId];
    }

    function _getPoolIdFromPerpetual(bytes32 _Id) internal view returns (uint16) {
        return perpetualPoolIds[_Id];
    }

    /**
     * Get perpetual reference from its 'globally' unique id
     *
     * @param   _iPerpetualId Unique id (across liq pools) in the form of a hash
     *
     */
    function _getPerpetual(bytes32 _iPerpetualId) internal view returns (PerpetualData storage) {
        uint16 poolId = perpetualPoolIds[_iPerpetualId];
        require(poolId > 0, "perpetual not found");

        return perpetuals[poolId][_iPerpetualId];
    }

    /**
     * @dev Check if the account of the trader is empty in the perpetual, which means fCashCC = 0 and fPositionBC = 0
     * @param _perpetual The perpetual object
     * @param _traderAddr The address of the trader
     * @return True if the account of the trader is empty in the perpetual
     */
    function _isEmptyAccount(PerpetualData memory _perpetual, address _traderAddr) internal view returns (bool) {
        MarginAccount storage account = marginAccounts[_perpetual.id][_traderAddr];
        return account.fCashCC == 0 && account.fPositionBC == 0;
    }

    /**
     * Update the trader's cash in the margin account (trader can also be the AMM)
     * The 'cash' is denominated in collateral currency.
     * @param _perpetual   The perpetual struct
     * @param _traderAddr The address of the trader
     * @param _fDeltaCash signed 64.64-bit fixed point number.
     *                    Change of trader margin in collateral currency.
     */
    function _updateTraderMargin(
        PerpetualData storage _perpetual,
        address _traderAddr,
        int128 _fDeltaCash
    ) internal {
        if (_fDeltaCash == 0) {
            return;
        }
        MarginAccount storage account = marginAccounts[_perpetual.id][_traderAddr];
        account.fCashCC = account.fCashCC.add(_fDeltaCash);
    }

    /**
     * Transfer from the user to the vault account.
     * @param   _marginTknAddr Margin token address
     * @param   _userAddr    The address of the account
     * @param   _fAmount     The amount of erc20 token to transfer in ABDK64x64 format.
     */
    function _transferFromUserToVault(
        address _marginTknAddr,
        address _userAddr,
        int128 _fAmount
    ) internal {
        if (_fAmount <= 0) {
            return;
        }
        uint256 ufAmountD18 = _fAmount.toUDec18();
        address vault = address(this);
        IERC20Upgradeable marginToken = IERC20Upgradeable(_marginTknAddr);
        uint256 previousBalance = marginToken.balanceOf(vault);

        marginToken.safeTransferFrom(_userAddr, vault, ufAmountD18);
        uint256 postBalance = marginToken.balanceOf(vault);
        require(postBalance > previousBalance, "inwards transferred amount incorrect");
    }

    /**
     * Transfer from the vault to the user account.
     * @param   _marginTknAddr Margin token address
     * @param   _traderAddr    The address of the account
     * @param   _fAmount       The amount of erc20 token to transfer.
     */
    function _transferFromVaultToUser(
        address _marginTknAddr,
        address _traderAddr,
        int128 _fAmount
    ) internal {
        if (_fAmount <= 0) {
            return;
        }
        uint256 ufAmountD18 = _fAmount.toUDec18();
        address vault = address(this);
        IERC20Upgradeable marginToken = IERC20Upgradeable(_marginTknAddr);
        uint256 previousBalance = marginToken.balanceOf(vault);

        marginToken.safeTransfer(_traderAddr, ufAmountD18);
        uint256 postBalance = marginToken.balanceOf(vault);
        require(previousBalance > postBalance, "outwards transferred amount incorrect");
    }

    function _getAveragePrice(PerpetualData memory _perpetual, address _traderAddr) internal view returns (int128) {
        int128 pos = marginAccounts[_perpetual.id][_traderAddr].fPositionBC;
        int128 fLockedInValueQC = marginAccounts[_perpetual.id][_traderAddr].fLockedInValueQC;
        return fLockedInValueQC == int128(0) ? int128(0) : pos.abs().div(fLockedInValueQC);
    }

    /**
     * Get the available cash of the trader in the perpetual in *collateral* currency
     * This is pure margin-cash net of funding, locked-in value not considered.
     * Available cash = cash - position * unit accumulative funding
     * @param _perpetual The perpetual object
     * @param traderAddr The address of the trader
     * @return availableCash The available cash of the trader in the perpetual
     */
    function _getAvailableCash(PerpetualData memory _perpetual, address traderAddr) internal view returns (int128) {
        MarginAccount storage account = marginAccounts[_perpetual.id][traderAddr];
        int128 fCashCC = account.fCashCC;
        // unit-funding is in collateral currency
        int128 fFundingUnitPayment = _perpetual.fUnitAccumulatedFunding.sub(account.fUnitAccumulatedFundingStart);
        return fCashCC.sub(account.fPositionBC.mul(fFundingUnitPayment));
    }

    /**
     * Get the multiplier that converts <base> into
     * the value of <collateralcurrency>
     * Hence 1 if collateral currency = base currency
     * If the state of the perpetual is not "NORMAL",
     * use the settlement price
     * @param   _perpetual           The reference of perpetual storage.
     * @param   _isMarkPriceRequest  If true, get the conversion for the mark-price. If false for spot.
     * @return  The index price of the collateral for the given perpetual.
     */
    function _getBaseToCollateralConversionMultiplier(PerpetualData memory _perpetual, bool _isMarkPriceRequest) internal view returns (int128) {
        AMMPerpLogic.CollateralCurrency ccy = _perpetual.eCollateralCurrency;
        /*
        Quote: Pos * markprice --> quote currency
        Base: Pos * markprice / indexprice; E.g., 0.1 BTC * 36500 / 36000
        Quanto: Pos * markprice / index3price. E.g., 0.1 BTC * 36500 / 2000 = 1.83 ETH
        where markprice is replaced by indexprice if _isMarkPriceRequest=FALSE
        */
        int128 fPx2;
        int128 fPxIndex2;
        if (_perpetual.state != PerpetualState.NORMAL) {
            fPxIndex2 = _perpetual.fSettlementS2PriceData;
            require(fPxIndex2 > 0, "settlement price S2 not set");
        } else {
            fPxIndex2 = oraclePriceData[_perpetual.oracleS2Addr].fPrice;
        }

        if (_isMarkPriceRequest) {
            fPx2 = _getPerpetualMarkPrice(_perpetual);
        } else {
            fPx2 = fPxIndex2;
        }

        if (ccy == AMMPerpLogic.CollateralCurrency.BASE) {
            // equals ONE if _isMarkPriceRequest=FALSE
            return fPx2.div(fPxIndex2);
        }
        if (ccy == AMMPerpLogic.CollateralCurrency.QUANTO) {
            // Example: 0.5 contracts of ETHUSD paid in BTC
            //  the rate is ETHUSD * 1/BTCUSD
            //  BTCUSD = 31000 => 0.5/31000 = 0.00003225806452 BTC
            return
                _perpetual.state == PerpetualState.NORMAL
                    ? fPx2.div(oraclePriceData[_perpetual.oracleS3Addr].fPrice)
                    : fPx2.div(_perpetual.fSettlementS3PriceData);
        } else {
            // Example: 0.5 contracts of ETHUSD paid in USD
            //  the rate is ETHUSD
            //  ETHUSD = 2000 => 0.5 * 2000 = 1000
            require(ccy == AMMPerpLogic.CollateralCurrency.QUOTE, "unknown state");
            return fPx2;
        }
    }

    /**
     * Get the mark price of the perpetual. If the state of the perpetual is not "NORMAL",
     * return the settlement price
     * @param   _perpetual The perpetual in the liquidity pool
     * @return  markPrice  The mark price of current perpetual.
     */
    function _getPerpetualMarkPrice(PerpetualData memory _perpetual) internal view returns (int128) {
        int128 markPrice = _perpetual.state == PerpetualState.NORMAL
            ? (oraclePriceData[_perpetual.oracleS2Addr].fPrice).mul(ONE_64x64.add(_perpetual.currentMarkPremiumRate.fPrice))
            : (_perpetual.fSettlementS2PriceData).mul(ONE_64x64.add(_perpetual.fSettlementMarkPremiumRate));
        return markPrice;
    }

    /**
     * Get the multiplier that converts <collateralcurrency> into
     * the value of <quotecurrency>
     * Hence 1 if collateral currency = quote currency
     * If the state of the perpetual is not "NORMAL",
     * use the settlement price
     * @param   _perpetual           The reference of perpetual storage.
     * @return  The index price of the collateral for the given perpetual.
     */
    function _getCollateralToQuoteConversionMultiplier(PerpetualData memory _perpetual) internal view returns (int128) {
        AMMPerpLogic.CollateralCurrency ccy = _perpetual.eCollateralCurrency;
        /*
            Quote: 1
            Base: S2, e.g. we hold 1 BTC -> 36000 USD
            Quanto: S3, e.g., we hold 1 ETH -> 2000 USD
        */
        if (ccy == AMMPerpLogic.CollateralCurrency.BASE) {
            return _perpetual.state == PerpetualState.NORMAL ? oraclePriceData[_perpetual.oracleS2Addr].fPrice : _perpetual.fSettlementS2PriceData;
        }
        if (ccy == AMMPerpLogic.CollateralCurrency.QUANTO) {
            return _perpetual.state == PerpetualState.NORMAL ? oraclePriceData[_perpetual.oracleS3Addr].fPrice : _perpetual.fSettlementS3PriceData;
        } else {
            return ONE_64x64;
        }
    }

    function _updateMarkPrice(PerpetualData storage _perpetual, uint64 _iCurrentTimeSec) internal {
        _updateInsurancePremium(_perpetual, _iCurrentTimeSec);
        _updatePremiumMarkPrice(_perpetual, _iCurrentTimeSec);
    }

    /**
     * Update the EMA of insurance premium used for the mark price
     * @param   _perpetual   The reference of perpetual storage.
     * @param   _iCurrentTimeSec   The current timestamp (block.timestamp)
     */
    function _updatePremiumMarkPrice(PerpetualData storage _perpetual, uint64 _iCurrentTimeSec) internal {
        if (_perpetual.currentMarkPremiumRate.time != _iCurrentTimeSec) {
            // update mark-price if we are in a new block
            // now set the mark price to the last block EMA
            _perpetual.currentMarkPremiumRate.time = _iCurrentTimeSec;
            // assign last EMA of previous block
            _perpetual.currentMarkPremiumRate.fPrice = _perpetual.premiumRatesEMA;
            emit UpdateMarkPrice(_perpetual.id, _perpetual.currentMarkPremiumRate.fPrice, oraclePriceData[_perpetual.oracleS2Addr].fPrice);
        }

        _perpetual.premiumRatesEMA = _getAMMPerpLogic().ema(_perpetual.premiumRatesEMA, _perpetual.fCurrentPremiumRate, _perpetual.fMarkPriceEMALambda);
    }

    /**
     * Update the mid-price for the insurance premium. This is used for EMA of perpetual prices
     * (mark-price used in funding payments and rebalance)
     * @param   _perpetual   The reference of perpetual storage.
     * @param   _iCurrentTimeSec   The current timestamp (block.timestamp)
     */
    function _updateInsurancePremium(PerpetualData storage _perpetual, uint64 _iCurrentTimeSec) internal {
        // prepare data
        AMMPerpLogic.AMMVariables memory ammState;
        AMMPerpLogic.MarketVariables memory marketState;

        (ammState, marketState) = _prepareAMMAndMarketData(_perpetual);

        // mid price has no minimal spread
        // mid-price parameter obtained using amount k=0
        int128 px_premium = _getAMMPerpLogic().calculatePerpetualPrice(ammState, marketState, 0, 0);
        px_premium = px_premium.sub(marketState.fIndexPriceS2).div(marketState.fIndexPriceS2);
        _perpetual.fCurrentPremiumRate = px_premium;
    }

    /**
     * Prepare data for pricing functions (AMMPerpModule)
     * @param   _perpetual    The reference of perpetual storage.
     */
    function _prepareAMMAndMarketData(PerpetualData memory _perpetual)
        internal
        view
        returns (AMMPerpLogic.AMMVariables memory, AMMPerpLogic.MarketVariables memory)
    {
        // prepare data
        AMMPerpLogic.AMMVariables memory ammState;
        AMMPerpLogic.MarketVariables memory marketState;

        marketState.fIndexPriceS2 = oraclePriceData[_perpetual.oracleS2Addr].fPrice;
        marketState.fSigma2 = _perpetual.fSigma2;

        require(marketState.fIndexPriceS2 > 0, "Index price S2 must be positive");

        MarginAccount memory AMMMarginAcc = marginAccounts[_perpetual.id][address(this)];
        // get current locked-in value
        ammState.fLockedValue1 = AMMMarginAcc.fLockedInValueQC.neg();

        // get current position of all traders (= - AMM position)
        ammState.fAMM_K2 = AMMMarginAcc.fPositionBC.neg();

        AMMPerpLogic.CollateralCurrency ccy = _perpetual.eCollateralCurrency;
        if (ccy == AMMPerpLogic.CollateralCurrency.BASE) {
            ammState.fPoolM2 = _perpetual.fAMMFundCashCC;
        } else if (ccy == AMMPerpLogic.CollateralCurrency.QUANTO) {
            ammState.fPoolM3 = _perpetual.fAMMFundCashCC;
            // additional parameters for quanto case
            marketState.fIndexPriceS3 = oraclePriceData[_perpetual.oracleS3Addr].fPrice;
            marketState.fSigma3 = _perpetual.fSigma3;
            marketState.fRho23 = _perpetual.fRho23;
            require(marketState.fIndexPriceS3 > 0, "Index price S3 must be positive");
        } else {
            assert(ccy == AMMPerpLogic.CollateralCurrency.QUOTE);
            ammState.fPoolM1 = _perpetual.fAMMFundCashCC;
        }
        return (ammState, marketState);
    }

    function _getAMMPerpLogic() internal view returns (IAMMPerpLogic) {
        return IAMMPerpLogic(address(ammPerpLogic));
    }

    /**
     * If whitelist not active, return true.
     * Otherwise, check whether the address is whitelisted and check whether
     * there is a maximal amount of trader funds.
     * Reverts if checks not passed.
     * @param   _account        trader address.
     */
    function _checkWhitelist(address _account) internal view {
        if (whitelistActive) {
            require(whitelisted.contains(_account), "account should be whitelisted");
        }
    }

    /**
     * Check whether the there is a maximal amount of trader funds.
     * Reverts if checks not passed.
     * @param   _perpetualId    ID of perpetual.
     * @param   isClose         True if the trader is closing their position.
     */
    function _checkMaxTotalTraderFundsExceeded(bytes32 _perpetualId, bool isClose) internal view {
        LiquidityPoolData storage liqPool = _getLiquidityPoolFromPerpetual(_perpetualId);
        require(
            isClose || liqPool.fMaxTotalTraderFunds < 0 || _getTotalTraderFunds(_perpetualId) < liqPool.fMaxTotalTraderFunds,
            "maximal trader funds exceeded"
        );
    }

    function _getRebalanceLogic() internal view returns (IPerpetualRebalanceLogic) {
        return IPerpetualRebalanceLogic(address(this));
    }

    function _getTotalTraderFunds(bytes32 _perpetualId) internal view returns (int128) {
        // PnL, AMM and DF pools
        LiquidityPoolData storage liqPool = _getLiquidityPoolFromPerpetual(_perpetualId);
        int128 fAMMFunds = liqPool.fPnLparticipantsCashCC.add(liqPool.fAMMFundCashCC).add(liqPool.fDefaultFundCashCC);
        // Add AMM margin
        uint256 length = liqPool.iPerpetualCount;
        for (uint256 i = 0; i < length; i++) {
            bytes32 idx = perpetualIds[liqPool.id][i];
            PerpetualData storage perpetual = perpetuals[liqPool.id][idx];
            if (perpetual.state != PerpetualState.NORMAL) {
                continue;
            }
            fAMMFunds = fAMMFunds.add(marginAccounts[idx][address(this)].fCashCC);
        }
        // Total funds in contract
        address vault = address(this);
        IERC20Upgradeable marginToken = IERC20Upgradeable(liqPool.marginTokenAddress);
        int128 fTotalFunds = int256(marginToken.balanceOf(vault)).fromDec18();
        // Trader funds = Total funds - AMM pools - AMM trading margin
        int128 fTotalTraderFunds = fTotalFunds.sub(fAMMFunds);
        return fTotalTraderFunds;
    }
}
