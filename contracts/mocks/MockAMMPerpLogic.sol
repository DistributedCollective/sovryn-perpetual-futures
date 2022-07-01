// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/functions/AMMPerpLogic.sol";

contract MockAMMPerpLogic is AMMPerpLogic {
    function ema(
        int128 _fEMA,
        int128 _fCurrentObs,
        int128 _fLambda
    ) external pure override returns (int128) {
        return ONE_64x64;
    }

    function calculateRiskNeutralPD(
        AMMPerpLogic.AMMVariables memory _ammVars,
        AMMPerpLogic.MarketVariables calldata _mktVars,
        int128 _fTradeAmount,
        bool _withCDF
    ) external view override returns (int128, int128) {
        return (ONE_64x64, ONE_64x64);
    }

    function calculatePerpetualPrice(
        AMMPerpLogic.AMMVariables calldata _ammVars,
        AMMPerpLogic.MarketVariables calldata _mktVars,
        int128 _fTradeDir,
        int128 _fMinimalSpread
    ) external pure override returns (int128) {
        return ONE_64x64;
    }

    function getTargetCollateralM1(
        int128 _fK2,
        int128 _fL1,
        AMMPerpLogic.MarketVariables calldata _mktVars,
        int128 _fTargetDD
    ) external pure override returns (int128) {
        return ONE_64x64;
    }

    function getTargetCollateralM2(
        int128 _fK2,
        int128 _fL1,
        AMMPerpLogic.MarketVariables calldata _mktVars,
        int128 _fTargetDD
    ) external pure override returns (int128) {
        return ONE_64x64;
    }
}
