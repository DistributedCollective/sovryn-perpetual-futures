// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import "../../oracle/OracleInterfaceID.sol";
import "./../functions/PerpetualUpdateFunctions.sol";
import "./../interfaces/IPerpetualFactory.sol";
import "./../interfaces/IFunctionList.sol";
import "../../libraries/Utils.sol";

contract PerpetualFactory is PerpetualUpdateFunctions, OracleInterfaceID, IFunctionList, IPerpetualFactory {
    using ABDKMath64x64 for int128;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
    using ERC165Checker for address;

    /**
     * @notice  Create new perpetual of the liquidity pool.
     *
     * @param   _iPoolId                The pool id.
     * @param   _oracles                The oracles' addresses of the perpetual.
     * @param   _baseParams             The base parameters of the perpetual.
     * @param   _underlyingRiskParams   The risk parameters for underlying instruments.
     * @param   _defaultFundRiskParams  The risk parameters for default fund / AMM pool.
     */
    function createPerpetual(
        uint16 _iPoolId,
        address[2] calldata _oracles,
        int128[11] calldata _baseParams,
        int128[5] calldata _underlyingRiskParams,
        int128[13] calldata _defaultFundRiskParams,
        uint256 _eCollateralCurrency
    ) external virtual override onlyOwner {
        _createPerpetual(_iPoolId, _oracles, _baseParams, _underlyingRiskParams, _defaultFundRiskParams, _eCollateralCurrency);
    }

    function setEmergencyState(bytes32 _iPerpetualId) external override onlyOwner {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _setEmergencyState(perpetual);
    }

    function setPerpetualOracles(bytes32 _iPerpetualId, address[2] calldata _oracles) external override onlyOwner {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _validateOracles(_oracles, uint256(perpetual.eCollateralCurrency));
        _setOracles(perpetual, _oracles);
        emit SetOracles(_iPerpetualId, _oracles);
    }

    function setPerpetualBaseParams(bytes32 _iPerpetualId, int128[11] calldata _baseParams) external override onlyOwner {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _validateBaseParams(_baseParams);
        _setBaseParams(perpetual, _baseParams);
        emit SetPerpetualBaseParameters(_iPerpetualId, _baseParams);
    }

    function setPerpetualRiskParams(
        bytes32 _iPerpetualId,
        int128[5] calldata _underlyingRiskParams,
        int128[13] calldata _defaultFundRiskParams
    ) external override onlyOwner {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        _validateUnderlyingRiskParams(_underlyingRiskParams, uint256(perpetual.eCollateralCurrency));
        _validateDefaultFundRiskParams(_defaultFundRiskParams, uint256(perpetual.eCollateralCurrency));
        _setUnderlyingRiskParams(perpetual, _underlyingRiskParams);
        _setDefaultFundRiskParams(perpetual, _defaultFundRiskParams);
        emit SetPerpetualRiskParameters(_iPerpetualId, _underlyingRiskParams, _defaultFundRiskParams);
    }

    function _createPerpetual(
        uint16 _iPoolId,
        address[2] calldata _oracles,
        int128[11] calldata _baseParams,
        int128[5] calldata _underlyingRiskParams,
        int128[13] calldata _defaultFundRiskParams,
        uint256 _eCollateralCurrency
    ) internal {
        require(_iPoolId > 0 && _iPoolId <= iPoolCount, "liquidity pool not found");
        require(_eCollateralCurrency <= uint256(AMMPerpLogic.CollateralCurrency.QUANTO), "invalid eCollateralCurrency");
        LiquidityPoolData storage pool = liquidityPools[_iPoolId];

        _validateOracles(_oracles, _eCollateralCurrency);
        _validateBaseParams(_baseParams);
        _validateUnderlyingRiskParams(_underlyingRiskParams, _eCollateralCurrency);
        _validateDefaultFundRiskParams(_defaultFundRiskParams, _eCollateralCurrency);

        //id, base data
        uint256 iPerpetualIndex = pool.iPerpetualCount++;
        bytes32 perpetualId = keccak256(abi.encodePacked(_iPoolId, iPerpetualIndex));
        perpetualIds[pool.id].push(perpetualId);
        PerpetualData storage perpetual = perpetuals[pool.id][perpetualId];
        perpetual.id = perpetualId;
        perpetual.poolId = _iPoolId;
        perpetualPoolIds[perpetualId] = _iPoolId;

        _setOracles(perpetual, _oracles);
        _setBaseParams(perpetual, _baseParams);
        // risk parameters for underlying instruments
        _setUnderlyingRiskParams(perpetual, _underlyingRiskParams);
        // risk parameters for default fund / AMM pool
        _setDefaultFundRiskParams(perpetual, _defaultFundRiskParams);

        // collateral currency (quote, base, quanto)
        perpetual.eCollateralCurrency = AMMPerpLogic.CollateralCurrency(_eCollateralCurrency);

        // initialize current trader exposure with the minimal value:
        perpetual.fCurrentTraderExposureEMA = _defaultFundRiskParams[10];
        // same for AMM
        perpetual.fCurrentAMMExposureEMA[0] = _defaultFundRiskParams[11].neg(); //= -fMinimalAMMExposureEMA
        perpetual.fCurrentAMMExposureEMA[1] = _defaultFundRiskParams[11]; //= fMinimalAMMExposureEMA

        perpetual.state = PerpetualState.INVALID;
        emit PerpetualCreated(pool.id, perpetualId, _oracles, _baseParams, _underlyingRiskParams, _defaultFundRiskParams, _eCollateralCurrency);
    }

    function _validateOracles(address[2] calldata _oracles, uint256 _eCollateralCurrency) internal view {
        require(_oracles[0] != address(this) && _oracles[0] != address(0), "invalid oracleS2Addr");
        require(_oracles[0].supportsInterface(_getOracleInterfaceID()), "invalid oracle oracleS2Addr");
        require(
            _oracles[1] != address(this) &&
                _oracles[1] != _oracles[0] &&
                (_oracles[1] != address(0) || _eCollateralCurrency != uint256(AMMPerpLogic.CollateralCurrency.QUANTO)),
            "invalid oracleS3Addr"
        );
        if (_oracles[1] != address(0)) {
            require(_oracles[1].supportsInterface(_getOracleInterfaceID()), "invalid oracle oracleS3Addr");
        }
    }

    function _validateBaseParams(int128[11] calldata _baseParams) internal pure {
        require(_baseParams[0] < ONE_64x64, "invalid fInitialMarginRateAlpha");
        require(_baseParams[1] > 0 && _baseParams[1] <= ONE_64x64, "invalid fMarginRateBeta");
        require(_baseParams[2] > 0 && _baseParams[2] < _baseParams[0], "fMaintenanceMarginRateAlpha must be < fInitialMarginRateAlpha and positive");
        require(_baseParams[3] > 0 && _baseParams[3] < ONE_64x64, "fInitialMarginRateCap must be > 0 and <1");
        require(_baseParams[4] > 0 && _baseParams[4] < ONE_64x64 >> 3, "invalid fTreasuryFeeRate");
        require(_baseParams[5] > 0 && _baseParams[5] < ONE_64x64 >> 3, "invalid fPnLPartRate");
        require(_baseParams[6] >= 0, "invalid fReferralRebateCC");
        require(_baseParams[7] > 0 && _baseParams[7] < ONE_64x64 >> 3, "invalid fLiquidationPenaltyRate");
        require(_baseParams[8] >= 0 && _baseParams[8] < ONE_64x64 >> 3, "invalid fMinimalSpread");
        require(_baseParams[9] >= 0 && _baseParams[9] < ONE_64x64 >> 3 && _baseParams[8] <= _baseParams[9], "invalid fMinimalSpreadInStress");
        require(_baseParams[10] > 0, "invalid fLotSizeBC");
    }

    function _validateUnderlyingRiskParams(int128[5] calldata _underlyingRiskParams, uint256 _eCollateralCurrency) internal pure {
        bool isQuanto = _eCollateralCurrency == uint256(AMMPerpLogic.CollateralCurrency.QUANTO);
        /*require(
            _underlyingRiskParams[0] > 0 && _underlyingRiskParams[0] < _baseParams[0] && _underlyingRiskParams[0] < _baseParams[1],
            "invalid fFundingRateClamp"
        );*/
        require(_underlyingRiskParams[0] > 0 && _underlyingRiskParams[0] < ONE_64x64 >> 5, "invalid fFundingRateClamp");
        require(_underlyingRiskParams[1] > 0 && _underlyingRiskParams[1] < ONE_64x64, "invalid fMarkPriceEMALambda");
        require(_underlyingRiskParams[2] > 0 && _underlyingRiskParams[2] < ONE_64x64, "invalid fSigma2");
        require(!isQuanto || (_underlyingRiskParams[3] > 0 && _underlyingRiskParams[3] < ONE_64x64), "invalid fSigma3");
        require(!isQuanto || (_underlyingRiskParams[4] > ONE_64x64.neg() && _underlyingRiskParams[4] < ONE_64x64), "invalid fRho23");
    }

    function _validateDefaultFundRiskParams(int128[13] calldata _defaultFundRiskParams, uint256 _eCollateralCurrency) internal pure {
        bool isQuanto = _eCollateralCurrency == uint256(AMMPerpLogic.CollateralCurrency.QUANTO);
        require(_defaultFundRiskParams[0] > (ONE_64x64).neg() && _defaultFundRiskParams[0] < 0, "invalid fStressReturnS2[0]");
        require(_defaultFundRiskParams[1] > 0 && _defaultFundRiskParams[1] < ONE_64x64, "invalid fStressReturnS2[1]");
        require(!isQuanto || (_defaultFundRiskParams[2] > (ONE_64x64).neg() && _defaultFundRiskParams[2] < 0), "invalid fStressReturnS3[0]");
        require(!isQuanto || (_defaultFundRiskParams[3] > (ONE_64x64).neg() && _defaultFundRiskParams[3] < ONE_64x64), "invalid fStressReturnS3[1]");
        require(_defaultFundRiskParams[4] > 0 && _defaultFundRiskParams[4] < ONE_64x64, "invalid fDFCoverNRate");
        require(_defaultFundRiskParams[5] > 0 && _defaultFundRiskParams[5] < ONE_64x64, "invalid fDFLambda[0]");
        require(_defaultFundRiskParams[6] > 0 && _defaultFundRiskParams[6] < ONE_64x64, "invalid fDFLambda[1]");
        require(_defaultFundRiskParams[7] > (ONE_64x64 << 2).neg() && _defaultFundRiskParams[7] < (ONE_64x64).neg(), "invalid fAMMTargetDD");
        require(_defaultFundRiskParams[8] > (ONE_64x64 << 2).neg() && _defaultFundRiskParams[7] < (ONE_64x64).neg(), "invalid fAMMTargetDD");
        require(_defaultFundRiskParams[7] < _defaultFundRiskParams[8], "baseline fAMMTargetDD[0] must < stress fAMMTargetDD[1]");
        require(_defaultFundRiskParams[9] > 0, "minimal AMM size must be positive");
        require(_defaultFundRiskParams[10] > 0, "minimal trader exposure EMA must be positive");
        require(_defaultFundRiskParams[11] > 0, "minimal AMM exposure EMA must be positive");
        require(_defaultFundRiskParams[12] > ONE_64x64, "maximal trade size bump up must be >1");
    }

    /**
     * @dev     Sets new oracle addresses and sets the current oracle price to that value.
     *
     * @param   _perpetual The perpetual in the liquidity pool
     * @param   _oracles Array of the S2 oracle and S3 oracle addresses in that order.
     */
    function _setOracles(PerpetualData storage _perpetual, address[2] calldata _oracles) internal {
        _perpetual.oracleS2Addr = _oracles[0];
        _perpetual.oracleS3Addr = _oracles[1];
        if (_oracles[0] != address(0)) {
            ISpotOracle oracle0 = ISpotOracle(_oracles[0]);
            _updateOraclePriceData(oraclePriceData[_oracles[0]], oracle0.getSpotPrice);
        }
        if (_oracles[1] != address(0)) {
            ISpotOracle oracle1 = ISpotOracle(_oracles[1]);
            _updateOraclePriceData(oraclePriceData[_oracles[1]], oracle1.getSpotPrice);
        }
    }

    function _setBaseParams(PerpetualData storage _perpetual, int128[11] calldata _baseParams) internal {
        _perpetual.fInitialMarginRateAlpha = _baseParams[0];
        _perpetual.fMarginRateBeta = _baseParams[1];
        _perpetual.fMaintenanceMarginRateAlpha = _baseParams[2];
        _perpetual.fInitialMarginRateCap = _baseParams[3];
        _perpetual.fTreasuryFeeRate = _baseParams[4];
        _perpetual.fPnLPartRate = _baseParams[5];
        _perpetual.fReferralRebateCC = _baseParams[6];
        _perpetual.fLiquidationPenaltyRate = _baseParams[7];
        _perpetual.fMinimalSpread = _baseParams[8];
        _perpetual.fMinimalSpreadInStress = _baseParams[9];
        _perpetual.fLotSizeBC = _baseParams[10];
    }

    function _setUnderlyingRiskParams(PerpetualData storage _perpetual, int128[5] calldata _underlyingRiskParams) internal {
        _perpetual.fFundingRateClamp = _underlyingRiskParams[0];
        _perpetual.fMarkPriceEMALambda = _underlyingRiskParams[1];
        _perpetual.fSigma2 = _underlyingRiskParams[2];
        _perpetual.fSigma3 = _underlyingRiskParams[3];
        _perpetual.fRho23 = _underlyingRiskParams[4];
    }

    function _setDefaultFundRiskParams(PerpetualData storage _perpetual, int128[13] calldata _defaultFundRiskParams) internal {
        _perpetual.fStressReturnS2[0] = _defaultFundRiskParams[0];
        _perpetual.fStressReturnS2[1] = _defaultFundRiskParams[1];
        _perpetual.fStressReturnS3[0] = _defaultFundRiskParams[2];
        _perpetual.fStressReturnS3[1] = _defaultFundRiskParams[3];
        _perpetual.fDFCoverNRate = _defaultFundRiskParams[4];
        _perpetual.fDFLambda[0] = _defaultFundRiskParams[5];
        _perpetual.fDFLambda[1] = _defaultFundRiskParams[6];
        _perpetual.fAMMTargetDD[0] = _defaultFundRiskParams[7];
        _perpetual.fAMMTargetDD[1] = _defaultFundRiskParams[8];
        _perpetual.fAMMMinSizeCC = _defaultFundRiskParams[9];
        _perpetual.fMinimalTraderExposureEMA = _defaultFundRiskParams[10];
        _perpetual.fMinimalAMMExposureEMA = _defaultFundRiskParams[11];
        _perpetual.fMaximalTradeSizeBumpUp = _defaultFundRiskParams[12];
    }

    /**
     * Once a perpetual has been created and it was funded,
     * we can activate the perpetual in its liquidity pool via this function.
     * @param _perpetualId   Id that points to the perpetual.
     */
    function activatePerpetual(bytes32 _perpetualId) external override onlyOwner {
        _activatePerpetual(_perpetualId);
    }

    /**
     * Internal function for activatePerpetual
     * @param _perpetualId   Id that points to the perpetual.
     */
    function _activatePerpetual(bytes32 _perpetualId) internal {
        PerpetualData storage perpetual = _getPerpetual(_perpetualId);
        LiquidityPoolData storage pool = liquidityPools[perpetual.poolId];
        require(perpetual.fAMMFundCashCC > 0, "perpetual needs AMM cash to run");
        require(perpetual.state == PerpetualState.INVALID || perpetual.state == PerpetualState.CLEARED, "perpetual needs to be in invalid state");

        // if pool already running: invalid -> normal and we need to add pool cash
        if (pool.isRunning) {
            // add the perpetuals cash to total cash
            pool.fAMMFundCashCC = pool.fAMMFundCashCC.add(perpetual.fAMMFundCashCC);
            // set starting value for AMM and DF target Pool sizes
            int128 fMinTarget = perpetual.fAMMMinSizeCC;
            perpetual.fTargetAMMFundSize = fMinTarget;
            perpetual.fTargetDFSize = fMinTarget;
            pool.fTargetDFSize = pool.fTargetDFSize.add(fMinTarget);
            pool.fTargetAMMFundSize = pool.fTargetAMMFundSize.add(fMinTarget);
            // ready to set normal state
            _setNormalState(perpetual);
        } else {
            perpetual.state = PerpetualState.INITIALIZING;
        }
    }

    function setPerpetualParam(
        bytes32 _iPerpetualId,
        string memory _name,
        int128 _value
    ) external override onlyOwner {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        if (_isStringEqual(_name, "fInitialMarginRateAlpha")) {
            require(_value < ONE_64x64, "invalid fInitialMarginRateAlpha");
            perpetual.fInitialMarginRateAlpha = _value;
        } else if (_isStringEqual(_name, "fMarginRateBeta")) {
            require(_value > 0 && _value <= ONE_64x64, "invalid fMarginRateBeta");
            perpetual.fMarginRateBeta = _value;
        } else if (_isStringEqual(_name, "fInitialMarginRateCap")) {
            require(_value > 0 && _value < ONE_64x64, "fInitialMarginRateCap must be > 0 and <1");
            perpetual.fInitialMarginRateCap = _value;
        } else if (_isStringEqual(_name, "fMaintenanceMarginRateAlpha")) {
            require(_value > 0 && _value < perpetual.fInitialMarginRateAlpha, "fMaintenanceMarginRateAlpha must be < fInitialMarginRateAlpha and positive");
            perpetual.fMaintenanceMarginRateAlpha = _value;
        } else if (_isStringEqual(_name, "fTreasuryFeeRate")) {
            require(_value > 0 && _value < ONE_64x64 >> 3, "invalid fTreasuryFeeRate");
            perpetual.fTreasuryFeeRate = _value;
        } else if (_isStringEqual(_name, "fPnLPartRate")) {
            require(_value > 0 && _value < ONE_64x64 >> 3, "invalid fPnLPartRate");
            perpetual.fPnLPartRate = _value;
        } else if (_isStringEqual(_name, "fReferralRebateCC")) {
            require(_value > 0, "invalid fReferralRebateCC");
            perpetual.fReferralRebateCC = _value;
        } else if (_isStringEqual(_name, "fLiquidationPenaltyRate")) {
            require(_value > 0 && _value < ONE_64x64 >> 3, "invalid fLiquidationPenaltyRate");
            perpetual.fLiquidationPenaltyRate = _value;
        } else if (_isStringEqual(_name, "fMinimalSpread")) {
            require(_value >= 0 && _value < ONE_64x64 >> 3, "invalid fMinimalSpread");
            perpetual.fMinimalSpread = _value;
        } else if (_isStringEqual(_name, "fMinimalSpreadInStress")) {
            require(_value >= 0 && _value < ONE_64x64 >> 3, "invalid fMinimalSpreadInStress");
            perpetual.fMinimalSpreadInStress = _value;
        } else if (_isStringEqual(_name, "fLotSizeBC")) {
            require(_value > 0, "invalid fLotSizeBC");
            perpetual.fLotSizeBC = _value;
        } else if (_isStringEqual(_name, "fFundingRateClamp")) {
            require(_value > 0 && _value < ONE_64x64 >> 5, "invalid fFundingRateClamp");
            perpetual.fFundingRateClamp = _value;
        } else if (_isStringEqual(_name, "fMarkPriceEMALambda")) {
            require(_value > 0 && _value < ONE_64x64, "invalid fMarkPriceEMALambda");
            perpetual.fMarkPriceEMALambda = _value;
        } else if (_isStringEqual(_name, "fSigma2")) {
            require(_value > 0 && _value < ONE_64x64, "invalid fSigma2");
            perpetual.fSigma2 = _value;
        } else if (_isStringEqual(_name, "fSigma3")) {
            require(_value > 0 && _value < ONE_64x64, "invalid fSigma3");
            perpetual.fSigma3 = _value;
        } else if (_isStringEqual(_name, "fRho23")) {
            require(_value > ONE_64x64.neg() && _value < ONE_64x64, "invalid fRho23");
            perpetual.fRho23 = _value;
        } else if (_isStringEqual(_name, "fDFCoverNRate")) {
            require(_value > 0 && _value < ONE_64x64, "invalid fDFCoverNRate");
            perpetual.fDFCoverNRate = _value;
        } else if (_isStringEqual(_name, "fAMMMinSizeCC")) {
            require(_value > 0, "minimal AMM size must be positive");
            perpetual.fAMMMinSizeCC = _value;
        } else if (_isStringEqual(_name, "fMinimalTraderExposureEMA")) {
            require(_value > 0, "minimal trader exposure EMA must be positive");
            perpetual.fMinimalTraderExposureEMA = _value;
        } else if (_isStringEqual(_name, "fMinimalAMMExposureEMA")) {
            require(_value > 0, "minimal AMM exposure EMA must be positive");
            perpetual.fMinimalAMMExposureEMA = _value;
        } else if (_isStringEqual(_name, "fMaximalTradeSizeBumpUp")) {
            require(_value > ONE_64x64, "maximal trade size bump up must be >1");
            perpetual.fMaximalTradeSizeBumpUp = _value;
        } else if (_isStringEqual(_name, "fMaxTotalTraderFunds")) {
            // fMaxTotalTraderFunds > 0 if active, < 0 if inactive
            require(_value != 0, "fMaxTotalTraderFunds cannot be zero");
            LiquidityPoolData storage pool =_getLiquidityPoolFromPerpetual(_iPerpetualId);
            pool.fMaxTotalTraderFunds = _value;
        } else {
            revert("parameter not found");
        }
        emit SetParameter(_iPerpetualId, _name, _value);
    }

    function setPerpetualParamPair(
        bytes32 _iPerpetualId,
        string memory _name,
        int128 _value1,
        int128 _value2
    ) external override onlyOwner {
        PerpetualData storage perpetual = _getPerpetual(_iPerpetualId);
        if (_isStringEqual(_name, "fStressReturnS2")) {
            require(_value1 > (ONE_64x64).neg() && _value1 < 0, "invalid fStressReturnS2[0]");
            require(_value2 > 0 && _value2 < ONE_64x64, "invalid fStressReturnS2[1]");
            perpetual.fStressReturnS2[0] = _value1;
            perpetual.fStressReturnS2[1] = _value2;
        } else if (_isStringEqual(_name, "fStressReturnS3")) {
            require(_value1 > (ONE_64x64).neg() && _value1 < 0, "invalid fStressReturnS3[0]");
            require(_value2 > ONE_64x64.neg() && _value2 < ONE_64x64, "invalid fStressReturnS3[1]");
            perpetual.fStressReturnS3[0] = _value1;
            perpetual.fStressReturnS3[1] = _value2;
        } else if (_isStringEqual(_name, "fDFLambda")) {
            require(_value1 > 0 && _value1 < ONE_64x64, "invalid fDFLambda[0]");
            require(_value2 > 0 && _value2 < ONE_64x64, "invalid fDFLambda[1]");
            perpetual.fDFLambda[0] = _value1;
            perpetual.fDFLambda[1] = _value2;
        } else if (_isStringEqual(_name, "fCurrentAMMExposureEMA")) {
            perpetual.fCurrentAMMExposureEMA[0] = _value1;
            perpetual.fCurrentAMMExposureEMA[1] = _value2;
        } else if (_isStringEqual(_name, "fAMMTargetDD")) {
            require(_value1 > (ONE_64x64 << 2).neg() && _value1 < (ONE_64x64).neg(), "invalid fAMMTargetDD");
            require(_value2 > (ONE_64x64 << 2).neg() && _value1 < (ONE_64x64).neg(), "invalid fAMMTargetDD");
            require(_value1 < _value2, "baseline fAMMTargetDD[0] must < stress fAMMTargetDD[1]");
            perpetual.fAMMTargetDD[0] = _value1;
            perpetual.fAMMTargetDD[1] = _value2;
        } else {
            revert("parameter not found");
        }
        emit SetParameterPair(_iPerpetualId, _name, _value1, _value2);
    }

    function _isStringEqual(string memory _a, string memory _b) internal pure returns (bool) {
        return (bytes(_a).length == bytes(_b).length) && (keccak256(bytes(_a)) == keccak256(bytes(_b)));
    }

    function getFunctionList() external pure virtual override returns (bytes4[] memory, bytes32) {
        bytes32 moduleName = Utils.stringToBytes32("PerpetualFactory");
        bytes4[] memory functionList = new bytes4[](8);
        functionList[0] = this.createPerpetual.selector;
        functionList[1] = this.activatePerpetual.selector;
        functionList[2] = this.setPerpetualOracles.selector;
        functionList[3] = this.setPerpetualBaseParams.selector;
        functionList[4] = this.setPerpetualRiskParams.selector;
        functionList[5] = this.setPerpetualParam.selector;
        functionList[6] = this.setPerpetualParamPair.selector;
        functionList[7] = this.setEmergencyState.selector;
        return (functionList, moduleName);
    }
}
