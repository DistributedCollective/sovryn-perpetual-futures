// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IPriceFeedsExt {
    function latestAnswer() external view returns (uint256);
}
