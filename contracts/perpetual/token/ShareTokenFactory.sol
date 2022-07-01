// SPDX-License-Identifier: MIT

pragma solidity 0.8.13;

import "./ShareToken.sol";
import "../../interface/IShareTokenFactory.sol";

contract ShareTokenFactory is IShareTokenFactory {
    function createShareToken() external override returns (address) {
        ShareToken shareToken = new ShareToken();
        shareToken.transferOwnership(msg.sender);
        return address(shareToken);
    }
}
