import numpy as np

def get_quote_to_collateral_fx(S2, S3, collateral_currency_index):
    if collateral_currency_index == 0:
        # quote
        return 1
    elif collateral_currency_index == 1:
        # base
        return 1/S2
    else:
        assert(collateral_currency_index == 2)
        # quanto
        return 1/S3


def getBase2CollateralFX(indexS2, indexS3, markPremium, collateral_currency_index, at_mark_price):
    s2 = markPremium + indexS2 if at_mark_price else indexS2
    if collateral_currency_index == 0:
        # quote
        return s2
    elif collateral_currency_index == 1:
        # base
        return s2/indexS2
    else:
        # quanto
        return s2/indexS3

def growToLot(value, lotSize):
    if value < 0:
        return np.floor(value / lotSize) * lotSize
    return np.ceil(value / lotSize) * lotSize

def calculateLiquidationAmount(S2, S3, margin_balance, targetMarginRate, maintMarginRate, traderPositionBC, liquidationFee, tradingFee, lotSize):
    if margin_balance * S3 / S2 > maintMarginRate*np.abs(traderPositionBC):
        #margin safe
        return 0
    f = (liquidationFee+tradingFee)
    # if the current margin balance does not exceed the fees, we need to liquidate the whole position
    if not (margin_balance > np.abs(traderPositionBC) * f * S2/S3):
        return traderPositionBC
    
    trade_amt = (np.abs(traderPositionBC)*targetMarginRate -  margin_balance *S3/S2) / \
        ( np.sign(traderPositionBC) * (targetMarginRate - f) )
    
    # round to lot
    trade_amt_rounded = growToLot(trade_amt, lotSize)
    # partial or full liquidation?
    if np.abs(trade_amt_rounded) >= np.abs(traderPositionBC):
        # liquidate the whole position
        trade_amt_rounded = traderPositionBC
    # careful if positive, sell!
    return trade_amt_rounded

def get_margin_balance_cc(pos, LockedInValueQC, S2, S3, markPremium, cashCC, collateral_currency_index):
    q2c = get_quote_to_collateral_fx(S2, S3, collateral_currency_index)
    return (pos*(S2+markPremium) - LockedInValueQC) * q2c + cashCC


def is_margin_safe(pos, LockedInValueQC, cashCC, S2, S3, markPremium, collateral_currency_index, marginrate):
    base2collateral = getBase2CollateralFX(S2, S3, markPremium, collateral_currency_index, False)
    M = get_margin_balance_cc(pos, LockedInValueQC, S2, S3, markPremium, cashCC, collateral_currency_index)
    return M > np.abs(pos) * marginrate * base2collateral

def grow_to_lot(position, lot):
    # test grow to lot with just integer rounding
    sgn = -1 if position<0 else 1
    ps_rounded = int(np.abs(position)/lot+1)*lot
    return sgn*ps_rounded

def liquidation_test(traderPositionBC, liquidationFee, tradingFee, lotSize, S2_0, cashCC, S2, mark_premium, mntnc_marginrate, initialMarginRate):
    S3_0 = S2_0
    S3 = S2
    L = S2_0*traderPositionBC
    Sm = S2 + mark_premium
    collateral_currency_index = 1
    b0 = get_margin_balance_cc(traderPositionBC, L, S2, S3, mark_premium, cashCC, collateral_currency_index)
    is_safe_before = is_margin_safe(traderPositionBC, L, cashCC, S2, S3, mark_premium, collateral_currency_index, mntnc_marginrate)
    liq_amt = calculateLiquidationAmount(S2, S3, b0, initialMarginRate, mntnc_marginrate, traderPositionBC, liquidationFee, tradingFee, lotSize)
    newPos = traderPositionBC - liq_amt
    newL = L - liq_amt * L/traderPositionBC 
    newCashCC = cashCC - np.abs(liq_amt)*(tradingFee+liquidationFee) + (liq_amt*Sm - L/traderPositionBC * liq_amt)/S3
    is_safe_after = is_margin_safe(newPos, newL, newCashCC, S2, S3, mark_premium, collateral_currency_index, initialMarginRate)
    b1 = get_margin_balance_cc(newPos, newL, S2, S3, mark_premium, newCashCC, collateral_currency_index)
    required_balance = np.abs(newPos) * initialMarginRate
    print("save before =", is_safe_before)
    print("margin balance before = ",b0)
    print("liq_amt = ", liq_amt)
    print("margin balance = ", b1)
    print("required margin balance = ",required_balance)
    assert(required_balance <= b1)


if __name__ == "__main__":
    #
    # after liquidation:
    # newpos * b2c * marginrate = margin_cc - |oldpos - newpos| * b2c * feerate
    # liquidation trade:
    #   pos := pos - deltapos
    #   L   := L - deltapos*Markprice
    #   cash := cash - fees
    traderPositionBC = -1
    liquidationFee = 0.05
    tradingFee = 0.0008
    lotSize = 0.0002
    S2_0 = 35000
    cashCC = 0.5
    S2 = 60000
    mark_premium = 1000
    mntnc_marginrate = 0.10
    initialMarginRate = 0.15
    #BTCUSD drops from 60000 to 30000, user has $2000 left, or $2000/30000 BTC 
    liquidation_test(traderPositionBC, liquidationFee, tradingFee, lotSize, S2_0, cashCC, S2, mark_premium, mntnc_marginrate, initialMarginRate)
    print("---")
    fMarginRateBeta	= 0.10
    fInitialMarginRateCap =	0.10
    fMaintenanceMarginRateAlpha = 0.04
    fInitialMarginRateAlpha = 0.06
    tradingFee = 0.0006
    liquidationFee = 0.002
    cap = fInitialMarginRateCap - (fInitialMarginRateAlpha-fMaintenanceMarginRateAlpha)
    mntnc_marginrate = np.min((fMaintenanceMarginRateAlpha + fMarginRateBeta*np.abs(traderPositionBC), cap))
    initialMarginRate = np.min((fMaintenanceMarginRateAlpha + fMarginRateBeta*np.abs(traderPositionBC), fInitialMarginRateCap))
    print("mntnc_marginrate=",mntnc_marginrate)
    print("initialMarginRate=",initialMarginRate)
    liquidation_test(traderPositionBC, liquidationFee, tradingFee, lotSize, S2_0, cashCC, S2, mark_premium, mntnc_marginrate, initialMarginRate)
