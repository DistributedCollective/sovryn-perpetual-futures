// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Limit Order Book Beacon: It holds the address of the implementation.
 * @notice The beacon holds the address of the actual Order Book contract. It is
 * created by the factoy contract and passes the initial implementation. A beacon
 * never changes.
 * */
contract LimitOrderBookBeacon is Ownable {
    // Creates instance of upgradable beacon
    UpgradeableBeacon public immutable beacon;

    /**
     * @notice Deploys beacon with initial implementation.
     * @param _initImplementation Address of first deployed LimitOrderBook implementation.
     * */
    constructor(address _initImplementation, address sender) {
        beacon = new UpgradeableBeacon(_initImplementation);
        transferOwnership(sender);
    }

    /**
     * @notice Updates the implementation.
     * @param _newImplementation Address of updated LimitOrderBook implementation.
     * */
    function update(address _newImplementation) public onlyOwner {
        beacon.upgradeTo(_newImplementation);
    }

    /**
     * @notice Returns current the implementation.
     * */
    function implementation() public view returns (address) {
        return beacon.implementation();
    }
}
