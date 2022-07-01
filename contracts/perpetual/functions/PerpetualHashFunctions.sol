// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../interfaces/IPerpetualOrder.sol";

contract PerpetualHashFunctions {
    string private constant NAME = "Perpetual Trade Manager";

    //The EIP-712 typehash for the contract's domain.
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");

    //The EIP-712 typehash for the Order struct used by the contract.
    bytes32 private constant TRADE_ORDER_TYPEHASH =
        keccak256(
            "Order(bytes32 iPerpetualId,address traderAddr,int128 fAmount,int128 fLimitPrice,int128 fTriggerPrice,uint256 iDeadline,uint32 flags,int128 fLeverage,uint256 createdTimestamp)"
        );

    /**
     * @notice Creates the hash for an order
     * @param _order the address of perpetual proxy manager.
     * @param _contract The id of perpetual.
     * @param _createOrder true if order is to be executed, false for cancel-order digest
     * @return hash of order and _createOrder-flag
     * */
    function _getDigest(
        IPerpetualOrder.Order memory _order,
        address _contract,
        bool _createOrder
    ) internal view returns (bytes32) {
        /*
         * The DOMAIN_SEPARATOR is a hash that uniquely identifies a
         * smart contract. It is built from a string denoting it as an
         * EIP712 Domain, the name of the token contract, the version,
         * the chainId in case it changes, and the address that the
         * contract is deployed at.
         */
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(NAME)), _getChainId(), _contract));

        // ORDER_TYPEHASH
        bytes32 structHash = _getStructHash(_order);

        bytes32 digest = keccak256(abi.encode(domainSeparator, structHash, _createOrder));

        digest = ECDSA.toEthSignedMessageHash(digest);
        return digest;
    }

    function _getChainId() internal view returns (uint256) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return chainId;
    }

    /**
     * @notice Creates the hash of the order-struct
     * @dev order.referrerAddr is not hashed, 
     * because it is to be set by the referrer
     * @param _order : order struct
     * @return bytes32 hash of order
     * */
    function _getStructHash(IPerpetualOrder.Order memory _order) internal pure returns (bytes32) { 
        bytes32 structHash = keccak256(
            abi.encode(
                TRADE_ORDER_TYPEHASH,
                _order.iPerpetualId,
                _order.traderAddr,
                _order.fAmount,
                _order.fLimitPrice,
                _order.fTriggerPrice,
                _order.iDeadline,
                _order.flags,
                _order.fLeverage,
                _order.createdTimestamp
            )
        );
        return structHash;
    }
}
