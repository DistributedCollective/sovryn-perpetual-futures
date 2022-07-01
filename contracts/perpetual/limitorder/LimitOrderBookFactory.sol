// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "./LimitOrderBook.sol";
import "./LimitOrderBookBeacon.sol";

/**
 * @title Limit Order Book Factory: Contract to deploy limit
 * order book for perpetuals
 * @notice Factory pattern allows to create multiple instances
 * of the same contract and keep track of them easily. LimitOrderBookFactory
 * creates Beacon Proxy. This proxy interacts with the beacon to fetch the address
 * of implementation and delegate call to it.
 * */
contract LimitOrderBookFactory is Ownable {
    // Events
    event PerpetualLimitOrderBookDeployed(bytes32 indexed perpetualId, address perpManagerAddress, address limitOrderBookAddress);

    // Perpetual Id => Address of Order Book
    mapping(bytes32 => address) private orderBooks;
    // Instance of beacon
    LimitOrderBookBeacon public immutable beacon;

    /**
     * @notice Sets the initial implementation and creates upgradable beacon.
     * @param _initImplementation Address of first deployed LimitOrderBook implementation.
     * */
    constructor(address _initImplementation) {
        require(_initImplementation != address(0), "invalid implementation address");
        beacon = new LimitOrderBookBeacon(_initImplementation, msg.sender);
    }

    /**
     * @notice Deploys limit order book beacon proxy contract.
     * @param _perpetualManagerAddr the address of perpetual proxy manager.
     * @param _perpetualId The id of perpetual.
     * */
    function deployLimitOrderBookProxy(address _perpetualManagerAddr, bytes32 _perpetualId) external onlyOwner {
        require(orderBooks[_perpetualId] == address(0), "orderbook already deployed");
        BeaconProxy limitOrderBookProxy = new BeaconProxy(
            address(beacon),
            abi.encodeWithSelector(LimitOrderBook(address(0)).initialize.selector, _perpetualManagerAddr, _perpetualId)
        );
        orderBooks[_perpetualId] = address(limitOrderBookProxy);
        emit PerpetualLimitOrderBookDeployed(_perpetualId, _perpetualManagerAddr, address(limitOrderBookProxy));
    }

    /**
     * @notice Gets the address of order book deployed for a specific perpetual.
     * @param _perpetualId The id of perpetual.
     * */
    function getOrderBookAddress(bytes32 _perpetualId) external view returns (address) {
        return orderBooks[_perpetualId];
    }

    /**
     * @notice Gets the beacon address.
     * */
    function getBeacon() public view returns (address) {
        return address(beacon);
    }

    /**
     * @notice Gets the current implementation.
     * */
    function getImplementation() public view returns (address) {
        return beacon.implementation();
    }
}
