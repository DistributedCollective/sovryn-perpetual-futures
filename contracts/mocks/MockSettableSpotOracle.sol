// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../oracle/SpotOracle.sol";

contract MockSettableSpotOracle is SpotOracle {
    int128 public mockPrice;

    constructor(
        bytes32 _baseCurrency,
        bytes32 _quoteCurrency,
        address[] memory _priceFeeds,
        bool[] memory _isChainLink
    ) SpotOracle(_baseCurrency, _quoteCurrency, _priceFeeds, _isChainLink) {}

    function setMockPrice(int128 _mockPrice) external {
        mockPrice = _mockPrice;
    }

    function getSpotPrice() public view override returns (int128, uint256) {
        return mockPrice != 0 ? (mockPrice, block.timestamp) : super.getSpotPrice();
    }
}
