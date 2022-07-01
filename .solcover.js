module.exports = {
    skipFiles: [
        "oracle/mock",
        "test",
        "mocks",
        "thirdparty",
        "interface",
        "governance",
        "token",
        "reader",
        "gsn", //RbtcPaymasterTestnet is a copy of RbtcPaymaster which is properly tested.
               //The others are copy pasted from the opengsn repo and have been tested in it.
        "libraries/Bytes32Pagination.sol",
        "libraries/EnumerableBytes4Set.sol",
        "libraries/EnumerableSetUpgradeable.sol",
        "libraries/RSKAddrValidator.sol"
    ],
    configureYulOptimizer: true
};