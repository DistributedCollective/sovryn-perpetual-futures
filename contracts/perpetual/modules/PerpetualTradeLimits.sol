// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../functions/PerpetualBaseFunctions.sol";
import "../interfaces/IFunctionList.sol";
import "../interfaces/IPerpetualTradeLimits.sol";
import "../../libraries/Utils.sol";

contract PerpetualTradeLimits is PerpetualBaseFunctions, IFunctionList, IPerpetualTradeLimits {
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

    function setWhitelistActive(bool _flag) external override onlyOwner {
        whitelistActive = _flag;
    }

    function isWhitelistActive() external view override returns (bool) {
        return whitelistActive;
    }

    function addToWhitelist(address[] memory _accounts) external override onlyOwner {
        for (uint256 i = 0; i < _accounts.length; i++) {
            whitelisted.add(_accounts[i]);
        }
    }

    function removeFromWhitelist(address[] memory _accounts) external override onlyOwner {
        for (uint256 i = 0; i < _accounts.length; i++) {
            whitelisted.remove(_accounts[i]);
        }
    }

    function getWhitelistedAddresses() external view override returns (address[] memory) {
        return whitelisted.enumerateAll();
    }

    function isWhitelisted(address _account) external view override returns (bool) {
        return whitelisted.contains(_account);
    }

    function setMaxPosition(bytes32 _perpetualId, int128 _value) external override onlyOwner {
        PerpetualData storage perpetual = _getPerpetual(_perpetualId);
        perpetual.fMaxPositionBC = _value;
    }

    function getMaxPosition(bytes32 _perpetualId) external view override returns (int128) {
        PerpetualData storage perpetual = _getPerpetual(_perpetualId);
        return perpetual.fMaxPositionBC;
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualTradeLimits");
        bytes4[] memory functionList = new bytes4[](8);
        functionList[0] = this.setWhitelistActive.selector;
        functionList[1] = this.isWhitelistActive.selector;
        functionList[2] = this.addToWhitelist.selector;
        functionList[3] = this.removeFromWhitelist.selector;
        functionList[4] = this.getWhitelistedAddresses.selector;
        functionList[5] = this.isWhitelisted.selector;
        functionList[6] = this.setMaxPosition.selector;
        functionList[7] = this.getMaxPosition.selector;
        return (functionList, moduleName);
    }
}
