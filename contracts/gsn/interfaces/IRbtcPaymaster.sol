// SPDX-License-Identifier: MIT

pragma solidity 0.8.13;

import "./IPaymaster.sol";
import "./IRelayHub.sol";

interface IRbtcPaymaster is IPaymaster {
    function owner() external view returns (address);

    function setRelayHub(IRelayHub hub) external;
}
