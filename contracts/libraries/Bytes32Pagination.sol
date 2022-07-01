// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

library Bytes32Pagination {
    function paginate(
        bytes32[] memory hashes,
        uint256 page,
        uint256 limit
    ) internal pure returns (bytes32[] memory result) {
        result = new bytes32[](limit);
        for (uint256 i = 0; i < limit; i++) {
            if (page * limit + i < hashes.length) {
                result[i] = hashes[page * limit + i];
            } else {
                break;
            }
        }
    }
}
