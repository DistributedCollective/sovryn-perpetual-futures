// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../core/PerpStorage.sol";
import "../interfaces/IFunctionList.sol";
import "../interfaces/IPerpetualRelayRecipient.sol";
import "../../libraries/Utils.sol";

contract PerpetualRelayRecipient is PerpStorage, IFunctionList, IPerpetualRelayRecipient {
    function trustedForwarder() external view override returns (address) {
        return _trustedForwarder;
    }

    function setTrustedForwarder(address _forwarder) external override onlyOwner {
        _trustedForwarder = _forwarder;
    }

    function isTrustedForwarder(address forwarder) external view override returns (bool) {
        return forwarder == _trustedForwarder;
    }

    function versionRecipient() external pure override returns (string memory) {
        return "2.2.3+opengsn.bsc.irelayrecipient";
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualRelayRecipient");
        bytes4[] memory functionList = new bytes4[](4);
        functionList[0] = this.trustedForwarder.selector;
        functionList[1] = this.setTrustedForwarder.selector;
        functionList[2] = this.isTrustedForwarder.selector;
        functionList[3] = this.versionRecipient.selector;

        return (functionList, moduleName);
    }
}
