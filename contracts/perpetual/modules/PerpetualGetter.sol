// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../functions/PerpetualUpdateFunctions.sol";
import "../interfaces/IPerpetualGetter.sol";
import "../interfaces/IFunctionList.sol";
import "../../libraries/EnumerableSetUpgradeable.sol";
import "../../libraries/Utils.sol";

contract PerpetualGetter is PerpetualUpdateFunctions, IFunctionList, IPerpetualGetter {
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
    using ABDKMath64x64 for int128;

    function getPoolCount() external view override returns (uint16) {
        return iPoolCount;
    }

    function getPerpetualCountInPool(uint16 _poolId) external view override returns (uint16) {
        return uint16(perpetualIds[_poolId].length);
    }

    function getPerpetualId(uint16 _poolId, uint16 _perpetualIndex) external view override returns (bytes32) {
        return perpetualIds[_poolId][_perpetualIndex];
    }

    function getPoolIdByPerpetualId(bytes32 _perpetualId) external view override returns (uint16) {
        return perpetualPoolIds[_perpetualId];
    }

    function getLiquidityPool(uint16 _id) external view override returns (LiquidityPoolData memory) {
        return liquidityPools[_id];
    }

    function getPerpetual(bytes32 _perpetualId) external view override returns (PerpetualData memory) {
        return _getPerpetual(_perpetualId);
    }

    function getMarginAccount(bytes32 _perpetualId, address _account) external view override returns (PerpStorage.MarginAccount memory) {
        return marginAccounts[_perpetualId][_account];
    }

    function isActiveAccount(bytes32 _perpetualId, address _account) external view override returns (bool) {
        return activeAccounts[_perpetualId].contains(_account);
    }

    function getCheckpoints(uint16 _poolId, address _account) external view override returns (Checkpoint[] memory) {
        return checkpoints[_poolId][_account];
    }

    function getAMMPerpLogic() external view override returns (address) {
        return ammPerpLogic;
    }

    function getGovernanceAddresses() external view override returns (address[] memory) {
        return ammGovernanceAddresses.enumerateAll();
    }

    function isGovernanceAddress(address _address) external view override returns (bool) {
        return ammGovernanceAddresses.contains(_address);
    }

    function getShareTokenFactory() external view override returns (IShareTokenFactory) {
        return shareTokenFactory;
    }

    function getPerpMarginAccount(bytes32 _perpId, address _trader) external view override returns (MarginAccount memory) {
        return marginAccounts[_perpId][_trader];
    }

    function isTraderMaintenanceMarginSafe(bytes32 _iPerpetualId, address _traderAddr) external view override returns (bool) {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        return _getMarginViewLogic().isMaintenanceMarginSafe(perpetual.id, _traderAddr);
    }

    function getActivePerpAccounts(bytes32 _perpId) external view override returns (address[] memory perpActiveAccounts) {
        perpActiveAccounts = activeAccounts[_perpId].enumerateAll();
    }

    function countActivePerpAccounts(bytes32 _perpId) external view override returns (uint256 count) {
        count = activeAccounts[_perpId].length();
    }

    function getActivePerpAccountsByChunks(
        bytes32 _perpId,
        uint256 _from,
        uint256 _to
    ) external view override returns (address[] memory chunkPerpActiveAccounts) {
        chunkPerpActiveAccounts = activeAccounts[_perpId].enumerate(_from, _to);
    }

    function getAMMState(bytes32 _iPerpetualId) external view override returns (int128[13] memory) {
        int128[13] memory ammState;
        PerpetualData memory perpetual = _getPerpetual(_iPerpetualId);
        MarginAccount memory ma = marginAccounts[_iPerpetualId][address(this)];
        ammState[0] = ma.fLockedInValueQC.neg(); //L1
        ammState[1] = ma.fPositionBC.neg(); //K2
        uint256 idx = 2 + uint256(perpetual.eCollateralCurrency); //Quote,Base, or Quanto?
        ammState[idx] = perpetual.fAMMFundCashCC; // M1, M2, or M3
        ammState[5] = perpetual.fCurrentTraderExposureEMA;
        ammState[6] = oraclePriceData[perpetual.oracleS2Addr].fPrice;
        ammState[7] = oraclePriceData[perpetual.oracleS3Addr].fPrice;
        ammState[8] = perpetual.currentMarkPremiumRate.fPrice;
        ammState[9] = perpetual.fCurrentPremiumRate;

        (int128 price2, ) = ISpotOracle(perpetual.oracleS2Addr).getSpotPrice();
        ammState[10] = price2;
        if (perpetual.oracleS3Addr != address(0)) {
            (int128 price3, ) = ISpotOracle(perpetual.oracleS3Addr).getSpotPrice();
            ammState[11] = price3;
        }
        // default fund to target ratio
        LiquidityPoolData memory lp = _getLiquidityPoolFromPerpetual(_iPerpetualId);
        if (lp.fTargetDFSize > 0) {
            ammState[12] = lp.fDefaultFundCashCC.div(lp.fTargetDFSize);
        }

        return ammState;
    }

    function getTraderState(bytes32 _iPerpetualId, address _traderAddr) external view override returns (int128[7] memory) {
        /*
            marginBalance : number; // current margin balance
            availableMargin : number; // amount over initial margin
            availableCashCC : number; // cash minus unpaid funding
            marginAccountCashCC : number;
            marginAccountPositionBC : number;
            marginAccountLockedInValueQC : number;
        */

        int128[7] memory traderState;
        PerpetualData memory perpetual = _getPerpetual(_iPerpetualId);

        traderState[0] = _getMarginViewLogic().getMarginBalance(perpetual.id, _traderAddr);
        traderState[1] = _getMarginViewLogic().getAvailableMargin(perpetual.id, _traderAddr, true);
        traderState[2] = _getAvailableCash(perpetual, _traderAddr);

        MarginAccount memory ma = marginAccounts[_iPerpetualId][_traderAddr];
        traderState[3] = ma.fCashCC;
        traderState[4] = ma.fPositionBC;
        traderState[5] = ma.fLockedInValueQC;
        traderState[6] = ma.fUnitAccumulatedFundingStart;

        return traderState;
    }

    function getOraclePriceData(address _oracle) external view override returns (PerpStorage.OraclePriceData memory) {
        return oraclePriceData[_oracle];
    }

    function getUpdatedTargetAMMFundSize(bytes32 _iPerpetualId, bool _isBaseline) external view override returns (int128) {
        PerpetualData memory perpetual = _getPerpetual(_iPerpetualId);
        return _getUpdatedTargetAMMFundSize(perpetual, perpetual.eCollateralCurrency, _isBaseline);
    }

    /**
     * Check whether user is whitelisted.
     *
     * @param   _account       address of user
     * @return true if user is whitelisted or whitelisting inactive
     */
    function isAddrWhitelisted(address _account) external view override returns (bool) {
        return !whitelistActive || whitelisted.contains(_account);
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualGetter");
        bytes4[] memory functionList = new bytes4[](23);
        functionList[0] = this.getPoolCount.selector;
        functionList[1] = this.getPerpetualId.selector;
        functionList[2] = this.getPoolIdByPerpetualId.selector;
        functionList[3] = this.getLiquidityPool.selector;
        functionList[4] = this.getPerpetual.selector;
        functionList[5] = this.getMarginAccount.selector;
        functionList[6] = this.isActiveAccount.selector;
        functionList[7] = this.getCheckpoints.selector;
        functionList[8] = this.getAMMPerpLogic.selector;
        functionList[9] = this.getGovernanceAddresses.selector;
        functionList[10] = this.isGovernanceAddress.selector;
        functionList[11] = this.getShareTokenFactory.selector;
        functionList[12] = this.getPerpMarginAccount.selector;
        functionList[13] = this.getActivePerpAccounts.selector;
        functionList[14] = this.getActivePerpAccountsByChunks.selector;
        functionList[15] = this.isTraderMaintenanceMarginSafe.selector;
        functionList[16] = this.countActivePerpAccounts.selector;
        functionList[17] = this.getAMMState.selector;
        functionList[18] = this.getTraderState.selector;
        functionList[19] = this.getPerpetualCountInPool.selector;
        functionList[20] = this.getOraclePriceData.selector;
        functionList[21] = this.getUpdatedTargetAMMFundSize.selector;
        functionList[22] = this.isAddrWhitelisted.selector;

        return (functionList, moduleName);
    }
}
