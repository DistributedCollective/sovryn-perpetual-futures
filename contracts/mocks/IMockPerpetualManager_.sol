// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/interfaces/IPerpetualManager.sol";
import "./IMockPerpetualSetter.sol";
import "./IMockPerpetualTreasury.sol";
import "./IMockPerpetualLiquidator.sol";
import "./IMockPerpetualTradeLogic.sol";
import "./IMockPerpetualBaseFunctions.sol";
import "./IMockPerpetualEvents.sol";
import "./IMockPerpetualTradeManager.sol";
import "./IMockPerpetualUpdateFunctions.sol";
import "./IMockPerpetualRebalanceFunctions.sol";
import "./IMockPerpetualSettlement.sol";
import "../perpetual/interfaces/IPerpetualMarginViewLogic.sol";
import "./IMockSOVLibraryEvents.sol";

interface IMockPerpetualManager is
    IPerpetualManager,
    IMockPerpetualSetter,
    IMockPerpetualTreasury,
    IMockPerpetualLiquidator,
    IMockPerpetualTradeLogic,
    IMockPerpetualTradeManager,
    IMockPerpetualBaseFunctions,
    IPerpetualMarginViewLogic,
    IMockPerpetualUpdateFunctions,
    IIMockPerpetualEvents,
    IMockPerpetualRebalanceFunctions,
    IMockPerpetualSettlement,
    IMockSOVLibraryEvents
{}
