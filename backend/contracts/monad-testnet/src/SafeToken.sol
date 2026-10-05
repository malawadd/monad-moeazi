// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Minimal} from "./MonadTestnetRegistry.sol";

library SafeToken {
    error TokenCallFailed(address token, bytes4 selector);
    error BalanceReadFailed(address token);

    function balanceOf(address token, address account) internal view returns (uint256 amount) {
        (bool ok, bytes memory result) = token.staticcall(
            abi.encodeCall(IERC20Minimal.balanceOf, (account))
        );
        if (!ok || result.length < 32) revert BalanceReadFailed(token);
        amount = abi.decode(result, (uint256));
    }

    function safeTransfer(address token, address recipient, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20Minimal.transfer, (recipient, amount)), IERC20Minimal.transfer.selector);
    }

    function safeTransferFrom(address token, address holder, address recipient, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20Minimal.transferFrom, (holder, recipient, amount)), IERC20Minimal.transferFrom.selector);
    }

    function safeApprove(address token, address spender, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20Minimal.approve, (spender, amount)), IERC20Minimal.approve.selector);
    }

    function _call(address token, bytes memory callData, bytes4 selector) private {
        (bool ok, bytes memory result) = token.call(callData);
        if (!ok || (result.length != 0 && (result.length < 32 || !abi.decode(result, (bool))))) {
            revert TokenCallFailed(token, selector);
        }
    }
}
