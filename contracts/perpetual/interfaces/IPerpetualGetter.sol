// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "../core/PerpStorage.sol";
import "../../interface/IShareTokenFactory.sol";

interface IPerpetualGetter {
    function getPoolCount() external view returns (uint16);

    function getPerpetualId(uint16 _poolId, uint16 _perpetualIndex) external view returns (bytes32);

    function getLiquidityPool(uint16 _id) external view returns (PerpStorage.LiquidityPoolData memory);

    function getPoolIdByPerpetualId(bytes32 _perpetualId) external view returns (uint16);

    function getPerpetual(bytes32 _perpetualId) external view returns (PerpStorage.PerpetualData memory);

    function getMarginAccount(bytes32 _perpetualId, address _account) external view returns (PerpStorage.MarginAccount memory);

    function isActiveAccount(bytes32 _perpetualId, address _account) external view returns (bool);

    function getCheckpoints(uint16 _poolId, address _account) external view returns (PerpStorage.Checkpoint[] memory);

    function getAMMPerpLogic() external view returns (address);

    function getGovernanceAddresses() external view returns (address[] memory);

    function isGovernanceAddress(address _address) external view returns (bool);

    function getShareTokenFactory() external view returns (IShareTokenFactory);

    function getPerpMarginAccount(bytes32 _perpId, address _trader) external view returns (PerpStorage.MarginAccount memory);

    function getActivePerpAccounts(bytes32 _perpId) external view returns (address[] memory perpActiveAccounts);

    function getPerpetualCountInPool(uint16 _poolId) external view returns (uint16);

    function getAMMState(bytes32 _iPerpetualId) external view returns (int128[13] memory);

    function getTraderState(bytes32 _iPerpetualId, address _traderAddr) external view returns (int128[7] memory);

    // function getActiveAccounts() external view returns (address[] memory allActiveAccounts);

    function getActivePerpAccountsByChunks(
        bytes32 _perpId,
        uint256 _from,
        uint256 _to
    ) external view returns (address[] memory chunkPerpActiveAccounts);

    function isTraderMaintenanceMarginSafe(bytes32 _iPerpetualId, address _traderAddr) external view returns (bool);

    function countActivePerpAccounts(bytes32 _perpId) external view returns (uint256);

    function getOraclePriceData(address _oracle) external view returns (PerpStorage.OraclePriceData memory);

    function getUpdatedTargetAMMFundSize(bytes32 _iPerpetualId, bool _isBaseline) external returns (int128);

    function isAddrWhitelisted(address _account) external view returns (bool);
}
