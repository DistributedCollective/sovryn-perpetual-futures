// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../gsn/RbtcPaymaster.sol";

contract MockRbtcPaymaster is RbtcPaymaster {
    constructor(
        uint256 _postGasUsage,
        IERC20 _rbtc,
        AggregatorV3Interface _btcbnbFeed
    ) RbtcPaymaster(_postGasUsage, _rbtc, _btcbnbFeed) {}

    function convertBnbToBtc(uint256 bnbAmount) external view returns (uint256) {
        return _convertBnbToBtc(bnbAmount);
    }
}
