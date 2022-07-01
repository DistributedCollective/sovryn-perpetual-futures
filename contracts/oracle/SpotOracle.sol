// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./AbstractOracle.sol";
import "../interface/IPriceFeedsExt.sol";
import "../interface/IChainLinkPriceFeed.sol";
import "../libraries/ABDKMath64x64.sol";
import "../libraries/QuickSort.sol";
import "../libraries/ConverterDec18.sol";

contract SpotOracle is AbstractOracle {
    using ABDKMath64x64 for uint256;
    using ABDKMath64x64 for int128;
    using ConverterDec18 for int256;
    using QuickSort for uint256[];
    using SafeMath for uint256;

    uint256 public constant CHAIN_LINK_MULTIPLIER = 10**10;

    bytes32 private baseCurrency;
    bytes32 private quoteCurrency;

    address[] public priceFeeds;
    bool[] public isIChainLink;

    bool private marketClosed;
    bool private terminated;

    constructor(
        bytes32 _baseCurrency,
        bytes32 _quoteCurrency,
        address[] memory _priceFeeds,
        bool[] memory _isChainLink
    ) {
        baseCurrency = _baseCurrency;
        quoteCurrency = _quoteCurrency;
        priceFeeds = _priceFeeds;
        isIChainLink = _isChainLink;
    }

    /**
     * @dev Sets the market is closed flag.
     */
    function setMarketClosed(bool _marketClosed) external override onlyOwner {
        marketClosed = _marketClosed;
    }

    /**
     * @dev The market is closed if the market is not in its regular trading period.
     */
    function isMarketClosed() external view override returns (bool) {
        return marketClosed;
    }

    /**
     * @dev Sets terminated flag.
     */
    function setTerminated(bool _terminated) external override onlyOwner {
        terminated = _terminated;
    }

    /**
     * @dev The oracle service was shutdown and never online again.
     */
    function isTerminated() external view override returns (bool) {
        return terminated;
    }

    /**
     *  Spot price.
     */
    function getSpotPrice() public view virtual override returns (int128, uint256) {
        uint256 length = priceFeeds.length;
        int128 price;
        uint256 timestamp = block.timestamp;
        if (length < 3) {
            for (uint256 i = 0; i < length; i++) {
                uint256 oraclePrice = IPriceFeedsExt(priceFeeds[i]).latestAnswer();
                if (isIChainLink[i]) {
                    oraclePrice = oraclePrice.mul(CHAIN_LINK_MULTIPLIER);
                    timestamp = IChainLinkPriceFeed(priceFeeds[i]).latestTimestamp();
                }
                price = price.add(int256(oraclePrice).fromDec18());
            }
            price = price.div(length.fromUInt());
        } else {
            uint256[] memory prices = new uint256[](length);
            for (uint256 i = 0; i < length; i++) {
                prices[i] = IPriceFeedsExt(priceFeeds[i]).latestAnswer();
                if (isIChainLink[i]) {
                    prices[i] = prices[i].mul(CHAIN_LINK_MULTIPLIER);
                    timestamp = IChainLinkPriceFeed(priceFeeds[i]).latestTimestamp();
                }
            }
            prices = prices.sort();
            if (length % 2 != 0) {
                uint256 i = length / 2;
                price = int256(prices[i]).fromDec18();
            } else {
                uint256 i = length / 2;
                price = int256((prices[i - 1].add(prices[i])).div(2)).fromDec18();
            }
        }
        return (price, timestamp);
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
