// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../oracle/AbstractOracle.sol";
import "../libraries/ABDKMath64x64.sol";
import "../libraries/ConverterDec18.sol";

contract MockSpotOracle is AbstractOracle {
    using ABDKMath64x64 for int128;
    using ABDKMath64x64 for int256;
    using ConverterDec18 for int128;
    using ConverterDec18 for int256;

    int256 private constant DECIMALS = 10**18;
    int256 private constant PRICE_40K = 40000;
    int256 private constant PRICE_DIFFERENCE = 20001; //[0, 20000]

    int128 public basePrice = (PRICE_40K * DECIMALS).fromDec18();

    bytes32 private baseCurrency;
    bytes32 private quoteCurrency;

    constructor(bytes32 _baseCurrency, bytes32 _quoteCurrency) {
        baseCurrency = _baseCurrency;
        quoteCurrency = _quoteCurrency;
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
        int128 randomPrice = ((int256(block.timestamp) % PRICE_DIFFERENCE) * DECIMALS).fromDec18();
        int128 price = basePrice.add(randomPrice);
        return (price, block.timestamp);
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
