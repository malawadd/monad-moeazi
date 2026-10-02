// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface Vm {
    function envOr(string calldata name, string calldata defaultValue)
        external returns (string memory);
    function createSelectFork(string calldata urlOrAlias)
        external returns (uint256);
}

contract ArbitrumDeploymentsTest {
    Vm private constant vm =
        Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant POOL_MANAGER =
        0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32;
    address private constant QUOTER =
        0x3972C00f7ed4885e145823eb7C655375d275A1C5;
    address private constant UNIVERSAL_ROUTER =
        0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3;
    address private constant PERMIT2 =
        0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function testOfficialArbitrumDeploymentsHaveCodeWhenRpcIsConfigured()
        public
    {
        string memory rpc = vm.envOr("ARBITRUM_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        require(POOL_MANAGER.code.length > 0, "PoolManager missing");
        require(QUOTER.code.length > 0, "Quoter missing");
        require(UNIVERSAL_ROUTER.code.length > 0, "router missing");
        require(PERMIT2.code.length > 0, "Permit2 missing");
    }
}
