#/usr/bin/env python
# -*- coding: utf-8 -*-
#

import numpy as np
from scipy.stats import norm
from scipy.optimize import minimize
import matplotlib.pyplot as plot

def get_variance_Z_withC(r, sig2, sig3, rho, C3):
    return np.exp(2*r)*(
        (np.exp(sig3**2)-1)*C3**2 + (np.exp(sig2**2)-1) +
        2*(np.exp(sig2*sig3*rho)-1)*C3
    )

def get_variance_Z(r, sig2, sig3, rho, M3, s2, s3, M2, K2):
    C3=M3*s3/(M2*s2-K2*s2)
    return np.exp(2*r)*(
        (np.exp(sig3**2)-1)*C3**2 + (np.exp(sig2**2)-1) +
        2*(np.exp(sig2*sig3*rho)-1)*C3
    )

def prob_def_quanto(K2, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3):
    # insurance premium for given level m of quanto fund (M3:=m)
    C3=M3*s3/(M2*s2-K2*s2)
    sigz = np.sqrt(get_variance_Z_withC(r, sig2, sig3, rho, C3))
    muz = np.exp(r)*(1+C3)
    dd = ((-L1-M1)/(s2*(M2-K2))-muz)/sigz
   
    if M2-K2<0:
        dd = -dd
    qobs = norm.cdf(dd)
    return qobs, dd

def prob_def_no_quanto(K2, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3):
    assert(M3==0)# "no quanto allowed"
    if M2-K2>=0 and -L1-M1<=0:
        return 0, -100
    if M2-K2<=0 and -L1-M1>0:
        return 1, 100
    
    sigY = sig2
    muY = r-0.5*sig2**2
    denom = s2*(M2-K2)
    Qplus_score = np.log((-L1-M1)/denom) - muY
    dd = Qplus_score/sigY
    kstar = M2-K2
    if kstar<0:
        dd = -dd
    Qplus = norm.cdf(dd)
    return Qplus, dd

def numerical_sign(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3):
    k = k
    dL = k*s2
    if M3==0:
        dk=0.0001
        qplus, ddp = prob_def_no_quanto(K2+k+dk, L1+dL+dk*s2, s2, s3, sig2, sig3, rho, r, M1, M2, M3)
        q, dd = prob_def_no_quanto(K2+k, L1+dL, s2, s3, sig2, sig3, rho, r, M1, M2, M3)    
        return np.sign(ddp-dd)
    else:
        dk=0.0001
        qplus, ddp = prob_def_no_quanto(K2+k+dk, L1+dL+dk*s2, s2, s3, sig2, sig3, rho, r, M1, M2, M3)
        q, dd = prob_def_no_quanto(K2+k, L1+dL, s2, s3, sig2, sig3, rho, r, M1, M2, M3)    
        return np.sign(ddp-dd)

def calculate_perp_price(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, minSpread=0.0001, sign_type=0):
    dL = k*s2
    sgnm = 0
    kStar = M2 - K2
    if M3==0:
        q, dd = prob_def_no_quanto(K2+k, L1+dL, s2, s3, sig2, sig3, rho, r, M1, M2, M3)    
    else:
        q, dd = prob_def_quanto(K2+k, L1+dL, s2, s3, sig2, sig3, rho, r, M1, M2, M3)
        h = s3/s2*(np.exp(rho*sig2*sig3)-1)/(np.exp(sig2*sig2)-1)*M3
        kStar = kStar + h  
    sgnm = np.sign(k-kStar)
    return s2*(1 + sgnm*q + np.sign(k)*minSpread)


def bad_cdf_approximation(dd):
    # this function provides an approximation for
    # the normal cdf
    # https://mathoverflow.net/questions/19404/approximation-of-a-normal-distribution-function
    r = 1/(1+np.exp(-1.65451*dd))
    return r

def get_target_collateral_M1(_fK2, _fS2, _fL1, _fSigma2, _fTargetDD):
    fMu2 = -0.5*_fSigma2**2
    if _fK2<0:
        fMstar = _fK2 * _fS2 * np.exp(fMu2 + _fSigma2*_fTargetDD) - _fL1
    else:
        fMstar = _fK2 * _fS2 * np.exp(fMu2 - _fSigma2*_fTargetDD) - _fL1
    
    # check
    pd, _ = prob_def_no_quanto(_fK2, _fL1, _fS2, 0, _fSigma2, 0, 0, 0, fMstar, 0, 0)
    #print("pd=", pd)
    #print("dd=", norm.ppf(pd), ", target was dd=", _fTargetDD)
    return fMstar

def get_target_collateral_M2(_fK2, _fS2, _fL1, _fSigma2, _fTargetDD):
    fMu2 = -0.5*_fSigma2**2
    if _fL1<0:
        fMstar = _fK2  - _fL1/np.exp(fMu2 + _fSigma2*_fTargetDD)/_fS2
    else:
        fMstar = _fK2  - _fL1/np.exp(fMu2 - _fSigma2*_fTargetDD)/_fS2
    # check
    pd, _ = prob_def_no_quanto(_fK2, _fL1, _fS2, 0, _fSigma2, 0, 0, 0, 0, fMstar, 0)
    #print("pd=", pd)
    #print("dd=", norm.ppf(pd), ", target was dd=", _fTargetDD)
    return fMstar

def get_target_collateral_M3(K2, s2, s3, L1, sig2, sig3, rho, r, _fTargetDD):
    # calculate AMM fund size for target default probability q
    # returns both solutions of the quadratic equation, the 
    # max of the two is the correct one
    kappa = L1/s2/K2
    a = np.exp(sig3**2)-1
    b = 2*(np.exp(sig3*sig2*rho)-1)
    c = np.exp(sig2**2)-1
    qinv2 = _fTargetDD**2
    v= -s3/s2/K2
    a0 = (a*qinv2-1)*v**2
    #print("b=",b)
    b0 = (b*qinv2-2+2*kappa*np.exp(-r))*v
    #print("b0=",b0)
    c0 = c*qinv2 - kappa**2*np.exp(-2*r)+2*kappa*np.exp(-r)-1
    Mstar1 = (-b0 + np.sqrt(b0**2-4*a0*c0))/(2*a0)
    Mstar2 = (-b0 - np.sqrt(b0**2-4*a0*c0))/(2*a0)
    Mstar = np.max((Mstar1, Mstar2))
    # check
    # params: K2, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3
    pd, _ = prob_def_quanto(K2, L1, s2, s3, sig2, sig3, rho, 0, 0, 0, Mstar)
    print("pd=", pd)
    print("dd=", norm.ppf(pd), ", target was dd=", _fTargetDD)

    return Mstar

def get_target_collateral_M3_fromPD(q, K2, s2, s3, L1, sig2, sig3, rho, r):
    # calculate AMM fund size for target default probability q
    # returns both solutions of the quadratic equation, the 
    # max of the two is the correct one
    kappa = L1/s2/K2
    a = np.exp(sig3**2)-1
    b = 2*(np.exp(sig3*sig2*rho)-1)
    c = np.exp(sig2**2)-1
    qinv2 = norm.ppf(q)**2
    v= -s3/s2/K2
    a0 = (a*qinv2-1)*v**2
    b0 = (b*qinv2-2+2*kappa*np.exp(-r))*v
    c0 = c*qinv2 - kappa**2*np.exp(-2*r)+2*kappa*np.exp(-r)-1
    Mstar1 = (-b0 + np.sqrt(b0**2-4*a0*c0))/(2*a0)
    Mstar2 = (-b0 - np.sqrt(b0**2-4*a0*c0))/(2*a0)

    # test correct solutions? - so this must be zero:
    # print(a0*Mstar1**2 + b0*Mstar1 +c0)
    # print(a0*Mstar2**2 + b0*Mstar2 +c0)
    return Mstar1, Mstar2


def get_DF_target_size(K2pair, k2TraderPair, r2pair, r3pair, n,
                            s2, s3, currency_idx):
    """Calculate the target size for the default fund

    Args:
        K2pair ([type]): [description]
        k2pair ([type]): [description]
        r2pair ([type]): [description]
        r3pair ([type]): [description]
        n ([type]): [description]
        s2 ([type]): [description]
        s3 ([type]): [description]
        currency_idx ([int]): 1 for M1 (quote), 
            2 for M2 (base), 3 for M3 (quanto) 

    Returns:
        [float]: target size
    """
    K2pair = np.abs(K2pair)
    k2TraderPair = np.abs(k2TraderPair)
    loss_down = (K2pair[0] + n * k2TraderPair[1])*\
                (1-np.exp(r2pair[0]))
    loss_up = (K2pair[1] + n * k2TraderPair[0])*\
                (np.exp(r2pair[1])-1)
    if currency_idx==1:
        return s2*np.max((loss_down, loss_up))
    elif currency_idx==2:
        return np.max((loss_down/np.exp(r2pair[0]), loss_up/np.exp(r2pair[1])))
    elif currency_idx==3:
        return s2/s3*np.max((loss_down/np.exp(r3pair[0]), loss_up/np.exp(r3pair[1])))
    


def test_default_probability():
    # benchmark for test of default probability in AMMPerp.tests.ts

    # setting
    K2=0.4
    L1=0.4*36000
    s2=38000
    s3=2000
    sig2=0.05
    sig3=0.07
    rho = 0.5
    M1 = 10
    M2 = 0.06
    M3 = 0.04
    r = 0
    k2=0

    q1, dd1=prob_def_no_quanto(K2, L1, s2, s3, sig2, sig3, rho, r, M1, M2, 0)
    q2, dd2=prob_def_quanto(K2, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3)
    print("q1=",q1)
    print("dd1     =",norm.ppf(q1))
    print("dd1_orig=",dd1)
    print("q2=",q2)
    print("dd2     =",norm.ppf(q2))
    print("dd2_orig=",dd2)
    std_z = np.sqrt(get_variance_Z(r, sig2, sig3, rho, M3, s2, s3, M2, K2))
    print("std_z=",std_z)

    C3=M3*s3/(M2*s2-K2*s2)
    std_z = np.sqrt(get_variance_Z_withC(r, sig2, sig3, rho, C3))
    print("std_z=",std_z)

    print("C3=",C3)
    print("C3^2=",C3**2)
    print("varB1=", np.exp(rho*sig2*sig3))
    print("varB=", 2*(np.exp(rho*sig2*sig3)-1))

    print("PD5: approximate PD1 no quanto")
    pd1_approx = bad_cdf_approximation(dd1)
    print("PD = ", pd1_approx)

    print("PD5: approximate PD2 quanto")
    pd1_approx = bad_cdf_approximation(dd2)
    print("PD = ", pd1_approx)

def test_pricing():
    # benchmark for test of default probability in AMMPerp.tests.ts

    # setting
    K2=0.4
    L1=0.4*36000
    s2=38000
    s3=2000
    sig2=0.05
    sig3=0.07
    rho = 0.5
    M1 = 10
    M2 = 0.06
    M3 = 0.04
    r = 0
    minSpread = 0.02
    k = 0.1
    #(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, minSpread=0.0001)
    p1 = calculate_perp_price(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, minSpread)
    print("p1=", p1)
    print("index =", s2)
    print("---")
    K2_alt=-K2
    L1_alt=-L1
    minSpread = 0.001
    p2 = calculate_perp_price(K2_alt, k, L1_alt, s2, s3, sig2, sig3, rho, r, M1, M2, minSpread)
    print("p2=", p2)
    print("---")
    minSpread = 0.05
    p3 = calculate_perp_price(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, minSpread)
    print("p3=", p3)
    
def mc_default_prob(K2, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3):

    assert(M3==0)
    N = 2
    n = 1e6
    num_defaults = 0
    mu = r-sig2**2/2
    for j in range(N):
        r2 = np.random.normal(mu, sig2, int(n))
        num_defaults += sum(np.exp(r2)*s2*(M2-K2)<-L1-M1)
    pd = num_defaults/(n*N)    
    return pd

def liquidation_price_base(LockedInValueQC, position, cash_cc, maintenance_margin_ratio):
    return LockedInValueQC/(position - np.abs(position)*maintenance_margin_ratio + cash_cc)

def liquidation_price_quanto(LockedInValueQC, position, cash_cc, maintenance_margin_ratio,
    rho23, sigma2, sigma3, S2, S3):

    alpha = np.abs(position) * maintenance_margin_ratio - position
    normInv = norm.ppf(0.75); #<- prob of being liquidated
    gamma = cash_cc*S3*np.exp(normInv*np.sqrt(1-rho23)*sigma3)
    omega = np.sqrt(rho23)*sigma3/sigma2
    def f(x):
        return (gamma*np.exp(x*omega) -  alpha*S2*np.exp(x) - LockedInValueQC)**2
    r_start = np.sign(position)*0.1
    res = minimize(f, r_start)
    r_liq = res.x[0]
    S2liq = S2 * np.exp(r_liq)
    return S2liq

def liquidation_price_quantoV2(LockedInValueQC, position, cash_cc, maintenance_margin_ratio,
    rho23, sigma2, sigma3, S2, S3):
    # assume rho=1
    alpha = np.abs(position) * maintenance_margin_ratio - position
    def f(x):
        return (cash_cc*S3*np.exp(x*sigma3/sigma2) -  alpha*S2*np.exp(x) - LockedInValueQC)
    r_start = np.sign(position)*0.1
    res = minimize(f, r_start)
    r_liq = res.x[0]
    S2liq = S2 * np.exp(r_liq)
    return S2liq

def test_liq_price():
    S20 = 50000
    pos = -1
    L = S20*pos
    maintenance_margin_ratio = 0.2
    cash_min = 0.2
    test_delta = np.arange(-0.01, 0.9, 0.001) #[0.001, -0.001, 0, 0.1, 0.001]
    S2Liq = np.zeros(test_delta.shape)
    i = 0
    for d in test_delta:
        cash_cc = cash_min+d
        S2Liq[i] = liquidation_price_base(L, pos, cash_cc, maintenance_margin_ratio)
        print("cash = ", np.round(cash_cc, 5), 
            ", cash delta = ", np.round(d, 4), 
            " liq price = ", np.round(S2Liq[i], 4))
        i += 1
    #fig, axs = plot.subplots()
    plot.plot(cash_min+test_delta, S2Liq, label='pos='+str(round(pos*100)/100))
    plot.vlines(cash_min, ymin=np.min(S2Liq), ymax=np.max(S2Liq), color='g', label='cash min')
    plot.hlines(S20, xmin=cash_min, xmax=cash_min+np.max(test_delta), color='r', label="S2")
    plot.xlabel("cash")
    plot.ylabel("liquidation price")
    plot.legend()
    plot.show()


def test_liq_price_quanto():
    L = 4000
    pos = 1
    maintenance_margin_ratio = 0.4
    rho23 = 0.7
    sigma3 = 0.08
    sigma2 = 0.05
    S2ETHUSD = 4100
    S3BTCUSD = 50000
    # cash that puts the position at maintenance margin rate
    cash_min = np.abs(pos)*maintenance_margin_ratio*S2ETHUSD/S3BTCUSD - (pos*S2ETHUSD-L)/S3BTCUSD
    test_delta = np.arange(-0.01, 0.11, 0.001) #[0.001, -0.001, 0, 0.1, 0.001]
    S2Liq = np.zeros(test_delta.shape)
    S2LiqV2 = np.zeros(test_delta.shape)
    i = 0
    for d in test_delta:
        cash_cc = cash_min+d
        S2Liq[i] = liquidation_price_quanto(L, pos, cash_cc, maintenance_margin_ratio,
                    rho23, sigma2, sigma3, S2ETHUSD, S3BTCUSD)
        S2LiqV2[i] = liquidation_price_quantoV2(L, pos, cash_cc, maintenance_margin_ratio,
                    rho23, sigma2, sigma3, S2ETHUSD, S3BTCUSD)
        print("cash = ", np.round(cash_cc, 5), 
            ", cash delta = ", np.round(d, 4), 
            " liq price = ", np.round(S2Liq, 4), 
            " S2LiqV2=", np.round(S2LiqV2,4), " index price =", S2ETHUSD)
        i += 1
    #fig, axs = plot.subplots()
    plot.plot(cash_min+test_delta, S2Liq, label='rho')
    plot.plot(cash_min+test_delta, S2LiqV2, label='rho=1')
    plot.vlines(cash_min, ymin=np.min(S2Liq), ymax=np.max(S2Liq))
    plot.xlabel("cash")
    plot.ylabel("liquidation price")
    plot.legend()
    plot.show()

def test_target_collateral():
    #  benchmark for test of target collateral in AMMPerp.tests.ts
    K2 = 1
    S2 = 36000
    S3 = 2000
    L1 = -36000
    sigma2 = 0.05
    sigma3 = 0.07
    rho = 0.5

    target_dd = -2.32634787404084#norm.ppf(0.0015) # 15 bps
    # -2.9677379253417833
    print("target dd = ", target_dd)
    M1 = get_target_collateral_M1(K2, S2, L1, sigma2, target_dd)
    print("M1 = ", M1)

    M2 = get_target_collateral_M2(K2, S2, L1, sigma2, target_dd)
    print("M2 = ", M2)

    M3 = get_target_collateral_M3(K2, S2, S3, L1, sigma2, sigma3, rho, 0, target_dd)
    print("M3 = ", M3)


def test_insurance_fund_size():
    K2pair = np.array([-0.7, 0.8])
    k2_trader = np.array([-0.11, 0.15])
    fCoverN = 4
    r2pair = np.array([-0.30, 0.20])
    r3pair = np.array([-0.32, 0.18])
    s2 = 2000
    s3 = 31000
    for currency_idx in range(3):
        i_star = get_DF_target_size(K2pair, k2_trader, r2pair, r3pair, fCoverN,\
                            s2, s3, currency_idx+1)
        print("istar for M",currency_idx+1,": ", i_star)
        
def test_pd_monte_carlo():
    K2=2
    L1=2*46000
    M2=2
    M1=0
    M3=0
    sig2 =0.08
    sig3 = 0
    rho = 0
    r = 0
    s2 = 46000
    s3 = 0

    k_vec = np.arange(-8, 8, 0.25)
    pd_mc = np.zeros(k_vec.shape)
    pd_th = np.zeros(k_vec.shape)
    dd_th = np.zeros(k_vec.shape)
    idx = 0
    for k in k_vec:
        print(str(idx/k_vec.shape[0]*100)+"%")
        pd_mc[idx] = mc_default_prob(K2+k, L1+s2*k, s2, s3, sig2, sig3, rho, r, M1, M2, M3)
        print('mc  : {:.17f}%'.format(pd_mc[idx]*100))
        pd_th[idx],dd_th[idx] = prob_def_no_quanto(K2+k, L1+s2*k, s2, s3, sig2, sig3, rho, r, M1, M2, M3)
        print('th  : {:.17f}%'.format(pd_th[idx]*100))
        print('diff: {:.17f}%'.format(100*(pd_mc[idx]-pd_th[idx])))
        
        idx += 1
    
    fig, axs = plot.subplots(2)
    axs[0].plot(k_vec, 100*pd_mc, 'r:x', label='pd monte carlo')
    axs[0].plot(k_vec, 100*pd_th, 'k-o', label='pd theoretical')
    fig.suptitle("M2 = "+str(np.round(M2,2))+"BTC, L1="+str(L1)+"$, K2="+str(K2)+"BTC")
    axs[0].set(xlabel="Trade amount k2", ylabel="digital insurance, %")
    axs[0].grid(linestyle='--', linewidth=1)
    axs[0].legend()

    axs[1].plot(k_vec, dd_th, 'k-o', label='distance to default')
    axs[1].set(xlabel="Trade amount k2", ylabel="dd")
    axs[1].grid(linestyle='--', linewidth=1)
    axs[1].legend()
    plot.show()

def test_case():
    """
    Assess specific AMM configuration
    """
    M2=0.25
    #cash_cc	0.267947331
    L1= 1025.990581
    K2 = 0.3091526707
    s2 = 15448.34
    sig2 = 0.05
    M1, M3, r, sig3, rho, s3 = 0,0,0,0,0,0
    minSpread = 0.001
    posvec = np.arange(-0.12,0.008,0.0001)
    pricevec = np.zeros(posvec.shape)
    pricevec2 = np.zeros(posvec.shape)
    pricevec3 = np.zeros(posvec.shape)
    pricevec4 = np.zeros(posvec.shape)
    ddvec = np.zeros(posvec.shape)
    indvec = np.zeros(posvec.shape)
    indvec2 = np.zeros(posvec.shape)

    u = -L1/s2 - M1/s2
    v = K2 - M2
    kStar = (u-v)/2

    for j in range(posvec.shape[0]):
        K = posvec[j]+K2
        L = L1+posvec[j]*s2
        k = posvec[j]
        dir = np.sign(posvec[j])
        #(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, minSpread=0.0001)
        #K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, minSpread=0.0001
        pricevec[j] = calculate_perp_price(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, 0)
        pricevec2[j] = calculate_perp_price(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, minSpread)
        pricevec3[j] = calculate_perp_price(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, 0)
        
        #pricevec2[j] = calculate_perp_price(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, minSpread, "numerical")
        p,ddvec[j] = prob_def_no_quanto(K, L, s2, s3, sig2, sig3, rho, r, M1, M2, M3)
        #ddvec[j]=np.exp(ddvec[j]*sig2+(r-0.5*sig2**2))
        indvec[j]=np.sign(posvec[j]-kStar)
        indvec2[j]=numerical_sign(K2, posvec[j], L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3)
    
    #whitepaper: pricingcurve.png
    fig, axs = plot.subplots(3, 1)
    for j in range(3):
        axs[j].axhline(s2, color='#afafaf', linestyle="--", label='spot')
    axs[0].plot(posvec+K, pricevec2, 'b--', label='minimal spread')

    axs[2].plot(posvec+K, pricevec4, 'b--', label='minimal spread')
    for j in range(3):
        axs[j].plot(posvec+K, pricevec, 'r:', label='no spreads')
        axs[j].axvline(kStar+K, color='g',label='K+k*')
        axs[j].axvline(K, color='k',label='K')
        
        axs[j].legend()
        axs[j].set_xlabel('k+K')
        axs[j].set_ylabel('price')
    plot.show()

    fig, axs = plot.subplots(2, 1)

    axs[0].axhline(s2, color='#afafaf', linestyle="--", label='Spot Price')

    axs[0].plot(posvec+K, pricevec, 'b--', label='Perpetual Price')
    
    axs[0].axvline(kStar+K, color='#0abfaa',label='K+k*')
    axs[0].axvline(K, color='k',label='K')
    axs[0].set_ylabel('price')
    axs[0].legend()
    axs[1].plot(posvec+K, ddvec, color='#abaaff', label='DD')
    axs[1].axvline(kStar+K, color='#0abfaa',label='K+k*')
    axs[1].set_xlabel('k+K')
    axs[1].set_ylabel('DD')
    axs[1].legend()
    #axs[2].plot(posvec+K, indvec, 'b-', label='k* based sign')
    #axs[2].plot(posvec+K, indvec2, 'r:', label='numerical sign')
    #axs[2].set_xlabel('k+K')
    #axs[2].legend()
    plot.show()

def binance_plot():
    """
    Assess specific AMM configuration
    """
    M2=0.25
    #cash_cc	0.267947331
    L1= 1025.990581
    K2 = 0.3091526707
    s2 = 15448.34
    sig2 = 0.05
    M1, M3, r, sig3, rho, s3 = 0,0,0,0,0,0
    minSpread = 0.001
    posvec = np.arange(-0.12,0.008,0.0001)
    pricevec = np.zeros(posvec.shape)
    pricevec2 = np.zeros(posvec.shape)
    pricevec3 = np.zeros(posvec.shape)
    pricevec4 = np.zeros(posvec.shape)
    ddvec = np.zeros(posvec.shape)
    indvec = np.zeros(posvec.shape)
    indvec2 = np.zeros(posvec.shape)

    #u = -L1/s2 - M1/s2
    #v = K2 - M2
    kStar = M2 - K2

    for j in range(posvec.shape[0]):
        K = posvec[j]+K2
        L = L1+posvec[j]*s2
        k = posvec[j]
        dir = np.sign(posvec[j])
        #(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, minSpread=0.0001)
        pricevec[j] = calculate_perp_price(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, 0, 0)
        pricevec2[j] = calculate_perp_price(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, minSpread, "numerical")
        pricevec3[j] = calculate_perp_price(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, 0, "numerical")
        pricevec4[j] = calculate_perp_price(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, minSpread, "numerical")
        
        #pricevec2[j] = calculate_perp_price(K2, k, L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3, minSpread, "numerical")
        p,ddvec[j] = prob_def_no_quanto(K, L, s2, s3, sig2, sig3, rho, r, M1, M2, M3)
        #ddvec[j]=np.exp(ddvec[j]*sig2+(r-0.5*sig2**2))
        indvec[j]=np.sign(posvec[j]-kStar)
        indvec2[j]=numerical_sign(K2, posvec[j], L1, s2, s3, sig2, sig3, rho, r, M1, M2, M3)
    
    #whitepaper: pricingcurve.png
    fig, axs = plot.subplots()
    axs.axhline(s2, color='#afafaf', linestyle="--", label='spot price')
    axs.plot(posvec+K, pricevec3, 'b--', label='perpetual price')
    axs.axvline(kStar+K, color='#0abfaa',label='AMM Minimal Risk Exposure')
    axs.axvline(K, color='k',label='Current Aggregated Net Trader Exposure')
        
    axs.legend()
    axs.set_xlabel("AMM Net Notional Exposure after trader's trade")
    axs.set_ylabel('price')
    plot.savefig("PricingCurve.png")
    plot.show()


def test_casePerpMathTest():
    K2=0.4
    L1=0.4*36000
    S2=38000
    S3=2000
    sig2=0.05
    sig3=0.07
    rho23 = 0.5
    M1 = 10
    M2 = 0.06
    M3 = 0.0
    r = 0
    pd,dd = prob_def_no_quanto(K2, L1, S2, S3, sig2, sig3, rho23, r, M1, M2, M3)
    print(pd)
    print(dd)
    M3 = 0.2
    pd,dd = prob_def_quanto(K2, L1, S2, S3, sig2, sig3, rho23, r, M1, M2, M3)
    print("---quanto---")
    print(pd)
    print(dd)

def test_casePerpMathTest2():
    K2=0.4
    L1=0.4*36000
    S2=38000
    S3=2000
    sig2=0.05
    sig3=0.07
    rho23 = 0.5
    M1 = 10
    M2 = 0.06
    M3vec = [0.02, 0]
    kVec =  [-0.01, 0.01]
    r = 0
    minSpread = 0.05
    for k in kVec:
        for M3 in M3vec:
            px = calculate_perp_price(K2, k, L1, S2, S3, sig2, sig3, rho23, r, M1, M2, M3, minSpread)
            print("k=",k, "M3=", M3, "px=", px)

def calc_funding_rate(premium_rate, delta, kStar, b):
    return np.max((premium_rate, delta)) + np.min((premium_rate, -delta)) +  np.sign(-kStar)*b

def test_funding_rate():
    premium_rate = np.arange(-0.0050, 0.0050, 0.00001)
    delta = 0.0005
    b = 0.0001
    kStar = np.zeros(premium_rate.shape)
    funding_rate = np.zeros(premium_rate.shape)
    kStar[premium_rate<0] =  1
    kStar[premium_rate>0] =  -1
    for j in range(premium_rate.shape[0]):
        funding_rate[j] = calc_funding_rate(premium_rate[j], delta, kStar[j], b)
    fig, axs = plot.subplots()
    axs.plot(100*premium_rate, 100*funding_rate, 'r-', label='')
    plot.grid(True)
    plot.show()

def test_lvg_reduced_position():
    """Test leverage obtained when reducing position size
    See whitepaper paragraph "Leverage with existing Position"
    """
    pos_orig = -1
    delta_p = 0.9
    Sm = 44000
    LockedIn = pos_orig*40000
    S2 = 40000
    S3 = S2 * 1.1
    mc = 0.5
    mgn_balance = (pos_orig * Sm - LockedIn) / S3 + mc
    lvg = np.abs(pos_orig) * Sm / S3 / mgn_balance
    p = 40000

    m_c_rem = mgn_balance + delta_p * (Sm-p)/S3 - np.abs(pos_orig + delta_p) * Sm/S3/lvg
    
    pos_new = pos_orig + delta_p
    new_mgn_blnc = (pos_new * Sm - LockedIn - delta_p * p) / S3 + mc - m_c_rem
    new_lvg = np.abs(pos_new) * Sm / S3 / new_mgn_blnc
    print(f"lvg 1 = {lvg:.5f}")
    print(f"mgn_balance 1 = {mgn_balance:.2f}")
    print(f"m_c_rem = {m_c_rem:.2f}")
    print(f"new_mgn_blnc = {new_mgn_blnc:.2f}")
    print(f"new_lvg = {new_lvg:.5f}")

if __name__ == "__main__":
    #test_default_probability()
    #test_target_collateral()
    #test_pricing()
    #test_insurance_fund_size()
    #test_pd_monte_carlo()
    #test_case()
    #test_liq_price_quanto()
    #binance_plot()
    #test_pricing()
    #test_casePerpMathTest2()
    #test_casePerpMathTest2()
    #test_insurance_fund_size()
    #test_liq_price()
    #test_funding_rate()
    test_lvg_reduced_position()