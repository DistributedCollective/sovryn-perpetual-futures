// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../gsn/interfaces/IRelayRecipient.sol";

contract MockRbtc is ERC20, Ownable, IRelayRecipient {
    address public paymaster;
    address private _trustedForwarder;
    mapping(address => bool) public paymasterRevoked;

    constructor(address forwarder) ERC20("rBTC", "rBTC") {
        _trustedForwarder = forwarder;
    }

    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return forwarder == _trustedForwarder;
    }

    function _msgSender() internal view override(Context, IRelayRecipient) returns (address ret) {
        if (msg.data.length >= 20 && isTrustedForwarder(msg.sender)) {
            assembly {
                ret := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            ret = payable(msg.sender);
        }
    }

    function _msgData() internal view override(Context, IRelayRecipient) returns (bytes calldata ret) {
        if (msg.data.length >= 20 && isTrustedForwarder(msg.sender)) {
            return msg.data[0:msg.data.length - 20];
        } else {
            return msg.data;
        }
    }

    function versionRecipient() external view override returns (string memory) {
        return "2.2.3+opengsn.bsc.irelayrecipient";
    }

    function setPaymaster(address _paymaster) external onlyOwner {
        paymaster = _paymaster;
    }

    function mint(address _account, uint256 _amount) external onlyOwner {
        _mint(_account, _amount);
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        if (_msgSender() == paymaster && !paymasterRevoked[sender]) {
            _transfer(sender, recipient, amount);
        } else {
            super.transferFrom(sender, recipient, amount);
        }
        return true;
    }
}
