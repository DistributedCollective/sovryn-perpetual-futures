#/usr/bin/env python
# -*- coding: utf-8 -*-
#

# how we can schedule regular (costly) updates

import numpy as np
import time

def updateTargetPool(ts_now, delta, ts_last):
    '''
    ts_now: timestamp in seconds
    delta:  time in seconds after which we want an update
    '''
    if ts_now - ts_last > delta:
        print(time.time(), " *update*")
        ts_last = int(time.time())
    else:
        print(time.time(), " no update")
    return ts_last

if __name__ == "__main__":
    K = 100
    delta = 15
    ts_last = 0
    for k in range(K):

        ts_last = updateTargetPool(int(time.time()), delta, ts_last)
        w = np.random.uniform(0, 10)
        time.sleep(w)
