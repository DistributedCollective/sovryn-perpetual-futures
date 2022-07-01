**Rebalance Logic**

This is an abstract summary of the logic used to rebalance the perpetual AMM.

***Trade***
1) updateFundingAndPricesBefore
    * call update oracle
    * if ret(S2 & S3)>thresh:
        * rebalance_perpetual (due to price move, details see (6) below)
3) book trade
    * this will update K and params 
4) Update AMM pool size target to current state (stress or baseline)
5) Distribute fees 
    * some funds are added to either DF or AMM 
6) rebalance perpetual 
    * adjust AMM trader margin
    * check whether we meet the AMM fund target, rebalance accordingly
    * update_mark_price 

***Liquidate***
1) updateFundingAndPricesBefore
    * call update oracle
    * if ret(S2 & S3)>thresh:
        * rebalance_perpetual (due to price move, details see (6) below)
3) book trade 
    * this will update K and params 
4) Update AMM pool size target to current state (stress or baseline)
5) Distribute fees 
    * some funds are added to either DF or AMM 
6) rebalance perpetual 
    * adjust AMM trader margin
    * check whether we meet the AMM fund target, rebalance accordingly
    * update_mark_price 

***Trader Deposit***
1) updateFundingAndPricesBefore
    * call update oracle
    * if ret(S2 & S3)>thresh:
        * rebalance_perpetual (due to price move, details see (6) below)
3) do deposit stuff

***Trader Withdraw***
1) updateFundingAndPricesBefore
    * call update oracle
    * if ret(S2 & S3)>thresh:
        * rebalance_perpetual (due to price move, details see (6) below)
3) do withdraw stuff

***P&L Participants deposit***
1) updateFundingAndPricesBefore
    * call update oracle
    * if ret(S2 & S3)>thresh:
        * rebalance_perpetual (due to price move, details see (6) below)
3) do deposit stuff
4) rebalance_perpetual

***P&L Participants withdrawal***
1) updateFundingAndPricesBefore
    * call update oracle
    * if ret(S2 & S3)>thresh:
        * rebalance_perpetual (due to price move, details see (6) below)
3) do deposit stuff
4) rebalance_perpetual

