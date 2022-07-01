// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../gsn/RbtcPaymasterTestnet.sol";

contract MockRbtcPaymasterTestnet is RbtcPaymasterTestnet {
    constructor(
        uint256 _postGasUsage,
        IERC20 _rbtc,
        AggregatorV3Interface _btcusdFeed,
        AggregatorV3Interface _bnbusdFeed
    ) RbtcPaymasterTestnet(_postGasUsage, _rbtc, _btcusdFeed, _bnbusdFeed) {}

    function convertBnbToBtc(uint256 bnbAmount) external view returns (uint256) {
        return _convertBnbToBtc(bnbAmount);
    }
}
