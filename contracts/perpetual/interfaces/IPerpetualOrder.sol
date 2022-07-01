// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IPerpetualOrder {
    //     iPerpetualId  global id for perpetual
    //     traderAddr    address of trader
    //     fAmount       amount in base currency to be traded
    //     fLimitPrice   limit price
    //     fTriggerPrice trigger price. Non-zero for stop orders.
    //     iDeadline     deadline for price (seconds timestamp)
    //     referrerAddr  address of abstract referrer
    //     flags         trade flags
    struct Order {
        bytes32 iPerpetualId;
        address traderAddr;
        int128 fAmount;
        int128 fLimitPrice;
        int128 fTriggerPrice;
        uint256 iDeadline;
        address referrerAddr;
        uint32 flags;
        int128 fLeverage; // 0 if deposit and trade separate
        uint256 createdTimestamp;
    }
}
