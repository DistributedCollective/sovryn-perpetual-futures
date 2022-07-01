pragma solidity 0.8.13;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../gsn/interfaces/IRbtcPaymaster.sol";
import "../gsn/interfaces/IRelayHub.sol";
import "hardhat/console.sol";

contract MockRelayHub {
    using SafeMath for uint256;
    IRbtcPaymaster private paymaster;
    IERC20 public immutable rbtc;

    event GasUsedByPost(uint256 amount);

    constructor(address _paymaster, address _rbtc) {
        paymaster = IRbtcPaymaster(_paymaster);
        rbtc = IERC20(_rbtc);
    }

    function callPreRelayedCall(GsnTypes.RelayRequest calldata relayRequest, uint256 maxPossibleGas)
        external
        returns (bytes memory context, bool revertOnRecipientRevert)
    {
        return paymaster.preRelayedCall(relayRequest, "0x", "0x", maxPossibleGas);
    }

    function callPostRelayedCall(
        bytes calldata context,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    ) external {
        paymaster.postRelayedCall(context, true, gasUseWithoutPost, relayData);
    }

    function calculateCharge(uint256 gasUsed, GsnTypes.RelayData calldata relayData) public pure returns (uint256) {
        return relayData.baseRelayFee.add((gasUsed.mul(relayData.gasPrice).mul(relayData.pctRelayFee.add(100))).div(100));
    }

    /**
     * @dev Calculate the postRelayedCall gas usage for an RbtcPaymaster.
     * usage:
     * - create this calculator.
     * - create an instance of your RbtcPaymaster.
     * - transfer or mint some rBTC tokens (1000 "wei") to the calculator
     * - call this method.
     * @return postGasUsage Value to set your real RbtcPaymaster.setPostGasUsage()
     */
    function calculatePostGasUsage(uint256 tokenPreCharge) external returns (uint256 postGasUsage) {
        require(rbtc.balanceOf(address(this)) >= tokenPreCharge, "must move some tokens to calculator first");
        require(paymaster.owner() == address(this), "must set calculator as owner of paymaster");

        rbtc.approve(address(paymaster), type(uint256).max);
        rbtc.approve(msg.sender, type(uint256).max);
        paymaster.setRelayHub(IRelayHub(address(this)));

        // emulate a "precharge"
        rbtc.transfer(address(paymaster), tokenPreCharge);
        GsnTypes.RelayData memory relayData = GsnTypes.RelayData(1, 0, 0, address(0), address(0), address(0), "", 0);
        bytes memory context = abi.encode(address(this), tokenPreCharge);

        uint256 gas0 = gasleft();
        paymaster.postRelayedCall(context, true, 100, relayData);
        uint256 gas1 = gasleft();
        postGasUsage = gas0 - gas1;

        console.log("Post gas usage: %s", postGasUsage);
        emit GasUsedByPost(postGasUsage);
    }
}
