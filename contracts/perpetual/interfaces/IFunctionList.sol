// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IFunctionList {
    function getFunctionList() external pure returns (bytes4[] memory functionSignatures, bytes32 moduleName);
}
