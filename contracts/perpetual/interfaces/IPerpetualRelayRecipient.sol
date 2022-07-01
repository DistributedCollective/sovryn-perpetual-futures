// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IPerpetualRelayRecipient {
    function trustedForwarder() external view returns (address);

    function setTrustedForwarder(address _forwarder) external;

    function isTrustedForwarder(address forwarder) external view returns (bool);

    function versionRecipient() external view returns (string memory);
}
