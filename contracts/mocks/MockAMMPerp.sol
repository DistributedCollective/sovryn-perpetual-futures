// SPDX-License-Identifier: MIT

/*
    Testing contract for AMMPerp.sol
*/

pragma solidity 0.8.13;

import "../libraries/ABDKMath64x64.sol";
import "../perpetual/functions/AMMPerpLogic.sol";

contract MockAMMPerp is AMMPerpLogic {
    using ABDKMath64x64 for int128;

    function mockCalculateRiskNeutralDDNoQuanto(
        int128 _fIndexPriceS2,
        int128 _fIndexPriceS3,
        int128 _fLockedValue1,
        int128 _fPoolM1,
        int128 _fPoolM2,
        int128 _fPoolM3,
        int128 _fSigma2,
        int128 _fSigma3,
        int128 _fRho23,
        int128 _fAMM_K2
    ) external view returns (int128) {
        AMMPerpLogic.AMMVariables memory ammVars;
        AMMPerpLogic.MarketVariables memory mktVars;
        (ammVars, mktVars) = _createStructs(
            _fIndexPriceS2,
            _fIndexPriceS3,
            _fLockedValue1,
            _fPoolM1,
            _fPoolM2,
            _fPoolM3,
            _fSigma2,
            _fSigma3,
            _fRho23,
            _fAMM_K2
        );
        // -L1 - k*s2 - M1
        int128 fNominator = (ammVars.fLockedValue1.neg()).sub(ammVars.fPoolM1);
        // s2*(M2-k2-K2)
        int128 fDenominator = (ammVars.fPoolM2.sub(ammVars.fAMM_K2)).mul(mktVars.fIndexPriceS2);
        int128 fSign = fDenominator < 0 ? ONE_64x64.neg() : ONE_64x64;
        int128 fThresh = fNominator.div(fDenominator);
        return _calculateRiskNeutralDDNoQuanto(_fSigma2, fSign, fThresh);
    }

    function mockCalculateRiskNeutralDDWithQuanto(
        int128 _fIndexPriceS2,
        int128 _fIndexPriceS3,
        int128 _fLockedValue1,
        int128 _fPoolM1,
        int128 _fPoolM2,
        int128 _fPoolM3,
        int128 _fSigma2,
        int128 _fSigma3,
        int128 _fRho23,
        int128 _fAMM_K2
    ) external pure returns (int128) {
        AMMPerpLogic.AMMVariables memory ammVars;
        AMMPerpLogic.MarketVariables memory mktVars;
        (ammVars, mktVars) = _createStructs(
            _fIndexPriceS2,
            _fIndexPriceS3,
            _fLockedValue1,
            _fPoolM1,
            _fPoolM2,
            _fPoolM3,
            _fSigma2,
            _fSigma3,
            _fRho23,
            _fAMM_K2
        );
        // -L1 - k*s2 - M1
        int128 fNominator = (ammVars.fLockedValue1.neg()).sub(ammVars.fPoolM1);
        // s3*M3
        int128 fDenominator = ammVars.fPoolM3.mul(mktVars.fIndexPriceS3);
        int128 fSign = ONE_64x64;
        int128 fThresh = fNominator.div(fDenominator);
        int128 dd = _calculateRiskNeutralDDWithQuanto(ammVars, mktVars, fSign, fThresh);
        return dd;
    }

    function mockCalculateDefaultFundSize(
        int128[2] memory _fK2AMM,
        int128 _fk2Trader,
        int128 _fCoverN,
        int128[2] memory fStressRet2,
        int128[2] memory fStressRet3,
        int128[2] memory fIndexPrices,
        int256 iCollateralIdx
    ) public view returns (int128) {
        AMMPerpLogic.CollateralCurrency eCCY;
        if (iCollateralIdx == 1) {
            eCCY = AMMPerpLogic.CollateralCurrency.QUOTE;
        } else if (iCollateralIdx == 2) {
            eCCY = AMMPerpLogic.CollateralCurrency.BASE;
        } else {
            eCCY = AMMPerpLogic.CollateralCurrency.QUANTO;
        }
        return this.calculateDefaultFundSize(_fK2AMM, _fk2Trader, _fCoverN, fStressRet2, fStressRet3, fIndexPrices, eCCY);
    }

    function mockCalculateRiskNeutralPD(
        int128 _fIndexPriceS2,
        int128 _fIndexPriceS3,
        int128 _fLockedValue1,
        int128 _fPoolM1,
        int128 _fPoolM2,
        int128 _fPoolM3,
        int128 _fSigma2,
        int128 _fSigma3,
        int128 _fRho23,
        int128 _fAMM_K2,
        int128 _fTradeAmount
    ) external view returns (int128) {
        AMMPerpLogic.AMMVariables memory ammVars;
        AMMPerpLogic.MarketVariables memory mktVars;
        (ammVars, mktVars) = _createStructs(
            _fIndexPriceS2,
            _fIndexPriceS3,
            _fLockedValue1,
            _fPoolM1,
            _fPoolM2,
            _fPoolM3,
            _fSigma2,
            _fSigma3,
            _fRho23,
            _fAMM_K2
        );

        int128 pd;
        int128 dd;
        (pd, dd) = this.calculateRiskNeutralPD(ammVars, mktVars, _fTradeAmount, true);
        return pd;
    }

    function mockCalculatePerpetualPrice(
        int128 _fIndexPriceS2,
        int128 _fIndexPriceS3,
        int128 _fLockedValue1,
        int128 _fPoolM1,
        int128 _fPoolM2,
        int128 _fPoolM3,
        int128 _fSigma2,
        int128 _fSigma3,
        int128 _fRho23,
        int128 _fAMM_K2,
        int128 _fMinimalSpread,
        int128 _fTradeSize
    ) external view returns (int128) {
        AMMPerpLogic.AMMVariables memory ammVars;
        AMMPerpLogic.MarketVariables memory mktVars;
        (ammVars, mktVars) = _createStructs(
            _fIndexPriceS2,
            _fIndexPriceS3,
            _fLockedValue1,
            _fPoolM1,
            _fPoolM2,
            _fPoolM3,
            _fSigma2,
            _fSigma3,
            _fRho23,
            _fAMM_K2
        );
        int128 fPrice;
        fPrice = this.calculatePerpetualPrice(ammVars, mktVars, _fTradeSize, _fMinimalSpread);
        return fPrice;
    }

    function mockCalculateStandardDeviationQuanto(
        int128 _fIndexPriceS2,
        int128 _fIndexPriceS3,
        int128 _fLockedValue1,
        int128 _fPoolM1,
        int128 _fPoolM2,
        int128 _fPoolM3,
        int128 _fSigma2,
        int128 _fSigma3,
        int128 _fRho23,
        int128 _fAMM_K2
    )
        external
        view
        returns (
            int128,
            int128,
            int128
        )
    {
        AMMPerpLogic.AMMVariables memory ammVars;
        AMMPerpLogic.MarketVariables memory mktVars;
        (ammVars, mktVars) = _createStructs(
            _fIndexPriceS2,
            _fIndexPriceS3,
            _fLockedValue1,
            _fPoolM1,
            _fPoolM2,
            _fPoolM3,
            _fSigma2,
            _fSigma3,
            _fRho23,
            _fAMM_K2
        );
        /* log inputs:
         */
        int128 fNumerator = mktVars.fIndexPriceS2.mul(ABDKMath64x64.sub(ammVars.fPoolM2, ammVars.fAMM_K2));
        // M3*s3/denom
        int128 fC3 = fNumerator.div(ammVars.fPoolM3.mul(mktVars.fIndexPriceS3));
        int128 fC3_2 = fC3.mul(fC3);

        int128 fVarB1 = (mktVars.fSigma2.mul(mktVars.fSigma3).mul(mktVars.fRho23)).exp();
        int128 fVarB = (ABDKMath64x64.sub(fVarB1, ONE_64x64)).mul(TWO_64x64);

        int128 sd = _calculateStandardDeviationQuanto(mktVars, fC3, fC3_2);
        return (sd, fVarB, fC3);
    }

    function _createStructs(
        int128 _fIndexPriceS2,
        int128 _fIndexPriceS3,
        int128 _fLockedValue1,
        int128 _fPoolM1,
        int128 _fPoolM2,
        int128 _fPoolM3,
        int128 _fSigma2,
        int128 _fSigma3,
        int128 _fRho23,
        int128 _fAMM_K2
    ) internal pure returns (AMMPerpLogic.AMMVariables memory, AMMPerpLogic.MarketVariables memory) {
        AMMPerpLogic.AMMVariables memory ammVars;
        AMMPerpLogic.MarketVariables memory mktVars;
        mktVars.fIndexPriceS2 = _fIndexPriceS2; // base index
        mktVars.fIndexPriceS3 = _fIndexPriceS3; // quanto index
        ammVars.fLockedValue1 = _fLockedValue1; // L1 in quote currency
        ammVars.fPoolM1 = _fPoolM1; // M1 in quote currency
        ammVars.fPoolM2 = _fPoolM2; // M2 in base currency
        ammVars.fPoolM3 = _fPoolM3; // M3 in quanto currency
        mktVars.fSigma2 = _fSigma2; // standard dev of base currency
        mktVars.fSigma3 = _fSigma3; // standard dev of quanto currency
        mktVars.fRho23 = _fRho23; // correlation base/quanto currency
        ammVars.fAMM_K2 = _fAMM_K2; // AMM exposure (positive if trader long)
        return (ammVars, mktVars);
    }

    function mockNormalCDF(int128 _fX) external view returns (int128) {
        int128 fProb = _normalCDF(_fX);
        return fProb;
    }

    function mockGetTargetCollateralM1(
        int128 _fK2,
        int128 _fS2,
        int128 _fL1,
        int128 _fSigma2,
        int128 _fTargetDD
    ) external view returns (int128) {
        AMMPerpLogic.MarketVariables memory mv;
        mv.fIndexPriceS2 = _fS2;
        mv.fSigma2 = _fSigma2;
        return this.getTargetCollateralM1(_fK2, _fL1, mv, _fTargetDD);
    }

    function mockGetTargetCollateralM2(
        int128 _fK2,
        int128 _fS2,
        int128 _fL1,
        int128 _fSigma2,
        int128 _fTargetDD
    ) external view returns (int128) {
        int128 M2;
        AMMPerpLogic.MarketVariables memory mv;
        mv.fIndexPriceS2 = _fS2;
        mv.fSigma2 = _fSigma2;
        M2 = this.getTargetCollateralM2(_fK2, _fL1, mv, _fTargetDD);
        return M2;
    }

    function mockGetTargetCollateralM3(
        int128 _fK2,
        int128 _fS2,
        int128 _fS3,
        int128 _fL1,
        int128 _fSigma2,
        int128 _fSigma3,
        int128 _fRho23,
        int128 _fTargetDD
    ) external view returns (int128) {
        AMMPerpLogic.MarketVariables memory mv;
        mv.fIndexPriceS2 = _fS2;
        mv.fIndexPriceS3 = _fS3;
        mv.fSigma2 = _fSigma2;
        mv.fSigma3 = _fSigma3;
        mv.fRho23 = _fRho23;
        int128 Mstar;
        Mstar = this.getTargetCollateralM3(_fK2, _fL1, mv, _fTargetDD);

        return Mstar;
    }
}
