// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IPerpetualLiquidator {
    function liquidateByAMM(
        bytes32 _perpetualIndex,
        address _liquidatorAddr,
        address _traderAddr
    ) external returns (int128 liquidatedAmount);
}
