// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../interfaces/IPerpetualManager.sol";
import "../interfaces/IPerpetualOrder.sol";
import "../../libraries/RSKAddrValidator.sol";
import "../../libraries/Bytes32Pagination.sol";
import "../functions/PerpetualHashFunctions.sol";

/**
 * @title Limit/Stop Order Book Proxy Contract.
 *
 * @notice A new perpetual limit order book contract.
 *
 * @dev We can have several order books as the product grows.
 * Hence, we create a new contract for each order book and
 * set the implementation to the same contract.
 * This saves deployment cost. We can upgrade the implementation and add
 * functions to the contract ONLY at the end. We cannot
 * add state variables as that will mess up the storage for exisitng
 * order books.
 * */
contract LimitOrderBook is IPerpetualOrder, Initializable, PerpetualHashFunctions {
    using Bytes32Pagination for bytes32[];
    uint256 private constant MAX_ORDERS_PER_TRADER = 15;
    // Events
    event PerpetualLimitOrderCreated(bytes32 indexed perpetualId, 
        address indexed trader,
        int128 tradeAmount,
        int128 limitPrice, 
        int128 triggerPrice, 
        uint256 deadline, 
        address referrerAddr, 
        uint32 flags, 
        int128 leverage,
        uint256 createdTimestamp,
        bytes32 digest);

    // Array of digests of all orders - irrespecitve of deletion
    bytes32[] public allDigests;

    // Address of trader => digests (orders)
    mapping(address => bytes32[]) public digestsOfTrader;

    // Digest of an order => the order and its data
    mapping(bytes32 => IPerpetualOrder.Order) public orderOfDigest;

    // OrderDigest => Signature
    mapping(bytes32 => bytes) public orderSignature;

    // Next order digest of a digest
    mapping(bytes32 => bytes32) public nextOrderHash;

    //Previous order digest of a digest
    mapping(bytes32 => bytes32) public prevOrderHash;

    // Stores last order digest
    bytes32 public lastOrderHash;

    // Order actual count - after addition/removal
    uint256 public orderCount;

    // Perpetual Manager
    IPerpetualManager public perpManager;

    // Stores perpetual id - specific to a perpetual
    bytes32 public perpetualId;

    /**
     * @notice Creates the Perpetual Limit Order Book.
     * @dev Replacement of constructor by initialize function for Upgradable Contracts
     * This function will be called only once while deploying order book using Factory.
     * @param _perpetualManagerAddr the address of perpetual proxy manager.
     * @param _perpetualId The id of perpetual.
     * */
    function initialize(address _perpetualManagerAddr, bytes32 _perpetualId) external initializer {
        require(_perpetualManagerAddr != address(0), "perpetual manager invalid");
        require(_perpetualId != bytes32(0), "perpetualId invalid");
        perpetualId = _perpetualId;
        perpManager = IPerpetualManager(_perpetualManagerAddr);
    }

    /**
     * @notice Creates Limit/Stop Order using order object with the following fields:
     * iPerpetualId  global id for perpetual
     * traderAddr    address of trader
     * fAmount       amount in base currency to be traded
     * fLimitPrice   limit price
     * fTriggerPrice trigger price, non-zero for stop orders
     * iDeadline     deadline for price (seconds timestamp)
     * referrerAddr  address of abstract referrer
     * flags         trade flags
     * @dev Replacement of constructor by initialize function for Upgradable Contracts
     * This function will be called only once while deploying order book using Factory.
     * @param _order the order details.
     * @param signature The traders signature.
     * */
    function createLimitOrder(Order memory _order, bytes memory signature) external {
        // Validations
        require(perpetualId == _order.iPerpetualId, "order should be sent to correct order book");
        require(_order.traderAddr != address(0), "invalid-trader");
        require(_order.iDeadline > block.timestamp, "invalid-deadline");

        bytes32 digest = _getDigest(_order, address(perpManager), true);
        address signatory = ECDSA.recover(digest, signature);
        //Verify address is not null and PK is not null either.
        require(RSKAddrValidator.checkPKNotZero(signatory), "invalid signature or PK");
        require(signatory == _order.traderAddr, "invalid signature");
        require(orderOfDigest[digest].traderAddr == address(0), "order-exists");
        require(digestsOfTrader[_order.traderAddr].length < MAX_ORDERS_PER_TRADER, "max num orders for trader exceeded");
        // register
        _addOrder(digest, _order, signature);
        emit PerpetualLimitOrderCreated(_order.iPerpetualId, 
            _order.traderAddr, _order.fAmount, _order.fLimitPrice, 
            _order.fTriggerPrice, _order.iDeadline, _order.referrerAddr, 
            _order.flags, _order.fLeverage, _order.createdTimestamp, digest);

    }

    /**
     * @notice Execute Order or cancel & remove it (if expired).
     * @dev Interacts with the PerpetualTradeManager.
     * @param _order the order details.
     * */
    function executeLimitOrder(Order memory _order) external {
        bytes32 digest = _getDigest(_order, address(perpManager), true);
        _executeLimitOrder(_order, digest);
    }

    /**
     * @notice Execute Order or cancel & remove it (if expired).
     * @dev Interacts with the PerpetualTradeManager.
     * @param _digest hash of the order.
     * @param _referrerAddr address that will receive referral rebate
     * */
    function executeLimitOrderByDigest(bytes32 _digest, address _referrerAddr) external {
        Order memory order = orderOfDigest[_digest];
        order.referrerAddr = _referrerAddr;
        _executeLimitOrder(order, _digest);
    }

    /**
     * @notice Execute Order or cancel & remove it
     * @dev Interacts with the PerpetualTradeManager.
     * @param _digest hash of the order.
     * @param _order the order details.
     * */
    function _executeLimitOrder(Order memory _order, bytes32 _digest) internal {
        bytes memory signature = orderSignature[_digest];
        // Remove the order (locally) if it has expired
        if (block.timestamp <= _order.iDeadline) {
            perpManager.tradeBySig(_order, signature);
        }
        // if expired or executed, we remove the order
        // if the order does not match with prices, there is a revert so
        // we do not end up here
        _removeOrder(_digest);
    }

    /**
     * @notice Cancels limit/stop order
     * @dev Order can be cancelled by the trader himself or it can be
     * removed by the relayer if it has expired.
     * @param _digest hash of the order.
     * @param _signature signed cancel-order; 0 if order expired
     * */
    function cancelLimitOrder(bytes32 _digest, bytes memory _signature) public {
        Order memory order = orderOfDigest[_digest];
        require(perpetualId == order.iPerpetualId, "cancel order should be sent to correct order book");
        perpManager.cancelOrder(order, _signature);
        _removeOrder(_digest);
    }

    /**
     * @notice Internal function to add order to order book.
     * */
    function _addOrder(
        bytes32 _digest,
        Order memory _order,
        bytes memory _signature
    ) internal {
        orderOfDigest[_digest] = _order;
        orderSignature[_digest] = _signature;
        allDigests.push(_digest);
        digestsOfTrader[_order.traderAddr].push(_digest);
        // add order to orderbook linked list
        nextOrderHash[lastOrderHash] = _digest;
        prevOrderHash[_digest] = lastOrderHash;
        lastOrderHash = _digest;
        orderCount = orderCount + 1;
    }

    /**
     * @notice Internal function to remove order from order book.
     * @dev We do not remove entry from orderOfDigest & orderSignature.
     * */
    function _removeOrder(bytes32 _digest) internal {
        // remove from trader's order-array 'orderOfDigest'
        Order memory order = orderOfDigest[_digest];
        bytes32[] storage orderArr = digestsOfTrader[order.traderAddr];
        require(orderArr.length <= MAX_ORDERS_PER_TRADER, "too many orders");
        uint256 k;
        while (k < orderArr.length) {
            if (orderArr[k] == _digest) {
                orderArr[k] = orderArr[orderArr.length - 1];
                orderArr.pop();
                k = MAX_ORDERS_PER_TRADER;
            }
            k = k + 1;
        }
        // remove order
        delete orderOfDigest[_digest];

        // remove from linked list needed
        if (lastOrderHash == _digest) {
            lastOrderHash = prevOrderHash[_digest];
        } else {
            prevOrderHash[nextOrderHash[_digest]] = prevOrderHash[_digest];
        }
        bytes32 prevHash = prevOrderHash[_digest];
        nextOrderHash[prevHash] = nextOrderHash[_digest];
        // delete obsolete entries
        delete prevOrderHash[_digest];
        delete nextOrderHash[_digest];
        orderCount = orderCount - 1;
    }

    /**
     * @notice Returns the number of (active) limit orders of a trader
     * @param trader address of trader.
     * */
    function numberOfDigestsOfTrader(address trader) external view returns (uint256) {
        return digestsOfTrader[trader].length;
    }

    /**
     * @notice Returns the number of all limit orders - including those
     * that are cancelled/removed.
     * */
    function numberOfAllDigests() external view returns (uint256) {
        return allDigests.length;
    }

    /**
     * @notice Returns the number of all limit orders - excluding those
     * that are cancelled/removed.
     * */
    function numberOfOrderBookDigests() external view returns (uint256) {
        return orderCount;
    }

    /**
     * @notice Returns an array of digests of orders of a trader
     * @param trader address of trader.
     * @param page start/offset.
     * @param limit count.
     * */
    function limitDigestsOfTrader(
        address trader,
        uint256 page,
        uint256 limit
    ) external view returns (bytes32[] memory) {
        return digestsOfTrader[trader].paginate(page, limit);
    }

    /**
     * @notice Returns an array of all digests - including those
     * that are cancelled/removed.
     * */
    function allLimitDigests(uint256 page, uint256 limit) external view returns (bytes32[] memory) {
        return allDigests.paginate(page, limit);
    }

    /**
     * @notice Returns the address of trader for an order digest
     * @param digest order digest.
     * @return trader address
     * */
    function getTrader(bytes32 digest) external view returns (address trader) {
        Order memory order = orderOfDigest[digest];
        trader = order.traderAddr;
    }

    /**
     * @notice Returns all orders(specified by offset/start and limit/count) of a trader
     * @param trader address of trader.
     * @param offset start.
     * @param limit count.
     * @return orders : array of orders
     * */
    function getOrders(
        address trader,
        uint256 offset,
        uint256 limit
    ) external view returns (Order[] memory orders) {
        orders = new Order[](limit);
        bytes32[] memory digests = digestsOfTrader[trader];
        for (uint256 i = 0; i < limit; i++) {
            if (i + offset < digests.length) {
                bytes32 digest = digests[i + offset];
                orders[i] = orderOfDigest[digest];
            }
        }
    }

    /**
     * @notice Returns the signature of trader for an order digest.
     * @param digest digest of an order.
     * @return signature signature of the trader who created the order.
     * */
    function getSignature(bytes32 digest) public view returns (bytes memory signature) {
        return orderSignature[digest];
    }

    /**
     * @notice Returns the details of the specified number of orders from
     * the passed starting digest
     * @param _startAfter digest to start.
     * @param _numElements number of orders to display.
     * return (orders, orderHashes) : (order hash details, orderHashes).
     * */
    function pollLimitOrders(bytes32 _startAfter, uint256 _numElements) external view returns (Order[] memory orders, bytes32[] memory orderHashes) {
        uint256 k = 0;
        orders = new Order[](_numElements);
        orderHashes = new bytes32[](_numElements);
        bytes32 current = _startAfter;
        while (k < _numElements) {
            orders[k] = orderOfDigest[nextOrderHash[current]];
            orderHashes[k] = nextOrderHash[current];
            k++;
            current = nextOrderHash[current];
            if (current == bytes32(0)) {
                // no more elements in list, we're done
                k = _numElements;
            }
        }
    }
}
