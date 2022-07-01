// SPDX-License-Identifier: MIT

pragma solidity 0.8.13;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./RbtcPaymaster.sol";

/**
 * @notice Paymaster that allows to pay for fees with rBTC (bridged RSK BTC).
 * - each request is paid for by the caller.
 * - preRelayedCall - pre-pay the maximum possible price for the tx
 * - postRelayedCall - refund the caller for the unused gas
 */
contract RbtcPaymasterTestnet is RbtcPaymaster {
    AggregatorV3Interface public immutable btcusdFeed;
    AggregatorV3Interface public immutable bnbusdFeed;

    /**
     * @param _rbtc Address of the aggregated BTC token.
     * @param _btcusdFeed Address of the Chainlink price feed for BTC/USD price
     * See https://data.chain.link/bsc/mainnet/crypto-usd/btc-usd
     * @param _bnbusdFeed Address of the Chainlink price feed for BNB/USD price
     * See https://data.chain.link/bsc/mainnet/crypto-usd/bnb-usd
     */
    constructor(
        uint256 _postGasUsage,
        IERC20 _rbtc,
        AggregatorV3Interface _btcusdFeed,
        AggregatorV3Interface _bnbusdFeed
    ) RbtcPaymaster(_postGasUsage, _rbtc, AggregatorV3Interface(address(0))) {
        btcusdFeed = _btcusdFeed;
        bnbusdFeed = _bnbusdFeed;
    }

    /**
     * @dev Call price feed and convert BNB amount into BTC amount
     * @param bnbAmount BNB amount to convert into BTC.
     * @return BTC value for BNB amount specified.
     */
    function _convertBnbToBtc(uint256 bnbAmount) internal view override returns (uint256) {
        (, int256 btcusdPrice, , , ) = btcusdFeed.latestRoundData();
        (, int256 bnbusdPrice, , , ) = bnbusdFeed.latestRoundData();

        // Computes BTC / BNB price with 18 decimals
        uint256 btcbnbPrice = (uint256(btcusdPrice) * 10**18) / uint256(bnbusdPrice);

        // The price value represents how many smallest division of BNB costs 1 BTC
        // So to convert bnbAmount to the smallest division of BTC we would do: bnbAmount / (price / 10**18)
        // But for precision, we will rather multiply the nominator instead of divising the denominator: (bnbAmount * 10**18) / price
        return (bnbAmount * 10**18) / btcbnbPrice;
    }
}
