// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/proxy/Proxy.sol";
import "./PerpStorage.sol";
import "../interfaces/ISOVLibraryEvents.sol";
import "../interfaces/IFunctionList.sol";
import "../../libraries/EnumerableBytes4Set.sol";
import "../../libraries/Utils.sol";

contract PerpetualManagerProxy is PerpStorage, Proxy, ISOVLibraryEvents {
    using EnumerableBytes4Set for EnumerableBytes4Set.Bytes4Set;

    bytes32 private constant KEY_IMPLEMENTATION = keccak256("key.implementation");
    bytes32 private constant KEY_OWNER = keccak256("key.proxy.owner");

    event ProxyOwnershipTransferred(address indexed _oldOwner, address indexed _newOwner);
    event ImplementationChanged(bytes4 _sig, address indexed _oldImplementation, address indexed _newImplementation);

    /**
     * @notice Set sender as an owner.
     */
    constructor() {
        _setProxyOwner(msgSender());
    }

    /**
     * @notice Throw error if called not by an owner.
     */
    modifier onlyProxyOwner() {
        require(msgSender() == getProxyOwner(), "Proxy:access denied");
        _;
    }

    function _implementation() internal view override returns (address) {
        address implementation = _getImplementation(msg.sig);
        require(implementation != address(0), "Proxy:Implementation not found");
        return implementation;
    }

    function getImplementation(bytes4 _sig) external view returns (address) {
        return _getImplementation(_sig);
    }

    function _getImplementation(bytes4 _sig) internal view returns (address) {
        bytes32 key = keccak256(abi.encode(_sig, KEY_IMPLEMENTATION));
        address implementation;
        assembly {
            implementation := sload(key)
        }
        return implementation;
    }

    /**
     * @dev Delegates the current call to the address returned by `_implementation()`.
     * Override of OpenZeppelin function to ensure no tokens are sent to the contract.
     * This function does not return to its internal call site, it will return directly to the external caller.
     */
    function _fallback() internal override {
        require(msg.value==0, "contract not payable");
        _beforeFallback();
        _delegate(_implementation());
    }

    /// @dev to delete module deploy a dummy module with the same name in getFunctionList() as being deleted
    /// it will remove all previous implementation functions
    function setImplementation(address _impl) external onlyProxyOwner {
        _setImplementation(_impl, false);
    }

    ///@dev allows replacement of functions from other modules. Use only if you realize consequences.
    function setImplementationCrossModules(address _impl) external onlyProxyOwner {
        _setImplementation(_impl, true);
    }

    ///@param _impl module address
    ///@param replaceOtherModulesFuncs allow to replace functions of other modules, use with caution
    function _setImplementation(address _impl, bool replaceOtherModulesFuncs) internal {
        require(_impl != address(0), "Proxy::setImplementation: invalid address");

        (bytes4[] memory functions, bytes32 moduleName) = IFunctionList(_impl).getFunctionList();

        require(moduleName != bytes32(0), "Module name cannot be empty");

        EnumerableBytes4Set.Bytes4Set storage moduleActiveFunctionsSet = moduleActiveFuncSignatureList[moduleName];
        bool moduleIsBeingUpdated = moduleActiveFunctionsSet.length() > 0;
        uint256 length = functions.length;
        for (uint256 i = 0; i < length; i++) {
            bytes4 funcSig = functions[i];
            if (!moduleActiveFunctionsSet.contains(functions[i])) {
                // if the function registered with another module
                address anotherModuleImplAddress = _getImplementation(funcSig);
                if (anotherModuleImplAddress != address(0)) {
                    require(replaceOtherModulesFuncs, "Replacement of other modules functions not alowed");
                    moduleActiveFuncSignatureList[moduleAddressToModuleName[anotherModuleImplAddress]].removeBytes4(funcSig);
                }
                moduleActiveFunctionsSet.addBytes4(functions[i]);
            }
            _setImplementation(functions[i], _impl);
        }

        /// remove functions of the previous module version
        if (moduleIsBeingUpdated) {
            bytes4[] memory moduleActiveFuncsArray = moduleActiveFunctionsSet.enumerate(0, moduleActiveFunctionsSet.length());
            length = moduleActiveFuncsArray.length;
            for (uint256 i; i < length; i++) {
                bytes4 funcSig = moduleActiveFuncsArray[i];
                if (_getImplementation(funcSig) != _impl) {
                    _setImplementation(funcSig, address(0));
                    moduleActiveFunctionsSet.removeBytes4(funcSig);
                }
            }
        }

        moduleNameToAddress[moduleName] = _impl;
        moduleAddressToModuleName[_impl] = moduleName;
    }

    function getModuleImplementationAddress(string memory _moduleName) external view returns (address) {
        return moduleNameToAddress[Utils.stringToBytes32(_moduleName)];
    }

    function _setImplementation(bytes4 _sig, address _impl) internal {
        _checkClashing(_sig);
        emit ImplementationChanged(_sig, _getImplementation(_sig), _impl);

        bytes32 key = keccak256(abi.encode(_sig, KEY_IMPLEMENTATION));
        assembly {
            sstore(key, _impl)
        }
    }

    function _removeImplementation(bytes4 _sig) internal {
        address zeroAddress = address(0);
        emit ImplementationChanged(_sig, _getImplementation(_sig), zeroAddress);

        bytes32 key = keccak256(abi.encode(_sig, KEY_IMPLEMENTATION));
        assembly {
            sstore(key, zeroAddress)
        }
    }

    /**
     * @notice Set address of the owner.
     * @param _owner Address of the owner.
     * */
    function setProxyOwner(address _owner) external onlyProxyOwner {
        _setProxyOwner(_owner);
    }

    function _setProxyOwner(address _owner) internal {
        require(_owner != address(0), "Proxy::setProxyOwner: invalid address");
        emit ProxyOwnershipTransferred(getProxyOwner(), _owner);

        bytes32 key = KEY_OWNER;
        assembly {
            sstore(key, _owner)
        }
    }

    /**
     * @notice Return address of the owner.
     * @return _owner Address of the owner.
     */
    function getProxyOwner() public view returns (address _owner) {
        bytes32 key = KEY_OWNER;
        assembly {
            _owner := sload(key)
        }
    }

    function _checkClashing(bytes4 _sig) internal pure {
        bytes4[] memory functionList = _getFunctionList();
        uint256 length = functionList.length;
        for (uint256 i = 0; i < length; i++) {
            require(_sig != functionList[i], "Proxy has function with the same id");
        }
    }

    function _getFunctionList() internal pure returns (bytes4[] memory) {
        bytes4[] memory functionList = new bytes4[](6);
        functionList[0] = this.getImplementation.selector;
        functionList[1] = this.setImplementation.selector;
        functionList[2] = this.setImplementationCrossModules.selector;
        functionList[3] = this.getModuleImplementationAddress.selector;
        functionList[4] = this.setProxyOwner.selector;
        functionList[5] = this.getProxyOwner.selector;
        return functionList;
    }
}
