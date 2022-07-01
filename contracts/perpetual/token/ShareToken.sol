// SPDX-License-Identifier: MIT

pragma solidity 0.8.13;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../../interface/IShareToken.sol";

contract ShareToken is IShareToken, ERC20, Ownable {
    constructor() ERC20("LP Share Token", "LP-Share-Token") {}

    function mint(address _account, uint256 _amount) external override onlyOwner {
        _mint(_account, _amount);
    }

    function burn(address _account, uint256 _amount) external override onlyOwner {
        _burn(_account, _amount);
    }
}
