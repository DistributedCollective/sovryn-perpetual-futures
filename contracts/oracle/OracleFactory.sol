// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../libraries/ABDKMath64x64.sol";
import "../interface/IPriceFeedsExt.sol";
import "./SpotOracle.sol";

contract OracleFactory is Ownable, OracleInterfaceID {
    using ERC165Checker for address;
    using ABDKMath64x64 for int128;

    int128 constant ONE_64x64 = 0x10000000000000000; // 2^64

    struct OracleData {
        address oracle;
        bool isInverse;
    }

    //baseCurrency => quoteCurrency => oracles' addresses
    mapping(bytes32 => mapping(bytes32 => OracleData[])) private routes;

    event OracleCreated(bytes32 baseCurrency, bytes32 quoteCurrency, address oracle);
    event OracleAdded(bytes32 baseCurrency, bytes32 quoteCurrency, address oracle);
    event ShortRouteAdded(bytes32 baseCurrency, bytes32 quoteCurrency, address oracle);
    event RouteAdded(bytes32 baseCurrency, bytes32 quoteCurrency, address[] oracle, bool[] isInverse);
    event RouteRemoved(bytes32 baseCurrency, bytes32 quoteCurrency);

    /**
     * @notice Deploys Oracle contract for currency pair.
     * @dev The route for the given pair will be set (overwritten if it was already set).
     *
     * @param   _baseCurrency   The base currency symbol.
     * @param   _quoteCurrency  The quote currency symbol.
     * @param   _priceFeeds     The array of IPriceFeedsExt
     */
    function createOracle(
        bytes32 _baseCurrency,
        bytes32 _quoteCurrency,
        address[] memory _priceFeeds,
        bool[] memory _isChainLink
    ) external onlyOwner returns (address) {
        require(_baseCurrency != "", "invalid base currency");
        require(_quoteCurrency != 0, "invalid quote currency");
        require(_baseCurrency != _quoteCurrency, "base and quote should differ");
        require(_priceFeeds.length > 0, "at least one price feed needed");

        address oracle = address(new SpotOracle(_baseCurrency, _quoteCurrency, _priceFeeds, _isChainLink));
        SpotOracle(oracle).transferOwnership(msg.sender);
        _setRoute(_baseCurrency, _quoteCurrency, oracle);

        //checks that price can be calculated
        _getSpotPrice(_baseCurrency, _quoteCurrency);

        emit OracleCreated(_baseCurrency, _quoteCurrency, oracle);

        return oracle;
    }

    /**
     * @notice Sets Oracle contract for currency pair.
     * @dev The route for the given pair will be set (overwritten if it was already set).
     *
     * @param   _oracle   The Oracle contract (should implement ISpotOracle interface).
     */
    function addOracle(address _oracle) external onlyOwner {
        require(_oracle.supportsInterface(_getOracleInterfaceID()), "invalid oracle");

        bytes32 baseCurrency = ISpotOracle(_oracle).getBaseCurrency();
        bytes32 quoteCurrency = ISpotOracle(_oracle).getQuoteCurrency();
        _setRoute(baseCurrency, quoteCurrency, _oracle);

        //checks that price can be calculated
        _getSpotPrice(baseCurrency, quoteCurrency);

        emit OracleAdded(baseCurrency, quoteCurrency, _oracle);
    }

    /**
     * @notice Sets Oracle as a shortest route for the given currency pair.
     *
     * @param   _baseCurrency   The base currency symbol.
     * @param   _quoteCurrency  The quote currency symbol.
     * @param   _oracle         The Oracle contract (should implement ISpotOracle interface).
     */
    function _setRoute(
        bytes32 _baseCurrency,
        bytes32 _quoteCurrency,
        address _oracle
    ) internal {
        delete routes[_baseCurrency][_quoteCurrency];
        routes[_baseCurrency][_quoteCurrency].push(OracleData(address(_oracle), false));
        emit ShortRouteAdded(_baseCurrency, _quoteCurrency, _oracle);
    }

    /**
     * @notice Sets the given array of oracles as a route for the given currency pair.
     *
     * @param   _baseCurrency   The base currency symbol.
     * @param   _quoteCurrency  The quote currency symbol.
     * @param   _oracles        The array Oracle contracts.
     * @param   _isInverse      The array of flags whether price is inverted.
     */
    function addRoute(
        bytes32 _baseCurrency,
        bytes32 _quoteCurrency,
        address[] calldata _oracles,
        bool[] calldata _isInverse
    ) external onlyOwner {
        _validateRoute(_baseCurrency, _quoteCurrency, _oracles, _isInverse);

        uint256 length = _oracles.length;
        delete routes[_baseCurrency][_quoteCurrency];
        for (uint256 i = 0; i < length; i++) {
            routes[_baseCurrency][_quoteCurrency].push(OracleData(_oracles[i], _isInverse[i]));
        }

        //checks that price can be calculated
        _getSpotPrice(_baseCurrency, _quoteCurrency);

        emit RouteAdded(_baseCurrency, _quoteCurrency, _oracles, _isInverse);
    }

    /**
     * @notice Validates the given array of oracles as a route for the given currency pair.
     *
     * @param   _baseCurrency   The base currency symbol.
     * @param   _quoteCurrency  The quote currency symbol.
     * @param   _oracles        The array Oracle contracts.
     * @param   _isInverse      The array of flags whether price is inverted.
     */
    function _validateRoute(
        bytes32 _baseCurrency,
        bytes32 _quoteCurrency,
        address[] calldata _oracles,
        bool[] calldata _isInverse
    ) internal view {
        require(_oracles.length == _isInverse.length, "arrays mismatch");
        uint256 length = _oracles.length;
        require(length > 0, "invalid oracles data");

        bytes32 srcCurrency;
        bytes32 destCurrency;
        if (!_isInverse[0]) {
            srcCurrency = ISpotOracle(_oracles[0]).getBaseCurrency();
            require(_baseCurrency == srcCurrency, "invalid route [1]");
            destCurrency = ISpotOracle(_oracles[0]).getQuoteCurrency();
        } else {
            srcCurrency = ISpotOracle(_oracles[0]).getQuoteCurrency();
            require(_baseCurrency == srcCurrency, "invalid route [2]");
            destCurrency = ISpotOracle(_oracles[0]).getBaseCurrency();
        }
        for (uint256 i = 1; i < length; i++) {
            bytes32 oracleBaseCurrency = ISpotOracle(_oracles[i]).getBaseCurrency();
            bytes32 oracleQuoteCurrency = ISpotOracle(_oracles[i]).getQuoteCurrency();
            if (!_isInverse[i]) {
                require(destCurrency == oracleBaseCurrency, "invalid route [3]");
                destCurrency = oracleQuoteCurrency;
            } else {
                require(destCurrency == oracleQuoteCurrency, "invalid route [4]");
                destCurrency = oracleBaseCurrency;
            }
        }
        require(_quoteCurrency == destCurrency, "invalid route [5]");
    }

    /**
     * @notice Removes a route for the given currency pair.
     *
     * @param   _baseCurrency   The base currency symbol.
     * @param   _quoteCurrency  The quote currency symbol.
     */
    function removeRoute(bytes32 _baseCurrency, bytes32 _quoteCurrency) external onlyOwner {
        delete routes[_baseCurrency][_quoteCurrency];
        emit RouteRemoved(_baseCurrency, _quoteCurrency);
    }

    /**
     * @notice Returns the route for the given currency pair.
     *
     * @param   _baseCurrency   The base currency symbol.
     * @param   _quoteCurrency  The quote currency symbol.
     */
    function getRoute(bytes32 _baseCurrency, bytes32 _quoteCurrency) external view returns (OracleData[] memory) {
        return routes[_baseCurrency][_quoteCurrency];
    }

    /**
     * @notice Calculates spot price.
     *
     * @param   _baseCurrency   The base currency symbol.
     * @param   _quoteCurrency  The quote currency symbol.
     */
    function getSpotPrice(bytes32 _baseCurrency, bytes32 _quoteCurrency) external view returns (int128, uint256) {
        return _getSpotPrice(_baseCurrency, _quoteCurrency);
    }

    function _getSpotPrice(bytes32 _baseCurrency, bytes32 _quoteCurrency) internal view returns (int128, uint256) {
        OracleData[] storage routeOracles = routes[_baseCurrency][_quoteCurrency];
        uint256 length = routeOracles.length;
        bool isInverse;
        if (length == 0) {
            routeOracles = routes[_quoteCurrency][_baseCurrency];
            length = routeOracles.length;
            require(length > 0, "route not found");
            isInverse = true;
        }

        int128 price = ONE_64x64;
        int128 oraclePrice;
        uint256 oracleTime;
        for (uint256 i = 0; i < length; i++) {
            OracleData storage oracleData = routeOracles[i];
            (oraclePrice, oracleTime) = ISpotOracle(oracleData.oracle).getSpotPrice();
            if (!oracleData.isInverse) {
                price = price.mul(oraclePrice);
            } else {
                price = price.div(oraclePrice);
            }
        }
        if (isInverse) {
            price = ONE_64x64.div(price);
        }
        return (price, oracleTime);
    }
}
