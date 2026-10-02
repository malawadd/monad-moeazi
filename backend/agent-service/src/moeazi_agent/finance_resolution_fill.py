"""Narrow full-fill check for one experimental spot trade or withdrawal."""
from __future__ import annotations

from collections import Counter
from hashlib import sha256
import json

from sqlalchemy import text

from .finance_contracts import FinanceError, FinanceScope, db_native_int, native_int
from .finance_policy import SizingReceipt


def _scope(scope: FinanceScope) -> dict:
    return {"environment": scope.environment, "scope_id": scope.scope_id,
            "strategy_account_id": scope.strategy_account_id}


async def verify_complete_experiment_fill(conn, scope: FinanceScope,
                                          reservation: dict, transaction_id: str) -> None:
    """Reject partial, cumulative, fee-bearing, perp, and unlinked fill shapes."""
    receipt_row = (await conn.execute(text("""
        SELECT receipt_json FROM finance_calculation_receipts
        WHERE environment=:environment AND scope_id=:scope_id
          AND strategy_account_id=:strategy_account_id AND receipt_hash=:hash
    """), {**_scope(scope), "hash": reservation["calculation_receipt_hash"]}
    )).mappings().first()
    if receipt_row is None:
        raise FinanceError("full-fill receipt is missing")
    body = receipt_row["receipt_json"]
    if reservation["purpose"] == "trade":
        receipt = SizingReceipt.model_validate_json(json.dumps(body))
        if receipt.receipt_hash != reservation["calculation_receipt_hash"] or \
                receipt.action not in {"spot_buy", "spot_sell"}:
            raise FinanceError("full-fill receipt is not a supported spot trade")
        request = receipt.request
        quantity = native_int(receipt.quantity_units, positive=True)
        notional = native_int(receipt.notional_units, positive=True)
        base = (request.quantity_asset_unit_id, request.quantity_registry_hash)
        quote = (request.quote_asset_unit_id, request.quote_registry_hash)
        if base == quote:
            raise FinanceError("full-fill asset identities are ambiguous")
        if receipt.action == "spot_buy":
            wallet = [(base, quantity), (quote, -notional)]
            held = [(quote, notional)]
        else:
            wallet = [(base, -quantity), (quote, notional)]
            held = [(base, quantity)]
        location = request.location_id
    elif reservation["purpose"] == "withdrawal":
        if body.get("kind") != "withdrawal" or \
                body.get("receipt_hash") != reservation["calculation_receipt_hash"]:
            raise FinanceError("full-fill withdrawal receipt is unavailable")
        raw = json.dumps({key: value for key, value in body.items()
            if key != "receipt_hash"}, sort_keys=True, separators=(",", ":"),
            ensure_ascii=False)
        digest = sha256(("moeazi-finance-withdrawal-v1\n" + raw).encode()).hexdigest()
        if digest != body["receipt_hash"]:
            raise FinanceError("full-fill withdrawal receipt was altered")
        amount = native_int(body["amountUnits"], positive=True)
        asset = (body["assetUnitId"], body["registryHash"])
        wallet, held = [(asset, -amount)], [(asset, amount)]
        location = body["locationId"]
    else:
        raise FinanceError("full-fill reservation purpose is unsupported")
    components = (await conn.execute(text("""
        SELECT asset_unit_id,registry_hash,location_id,units
        FROM finance_reservation_components WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND reservation_id=:reservation ORDER BY ordinal
    """), {**_scope(scope), "reservation": reservation["reservation_id"]}
    )).mappings().all()
    expected_holds = Counter((asset[0], asset[1], location, amount)
                             for asset, amount in held)
    actual_holds = Counter((row["asset_unit_id"], row["registry_hash"],
                            row["location_id"], db_native_int(row["units"]))
                           for row in components)
    if expected_holds != actual_holds:
        raise FinanceError("full-fill hold includes fee, buffer, or different amount")
    postings = (await conn.execute(text("""
        SELECT asset_unit_id,registry_hash,location_id,book,units
        FROM finance_journal_postings WHERE environment=:environment
          AND scope_id=:scope_id AND strategy_account_id=:strategy_account_id
          AND transaction_id=:transaction ORDER BY ordinal
    """), {**_scope(scope), "transaction": transaction_id}
    )).mappings().all()
    expected_wallet = Counter((asset[0], asset[1], location, "wallet", amount)
                              for asset, amount in wallet)
    actual_wallet = Counter((row["asset_unit_id"], row["registry_hash"],
                            row["location_id"], row["book"], db_native_int(row["units"]))
                           for row in postings if row["book"] == "wallet")
    external = [(row["asset_unit_id"], row["registry_hash"], db_native_int(row["units"]))
                for row in postings if row["book"] == "external"]
    expected_external = Counter((asset[0], asset[1], -amount)
                                for asset, amount in wallet)
    if actual_wallet != expected_wallet or Counter(external) != expected_external \
            or len(postings) != len(wallet) * 2:
        raise FinanceError("journal is not one complete exact simulated fill")
