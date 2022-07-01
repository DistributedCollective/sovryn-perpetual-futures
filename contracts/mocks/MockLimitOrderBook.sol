// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/limitorder/LimitOrderBook.sol";

/**
 * @title Limit Order Book Mock Contract.
 * */
contract MockLimitOrderBook is LimitOrderBook {
    /**
     * @notice Returns all orders(specified by offset/start and limit/count) - including cancelled
     * @param offset start.
     * @param limit count.
     * */
    function getAllOrders(uint256 offset, uint256 limit) external view returns (Order[] memory orders) {
        orders = new Order[](limit);
        bytes32[] memory digests = allDigests;
        for (uint256 i = 0; i < limit; i++) {
            if (i + offset < digests.length) {
                bytes32 digest = digests[i + offset];
                orders[i] = orderOfDigest[digest];
            }
        }
    }
}
