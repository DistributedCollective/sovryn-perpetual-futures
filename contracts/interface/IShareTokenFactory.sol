// SPDX-License-Identifier: MIT

pragma solidity 0.8.13;

interface IShareTokenFactory {
    function createShareToken() external returns (address);
}
