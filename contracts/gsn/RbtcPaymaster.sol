// SPDX-License-Identifier: MIT

pragma solidity 0.8.13;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./BasePaymaster.sol";

/**
 * @notice Paymaster that allows to pay for fees with rBTC (bridged RSK BTC).
 * - each request is paid for by the caller.
 * - preRelayedCall - pre-pay the maximum possible price for the tx
 * - postRelayedCall - refund the caller for the unused gas
 */
contract RbtcPaymaster is BasePaymaster {
    // Gas usage of the postRelayedCall function
    uint256 public immutable postGasUsage;
    IERC20 public immutable rbtc;
    AggregatorV3Interface public immutable btcbnbFeed;

    event TokensCharged(uint256 gasUseWithoutPost, uint256 bnbActualCharge, uint256 tokenActualCharge);

    /**
     * @param _rbtc Address of the aggregated BTC token.
     * @param _btcbnbFeed Address of the Chainlink price feed for BTC/BNB price
     * See https://data.chain.link/bsc/mainnet/crypto-bnb/btc-bnb
     */
    constructor(
        uint256 _postGasUsage,
        IERC20 _rbtc,
        AggregatorV3Interface _btcbnbFeed
    ) {
        postGasUsage = _postGasUsage;
        rbtc = _rbtc;
        btcbnbFeed = _btcbnbFeed;
    }

    function versionPaymaster() external view virtual override returns (string memory) {
        return "2.2.0+opengsn.rbtc.ipaymaster";
    }

    /**
     * @return the payer of this request.
     */
    function getPayer(GsnTypes.RelayRequest calldata relayRequest) external view virtual returns (address) {
        return relayRequest.request.from;
    }

    function withdrawRbtcCollected(address receiver, uint256 amount) external onlyOwner {
        // No need for safeTransfer, we know our token implementation returns true if success
        require(rbtc.transfer(receiver, amount), "Withdraw token transfer failed");
    }

    /**
     * @dev Called by relayHub before the meta transaction request is processed.
     * Only callable by relayHub contract.
     * @param relayRequest Struct created by the relayer with infos about the request (see GsnTypes contract).
     * @param maxPossibleGas Gas limit for the meta transaction, computed by relayer.
     * @return context Bytes payload with payer address (sender of the meta transaction) and the amount of rBTC pre charged.
     */
    function preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata,
        bytes calldata,
        uint256 maxPossibleGas
    ) external virtual override relayHubOnly returns (bytes memory context, bool revertOnRecipientRevert) {
        address payer = relayRequest.request.from;
        // Computes the amount of BNB needed depending on gas limit and fees taken by the relayer
        uint256 bnbMaxCharge = relayHub.calculateCharge(maxPossibleGas + postGasUsage, relayRequest.relayData);
        bnbMaxCharge += relayRequest.request.value;
        uint256 tokenPrecharge = _convertBnbToBtc(bnbMaxCharge);
        // No need for safeTransferFrom, we know our token implementation returns true if success
        require(rbtc.transferFrom(payer, address(this), tokenPrecharge), "PreRelayedCall token transfer failed");
        return (abi.encode(payer, tokenPrecharge), false);
    }

    /**
     * @dev Called by relayHub after the meta transaction request is processed.
     * Only callable by relayHub contract.
     * @param context Value returned by the preRelayedCall function.
     * @param gasUseWithoutPost Actual gas amount consumed by the preRelayedCall function plus the meta transaction request.
     * @param relayData Struct created by the relayer with infos about the request (see GsnTypes contract).
     */
    function postRelayedCall(
        bytes calldata context,
        bool,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    ) external virtual override relayHubOnly {
        (address payer, uint256 tokenPrecharge) = abi.decode(context, (address, uint256));
        // Computes the amount of BNB needed depending on gas amount consumed so far plus gas consumed by
        // this function and fees taken by the relayer
        uint256 bnbActualCharge = relayHub.calculateCharge(gasUseWithoutPost + postGasUsage, relayData);
        uint256 tokenActualCharge = _convertBnbToBtc(bnbActualCharge);
        uint256 tokenRefund = tokenPrecharge - tokenActualCharge;
        // Refund payer for excess tokens taken
        // No need for safeTransfer, we know our token implementation returns true if success
        require(rbtc.transfer(payer, tokenRefund), "RbtcPaymaster: failed to refund");
        emit TokensCharged(gasUseWithoutPost, bnbActualCharge, tokenActualCharge);
    }

    /**
     * @dev Call price feed and convert BNB amount into BTC amount
     * @param bnbAmount BNB amount to convert into BTC.
     * @return BTC value for BNB amount specified.
     */
    function _convertBnbToBtc(uint256 bnbAmount) internal view virtual returns (uint256) {
        (, int256 price, , , ) = btcbnbFeed.latestRoundData();
        // The price value represents how many smallest division of BNB costs 1 BTC
        // So to convert bnbAmount to the smallest division of BTC we would do: bnbAmount / (price / 10**18)
        // But for precision, we will rather multiply the nominator instead of divising the denominator: (bnbAmount * 10**18) / price
        return (bnbAmount * 10**18) / uint256(price);
    }
}
