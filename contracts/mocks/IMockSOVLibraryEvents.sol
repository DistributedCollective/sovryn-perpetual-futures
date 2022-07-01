// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../perpetual/interfaces/ISOVLibraryEvents.sol";

/**
 * @notice  The libraryEvents defines events that will be raised from modules (contract/modules).
 * @dev     DO REMEMBER to add new events in modules here.
 */
interface IMockSOVLibraryEvents is ISOVLibraryEvents {
    event MockPreTrade(bytes32 _iPerpetualId, address _traderAddr, int128 _fAmount, int128 _fLimitPrice, uint32 _flags);

    event MockExecuteTrade(bytes32 _iPerpetualId, address _traderAddr, int128 _fTraderPos, int128 _fTradeAmount, int128 _fDeltaLockedValue, bool _isClose);

    event MockUpdateAMMTargetFundSize(bytes32 _iPerpetualId);
    event MockUpdateDefaultFundTargetSize(bytes32 _iPerpetualId);
    event MockUpdateDefaultFundTargetSizeRandom(uint256 _iPoolIndex);

    event MockDistributeFees(bytes32 _iPerpetualId, address _traderAddr, address _referrerAddr, int128 _fDeltaPositionCC, bool _hasOpened);
}
