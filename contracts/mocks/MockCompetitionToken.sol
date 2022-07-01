// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "./MockRbtc.sol";
import "../libraries/EnumerableSetUpgradeable.sol";

contract MockCompetitionToken is MockRbtc {
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

    EnumerableSetUpgradeable.AddressSet whitelisted;

    constructor(address forwarder) MockRbtc(forwarder) {}

    function mint_(address[] calldata _accounts, uint256 _amount) external onlyOwner {
        for (uint256 i = 0; i < _accounts.length; i++) {
            _mint(_accounts[i], _amount);
        }
    }

    function addToWhitelist(address[] memory _accounts) external onlyOwner {
        for (uint256 i = 0; i < _accounts.length; i++) {
            whitelisted.add(_accounts[i]);
        }
    }

    function removeFromWhitelist(address[] memory _accounts) external onlyOwner {
        for (uint256 i = 0; i < _accounts.length; i++) {
            whitelisted.remove(_accounts[i]);
        }
    }

    function transfer(address recipient, uint256 amount) public override returns (bool) {
        require(whitelisted.contains(_msgSender()) || whitelisted.contains(recipient), "Transfer is not allowed");
        return super.transfer(recipient, amount);
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override returns (bool) {
        require(whitelisted.contains(sender) || whitelisted.contains(recipient), "Transfer is not allowed");
        return super.transferFrom(sender, recipient, amount);
    }
}
