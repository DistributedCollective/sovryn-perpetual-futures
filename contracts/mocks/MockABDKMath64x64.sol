// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../libraries/ConverterDec18.sol";
import "../libraries/ABDKMath64x64.sol";

contract MockABDKMath64x64 {
    function fromDec18(int256 x) external pure returns (int128) {
        return ConverterDec18.fromDec18(x);
    }

    function toDec18(int128 x) external pure returns (int256) {
        return ConverterDec18.toDec18(x);
    }

    function toUDec18(int128 x) external pure returns (uint256) {
        return ConverterDec18.toUDec18(x);
    }

    function from128x128(int256 x) external pure returns (int128) {
        return ABDKMath64x64.from128x128(x);
    }
    function to128x128(int128 x) external pure returns (int256) {
        return ABDKMath64x64.to128x128(x);
    }

    function mul(int128 x, int128 y) external view returns (int128) {
        return ABDKMath64x64.mul(x, y);
    }

    function div(int128 x, int128 y) external pure returns (int128) {
        return ABDKMath64x64.div(x,y);
    }
    
    function add(int128 x, int128 y) external pure returns (int128) {
        return ABDKMath64x64.add(x, y);
    }

    function sub(int128 x, int128 y) external pure returns (int128) {
        return ABDKMath64x64.sub(x,y);
    }

     function neg(int128 x) external pure returns (int128) {
        return ABDKMath64x64.neg(x);
    }
    function abs(int128 x) external pure returns (int128) {
        return ABDKMath64x64.abs(x);
    }
    function inv(int128 x) external pure returns (int128) {
        return ABDKMath64x64.inv(x);
    }
    function avg(int128 x, int128 y) external pure returns (int128) {
        return ABDKMath64x64.avg(x, y);
    }
    function pow(int128 x, uint256 y) external pure returns (int128) {
        return ABDKMath64x64.pow(x, y);
    }
    function gavg(int128 x, int128 y) external pure returns (int128) {
        return ABDKMath64x64.gavg(x, y);
    }

    function divu(uint256 x, uint256 y) external pure returns (int128) {
         return ABDKMath64x64.divu(x, y);
    }

    function divi(int256 x, int256 y) external pure returns (int128) {
        return ABDKMath64x64.divi(x, y);
    }
    function muli(int128 x, int256 y) external pure returns (int256) {
        return ABDKMath64x64.muli(x, y);
    }
    function mulu(int128 x, uint256 y) external pure returns (uint256) {
        return ABDKMath64x64.mulu(x, y);
    }

    function sqrt(int128 x) external pure returns (int128) {
        return ABDKMath64x64.sqrt(x);
    }

    function log_2(int128 x) external pure returns (int128) {
        return ABDKMath64x64.log_2(x);
    }
    function ln(int128 x) external pure returns (int128) {
        return ABDKMath64x64.ln(x);
    }
    function exp(int128 x) external pure returns (int128) {
        return ABDKMath64x64.exp(x);
    }
    function exp_2(int128 x) external pure returns (int128) {
        return ABDKMath64x64.exp_2(x);
    }




}
