// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/modules/PerpetualFactory.sol";

contract MockPerpetualFactory is PerpetualFactory {
    using ABDKMath64x64 for int128;

    function createPerpetual(
        uint16 _iPoolId,
        address[2] calldata _oracles,
        int128[11] calldata _baseParams,
        int128[5] calldata _underlyingRiskParams,
        int128[13] calldata _defaultFundRiskParams,
        uint256 _eCollateralCurrency
    ) external override onlyOwner {
        _createPerpetual(_iPoolId, _oracles, _baseParams, _underlyingRiskParams, _defaultFundRiskParams, _eCollateralCurrency);

        bytes32 perpetualId = perpetualIds[_iPoolId][perpetualIds[_iPoolId].length - 1];
        PerpetualData storage perpetual = _getPerpetual(perpetualId);
        // initial funding
        perpetual.fAMMFundCashCC = ONE_64x64;
        // activate in pool
        _activatePerpetual(perpetualId);
    }
}
