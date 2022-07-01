#!/usr/bin/env python3

from scipy.stats import norm, describe
from scipy.optimize import minimize_scalar
import matplotlib.pyplot as plt
import numpy as np

def _findMaxErr(x_left, x_right):
    global thresh
    m = (norm.cdf(x_right) - norm.cdf(x_left))/(x_right-x_left)
    a = norm.cdf(x_left)
    def err_func(x):
        y_hat = a + (x - x_left)*m
        return -np.abs(norm.cdf(x)-y_hat)
    res = minimize_scalar(err_func, bounds=(x_left, x_right), method='bounded', options={'xatol': thresh/2})
    
    return res.x, np.abs(res.fun)

def cdf_partition(x_left, x_right):
    
    global thresh
    max_pos, max_err = _findMaxErr(x_left, x_right)
    assert(max_pos>x_left and max_pos<x_right)
    if max_err<thresh:
        return np.array((x_left, x_right))
    else:
        return np.concatenate((cdf_partition(x_left, max_pos), cdf_partition(max_pos, x_right)))


if __name__ == "__main__":
    thresh = 1e-7
    x_left = -5.5
    x_right = 0
    p = cdf_partition(x_left, x_right)
    print(describe(p))
    print(p)
    # plot it
    plt.plot(p, norm.cdf(p), 'k-x')
    x = np.arange(-5.5, 0, 1e-6)
    plt.plot(x, norm.cdf(x), 'r-')
    plt.title("num-rows="+str(p.shape[0])+", max_err<"+str(thresh)+"["+str(x_left)+", "+str(x_right)+"]")
    plt.show()