// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../oracle/AbstractOracle.sol";

contract MockPriceScenarioOracle is AbstractOracle {
    bytes32 private baseCurrency;
    bytes32 private quoteCurrency;

    uint256 public priceIndex;
    int128[] public prices;

    constructor(
        bytes32 _baseCurrency,
        bytes32 _quoteCurrency,
        int128[] memory _prices
    ) {
        baseCurrency = _baseCurrency;
        quoteCurrency = _quoteCurrency;

        prices = _prices;
    }

    function updatePriceIndex() external {
        require(priceIndex < prices.length - 1, "priceIndex points the last price");
        priceIndex++;
    }

    function isMarketClosed() external view override returns (bool) {
        return false;
    }

    function setMarketClosed(bool _marketClosed) external override {}

    /**
     * @dev The oracle service was shutdown and never online again.
     */
    function isTerminated() external view override returns (bool) {
        return false;
    }

    function setTerminated(bool _terminated) external override {}

    /**
     *  Spot price.
     */
    function getSpotPrice() external view override returns (int128, uint256) {
        return (prices[priceIndex], block.timestamp);
    }

    /**
     * Get base currency symbol.
     */
    function getBaseCurrency() external view override returns (bytes32) {
        return baseCurrency;
    }

    /**
     * Get quote currency symbol.
     */
    function getQuoteCurrency() external view override returns (bytes32) {
        return quoteCurrency;
    }
}
