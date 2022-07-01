// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "./IPerpetualFactory.sol";
import "./IPerpetualPoolFactory.sol";
import "./IPerpetualDepositManager.sol";
import "./IPerpetualWithdrawManager.sol";
import "./IPerpetualWithdrawAllManager.sol";
import "./IPerpetualLiquidator.sol";
import "./IPerpetualTreasury.sol";
import "./IPerpetualTradeManager.sol";
import "./IPerpetualSettlement.sol";
import "./IPerpetualGetter.sol";
import "./ISOVLibraryEvents.sol";
import "./IPerpetualTradeLogic.sol";
import "./IAMMPerpLogic.sol";
import "./IPerpetualTradeLimits.sol";
import "./IPerpetualUpdateLogic.sol";
import "./IPerpetualRelayRecipient.sol";
import "./IPerpetualRebalanceLogic.sol";
import "./IPerpetualMarginLogic.sol";
import "./IPerpetualLimitTradeManager.sol";
import "./IPerpetualOrderManager.sol";

interface IPerpetualManager is
    IPerpetualFactory,
    IPerpetualPoolFactory,
    IPerpetualDepositManager,
    IPerpetualWithdrawManager,
    IPerpetualWithdrawAllManager,
    IPerpetualLiquidator,
    IPerpetualTreasury,
    IPerpetualTradeLogic,
    IPerpetualTradeManager,
    IPerpetualLimitTradeManager,
    IPerpetualOrderManager,
    IPerpetualSettlement,
    IPerpetualGetter,
    IPerpetualTradeLimits,
    IAMMPerpLogic,
    ISOVLibraryEvents,
    IPerpetualUpdateLogic,
    IPerpetualRelayRecipient,
    IPerpetualRebalanceLogic,
    IPerpetualMarginLogic
{}
