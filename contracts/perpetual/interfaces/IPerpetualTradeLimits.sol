// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../core/PerpStorage.sol";

interface IPerpetualTradeLimits {
    function setWhitelistActive(bool _flag) external;

    function isWhitelistActive() external view returns (bool);

    function addToWhitelist(address[] memory _accounts) external;

    function removeFromWhitelist(address[] memory _accounts) external;

    function getWhitelistedAddresses() external view returns (address[] memory);

    function isWhitelisted(address _account) external view returns (bool);

    function setMaxPosition(bytes32 _perpetualId, int128 _value) external;

    function getMaxPosition(bytes32 _perpetualId) external view returns (int128);
}
