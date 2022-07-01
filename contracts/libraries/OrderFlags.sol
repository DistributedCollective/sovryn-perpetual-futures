// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

library OrderFlags {
    uint32 internal constant MASK_CLOSE_ONLY = 0x80000000;
    uint32 internal constant MASK_MARKET_ORDER = 0x40000000;
    uint32 internal constant MASK_STOP_ORDER = 0x20000000;
    uint32 internal constant MASK_KEEP_POS_LEVERAGE = 0x08000000;
    uint32 internal constant MASK_LIMIT_ORDER = 0x04000000;
    //uint32 internal constant MASK_UNUSED_FLAG = 0x10000000;

    /**
     * @dev Check if the flags contain close-only flag
     * @param flags The flags
     * @return bool True if the flags contain close-only flag
     */
    function isCloseOnly(uint32 flags) internal pure returns (bool) {
        return (flags & MASK_CLOSE_ONLY) > 0;
    }

    /**
     * @dev Check if the flags contain market flag
     * @param flags The flags
     * @return bool True if the flags contain market flag
     */
    function isMarketOrder(uint32 flags) internal pure returns (bool) {
        return (flags & MASK_MARKET_ORDER) > 0;
    }

    /**
     * @dev We keep the position leverage for a closing position, if we have
     * an order with the flag MASK_KEEP_POS_LEVERAGE, or if we have
     * a limit or stop order.
     * @param flags The flags
     * @return bool True if we should keep the position leverage on close
     */
    function keepPositionLeverageOnClose(uint32 flags) internal pure returns (bool) {
        return (flags & (MASK_KEEP_POS_LEVERAGE | MASK_STOP_ORDER | MASK_LIMIT_ORDER)) > 0;
    }

    /**
     * @dev Check if the flags contain stop-loss flag
     * @param flags The flags
     * @return bool True if the flags contain stop-loss flag
     */
    function isStopOrder(uint32 flags) internal pure returns (bool) {
        return (flags & MASK_STOP_ORDER) > 0;
    }

    /**
     * @dev Check if the flags contain limit-order flag
     * @param flags The flags
     * @return bool True if the flags contain limit-order flag
     */
    function isLimitOrder(uint32 flags) internal pure returns (bool) {
        return (flags & MASK_LIMIT_ORDER) > 0;
    }
}
