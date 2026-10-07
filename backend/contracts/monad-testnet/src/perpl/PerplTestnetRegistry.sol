// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Addresses reported by Perpl's live Monad Testnet context and deployment docs.
library PerplTestnetRegistry {
    uint256 internal constant CHAIN_ID = 10143;
    address internal constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    address internal constant DELEGATED_ACCOUNT_FACTORY = 0xf42548Ccb3300Bc76c35dc2D347416db2E8d7209;
    address internal constant EXCHANGE = 0x1964C32f0bE608E7D29302AFF5E61268E72080cc;
    uint8 internal constant AUSD_DECIMALS = 6;
    uint256 internal constant MIN_ACCOUNT_CREATION_AUSD = 100_000_000;
}

interface IERC20MetadataPerpl {
    function decimals() external view returns (uint8);
}

interface IPerplDelegatedAccountFactory {
    function create(address operator, uint256 operatorDeadline, bytes calldata operatorSignature)
        external
        returns (address proxy);
}

interface IPerplDelegatedAccount {
    function owner() external view returns (address);
    function exchange() external view returns (address);
    function accountId() external view returns (uint256);
    function isOperator(address operator) external view returns (bool);
    function operatorAllowlist(bytes4 selector) external view returns (bool);
    function setOperatorAllowlist(bytes4 selector, bool allowed) external;
    function createAccount(uint256 amount) external;
    function depositCollateral(uint256 amount) external;
    function withdrawCollateral(uint256 amount) external;
    function allowOrderForwarding(bool allowed) external;
    function removeOperator(address operator) external;
    function addOperator(address operator, uint256 deadline, bytes calldata signature) external;
    function rescueTokens(address token, uint256 amount) external;
}

/// @notice Order ABI exposed by the Perpl Exchange through each delegated account's fallback.
interface IPerplOrderExchange {
    struct OrderDesc {
        uint256 orderDescId;
        uint256 perpId;
        uint8 orderType;
        uint256 orderId;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 expiryBlock;
        bool postOnly;
        bool fillOrKill;
        bool immediateOrCancel;
        uint256 maxMatches;
        uint256 leverageHdths;
        uint256 lastExecutionBlock;
        uint256 amountCNS;
        uint256 maxNegPnlCollatBPS;
    }

    struct OrderSignature {
        uint256 perpId;
        uint256 orderId;
    }

    struct OrderInfo {
        uint32 accountId;
        uint8 orderType;
        uint24 priceONS;
        uint40 lotLNS;
        uint16 recycleFeeRaw;
        uint32 expiryBlock;
        uint16 leverageHdths;
        uint16 orderId;
        uint16 prevOrderId;
        uint16 nextOrderId;
        uint16 maxNegPnlCollatBPS;
    }

    function execOrder(OrderDesc calldata orderDesc) external returns (OrderSignature memory signature);
    function execOrders(OrderDesc[] calldata orderDescs, bool revertOnFail)
        external returns (OrderSignature[] memory signatures);
    function getOrder(uint256 perpId, uint256 orderId) external view returns (OrderInfo memory order);
}

interface IPerplSettlementExchange {
    struct PositionBitMap {
        uint256 bank1;
        uint256 bank2;
        uint256 bank3;
        uint256 bank4;
    }

    struct AccountInfo {
        uint256 accountId;
        uint256 balanceCNS;
        uint256 lockedBalanceCNS;
        uint8 frozen;
        address accountAddr;
        PositionBitMap positions;
    }

    struct OrderLock {
        uint32 orderLockId;
        uint32 nextOrderLockId;
        uint32 prevOrderLockId;
        uint8 orderType;
        uint40 lotLNS;
        uint80 amountCNS;
    }

    function getAccountById(uint256 accountId) external view returns (AccountInfo memory accountInfo);
    function getOrderLocks(uint256 accountId) external view returns (OrderLock[] memory orderLocks);
    function getExchangeInfo()
        external
        view
        returns (
            uint256 balanceCNS,
            uint256 protocolBalanceCNS,
            uint256 recycleBalanceCNS,
            uint256 collateralDecimals,
            address collateralToken,
            address verifierProxy
        );
}
