// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/modules/PerpetualTreasury.sol";
import "./IMockPerpetualTreasury.sol";
import "../libraries/Utils.sol";

contract MockPerpetualTreasury is PerpetualTreasury, IMockPerpetualTreasury {
    function mintShareTokens(
        uint16 _poolId,
        address _account,
        uint256 _amount
    ) external override {
        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        IShareToken(pool.shareTokenAddress).mint(_account, _amount);
    }

    function getShareAmountToMint(uint16 _poolId, int128 _fAmount) external view override returns (int128) {
        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        return _getShareAmountToMint(pool, _fAmount);
    }

    function checkWithdrawalRestrictions(
        uint16 _poolId,
        address _user,
        int128 _fAmount
    ) external override {
        PerpStorage.LiquidityPoolData storage pool = liquidityPools[_poolId];
        _checkWithdrawalRestrictions(pool, _user, _fAmount);
    }

    function getFunctionList() external pure override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("MockPerpetualTreasury");
        bytes4[] memory functionList = new bytes4[](11);
        functionList[0] = this.addLiquidity.selector;
        functionList[1] = this.removeLiquidity.selector;
        functionList[2] = this.getShareAmountToMint.selector;
        functionList[3] = this.getTokenAmountToReturn.selector;
        functionList[4] = this.getAmountForPeriod.selector;
        functionList[5] = this.checkWithdrawalRestrictions.selector;
        functionList[6] = this.mintShareTokens.selector;
        functionList[7] = this.addAmmGovernanceAddress.selector;
        functionList[8] = this.removeAmmGovernanceAddress.selector;
        functionList[9] = this.addAMMLiquidityToPerpetual.selector;
        functionList[10] = this.addAmmGovernanceAddress.selector;
        return (functionList, moduleName);
    }
}
