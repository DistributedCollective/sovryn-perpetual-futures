// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

library QuickSort {
    function sort(uint256[] memory _data) internal pure returns (uint256[] memory) {
        sort(_data, int256(0), int256(_data.length - 1));
        return _data;
    }

    function sort(
        uint256[] memory _data,
        int256 _start,
        int256 _end
    ) internal pure {
        int256 i = _start;
        int256 j = _end;
        if (i == j) {
            return;
        }
        uint256 pivot = _data[uint256(_start + (_end - _start) / 2)];
        while (i <= j) {
            while (_data[uint256(i)] < pivot) {
                i++;
            }
            while (pivot < _data[uint256(j)]) {
                j--;
            }
            if (i <= j) {
                (_data[uint256(i)], _data[uint256(j)]) = (_data[uint256(j)], _data[uint256(i)]);
                i++;
                j--;
            }
        }
        if (_start < j) {
            sort(_data, _start, j);
        }
        if (i < _end) {
            sort(_data, i, _end);
        }
    }
}
