// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockToken is ERC20, Ownable {
    constructor() ERC20("TST", "Test-Token") {}

    function mint(address _account, uint256 _amount) external {
        _mint(_account, _amount);
    }
}
