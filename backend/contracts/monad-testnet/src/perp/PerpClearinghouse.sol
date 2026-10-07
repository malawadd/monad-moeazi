// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PerpClearinghouseSettlement} from "./PerpClearinghouseSettlement.sol";

/// @notice Synthetic testnet exposure settled in Circle USDC against the three seeded pool marks.
contract PerpClearinghouse is PerpClearinghouseSettlement {
    constructor(address administrator_, address usdc_, address[3] memory tokens_, address[3] memory pools_)
        PerpClearinghouseSettlement(administrator_, usdc_, tokens_, pools_) {}
}
