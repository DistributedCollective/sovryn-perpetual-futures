// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../interface/ISpotOracle.sol";

contract OracleInterfaceID {
    function _getOracleInterfaceID() internal pure returns (bytes4) {
        ISpotOracle i;
        return i.isMarketClosed.selector ^ i.isTerminated.selector ^ i.getSpotPrice.selector ^ i.getBaseCurrency.selector ^ i.getQuoteCurrency.selector;
    }
}
