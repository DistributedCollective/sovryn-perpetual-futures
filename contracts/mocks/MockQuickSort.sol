// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../libraries/QuickSort.sol";

contract MockQuickSort {
    using QuickSort for uint256[];

    function sort(uint256[] memory _data) public view returns (uint256[] memory) {
        return _data.sort();
    }

    function sortInTransaction(uint256[] memory _data) public {
        _data.sort();
    }
}
