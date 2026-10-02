"""Guarded local SQL084 proof lineage; no sidecar or funded operation."""
import os
from hashlib import sha256
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine


def _dsn():
    raw = os.getenv("MOEAZI_NATIVE_TEST_POSTGRES_DSN")
    if not raw:
        pytest.skip("Native SQL proof requires an explicit disposable database")
    url = make_url(raw)
    if (url.drivername, url.host, url.port, url.database) != (
        "postgresql+asyncpg", "127.0.0.1", 15432, "moeazi_proto_084_check_20261002"
    ):
        pytest.fail("Native SQL test cannot target the application database")
    return raw


@pytest.mark.asyncio
async def test_live_attempt_fill_lineage_is_scoped_and_immutable():
    engine = create_async_engine(_dsn())
    account = "sql084-" + uuid4().hex
    hashes = {name: sha256((name + account).encode()).hexdigest() for name in (
        ("policy", "snapshot_before", "snapshot_after", "quote", "receipt",
         "reservation", "attempt", "payload", "source", "journal", "proof"))}
    base = {"account": account, **hashes}
    try:
        async with engine.connect() as conn:
            transaction = await conn.begin()
            try:
                await conn.execute(text("""
                  INSERT INTO finance_accounts(environment,scope_id,strategy_account_id,
                    source_account_id,revision,admission_state,reconciliation_state,
                    reconciliation_reason,observation_snapshot_hash,policy_version,policy_hash)
                  VALUES('live','live',:account,'native-wallet',5,'open','clean','matched',
                    :snapshot_before,'policy-v1',:policy)
                """), base)
                for name in ("snapshot_before", "snapshot_after"):
                    await conn.execute(text("""
                      INSERT INTO observation_account_snapshots(snapshot_hash,environment,scope_id,
                        strategy_account_id,source_account_id,status,origin,observed_balances,
                        observed_positions,balances_complete,positions_complete,event_at,
                        available_at,received_at,cutoff_at,finality,finality_at,has_gap,
                        has_reorg,rights_ref,source_event_hash,source_payload_hash,
                        policy_version,registry_hash)
                      VALUES(:hash,'live','live',:account,'native-wallet','accepted',
                        'native_verified','[]'::jsonb,'[]'::jsonb,true,true,
                        now()-interval '2 seconds',now()-interval '1 second',
                        now()-interval '1 second',now(),'admitted_final',
                        now()-interval '1 second',false,false,'native_arbitrum_rpc',
                        :source,:payload,'policy-v1',:policy)
                    """), {**base, "hash": hashes[name]})
                await conn.execute(text("""
                  INSERT INTO finance_policy_versions(environment,scope_id,strategy_account_id,
                    policy_version,policy_hash,policy_json,approved_live)
                  VALUES('live','live',:account,'policy-v1',:policy,'{}'::jsonb,true)
                """), base)
                await conn.execute(text("""
                  INSERT INTO observation_uniswap_v3_quotes(quote_hash,chain_id,venue,
                    token_in,token_out,fee_tier,amount_in,amount_out,block_number,
                    block_hash,block_at,source_rights_ref,payload)
                  VALUES(:quote,42161,'uniswap',
                    '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
                    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
                    3000,1000000,1000000000000000,123,'0x' || repeat('a',64),
                    now(),'arbitrum_finalized_rpc:uniswap_v3_quoter_v2','{}'::jsonb)
                """), base)
                await conn.execute(text("""
                  INSERT INTO finance_calculation_receipts(environment,scope_id,
                    strategy_account_id,receipt_hash,account_revision,observation_snapshot_hash,
                    policy_version,policy_hash,receipt_json,authority_class)
                  VALUES('live','live',:account,:receipt,5,:snapshot_before,
                    'policy-v1',:policy,'{}'::jsonb,'live_native')
                """), base)
                await conn.execute(text("""
                  INSERT INTO finance_reservations(environment,scope_id,strategy_account_id,
                    reservation_id,idempotency_key,request_hash,intent_id,purpose,controller_ref,
                    controller_mode,snapshot_hash,policy_version,policy_hash,writer_epoch,
                    authority_epoch,authority_fingerprint,calculation_receipt_hash,
                    admitted_revision,status,expires_at)
                  VALUES('live','live',:account,:reservation,'sql084-reserve',:payload,
                    'intent-sql084','trade','{}'::jsonb,'autopilot',:snapshot_before,
                    'policy-v1',:policy,1,1,:source,:receipt,5,'submitted',now()+interval '1 minute')
                """), base)
                await conn.execute(text("""
                  INSERT INTO finance_submission_attempts(environment,scope_id,strategy_account_id,
                    attempt_id,reservation_id,client_id,normalized_payload_hash,status)
                  VALUES('live','live',:account,:attempt,:reservation,'command-sql084',
                    :payload,'possible')
                """), base)
                await conn.execute(text("""
                  INSERT INTO finance_live_uniswap_attempt_bindings(environment,scope_id,
                    strategy_account_id,attempt_id,reservation_id,proposal_id,command_id,intent_id,
                    grant_id,owner_address,assignment_id,program_version_id,controller_ref,
                    quote_hash,amount_in,amount_out_minimum,deadline,normalized_payload_hash)
                  VALUES('live','live',:account,:attempt,:reservation,'proposal-sql084',
                    'command-sql084','intent-sql084','grant-sql084',
                    '0x1111111111111111111111111111111111111111','assignment-sql084',
                    'version-sql084','{}'::jsonb,:quote,1000000,900000000000000,
                    2000000000,:payload)
                """), base)
                await conn.execute(text("""
                  INSERT INTO finance_source_events(environment,scope_id,strategy_account_id,
                    source_event_hash,source_owner,source_stream,source_event_id,
                    source_revision,source_payload_hash,event_kind,observed_at)
                  VALUES('live','live',:account,:source,'native-wallet','uniswap-finalized',
                    '0x' || repeat('a',64),'block-123',:proof,'fill',now())
                """), base)
                await conn.execute(text("""
                  INSERT INTO finance_journal_transactions(environment,scope_id,
                    strategy_account_id,transaction_id,source_event_hash,posting_count,
                    request_hash,account_revision)
                  VALUES('live','live',:account,:journal,:source,4,:payload,5)
                """), base)
                for ordinal, (asset, book, units) in enumerate((
                    ('USDC','wallet','-1000000'), ('USDC','external','1000000'),
                    ('WETH','wallet','1000000000000000'),
                    ('WETH','external','-1000000000000000')), 1):
                    await conn.execute(text("""
                      INSERT INTO finance_journal_postings(environment,scope_id,
                        strategy_account_id,transaction_id,ordinal,asset_unit_id,
                        registry_hash,location_id,book,units)
                      VALUES('live','live',:account,:journal,:ordinal,:asset,:policy,
                        'native-wallet',:book,:units)
                    """), {**base, 'ordinal': ordinal, 'asset': asset,
                           'book': book, 'units': units})
                await conn.execute(text("""
                  INSERT INTO finance_live_uniswap_fills(environment,scope_id,
                    strategy_account_id,proof_hash,reservation_id,attempt_id,intent_id,
                    client_id,normalized_payload_hash,grant_id,user_operation_hash,
                    transaction_hash,confirmed_block_number,confirmed_block_hash,
                    actual_input_units,actual_output_units,before_snapshot_hash,
                    after_snapshot_hash,journal_transaction_id,proof_json)
                  VALUES('live','live',:account,:proof,:reservation,:attempt,'intent-sql084',
                    'command-sql084',:payload,'grant-sql084','0x' || repeat('b',64),
                    '0x' || repeat('a',64),123,'0x' || repeat('c',64),1000000,
                    1000000000000000,:snapshot_before,:snapshot_after,:journal,'{}'::jsonb)
                """), base)
                row = (await conn.execute(text("""
                  SELECT proposal_id,grant_id FROM finance_live_uniswap_attempt_bindings
                  WHERE environment='live' AND scope_id='live'
                    AND strategy_account_id=:account AND attempt_id=:attempt
                """), base)).one()
                assert row == ("proposal-sql084", "grant-sql084")
                assert (await conn.execute(text("""
                  SELECT journal_transaction_id FROM finance_live_uniswap_fills
                  WHERE environment='live' AND scope_id='live'
                    AND strategy_account_id=:account AND attempt_id=:attempt
                """), base)).scalar_one() == hashes['journal']
                savepoint = await conn.begin_nested()
                with pytest.raises(Exception, match="immutable"):
                    await conn.execute(text("""
                      UPDATE finance_live_uniswap_attempt_bindings
                      SET grant_id='changed' WHERE environment='live' AND scope_id='live'
                        AND strategy_account_id=:account AND attempt_id=:attempt
                    """), base)
                await savepoint.rollback()
                savepoint = await conn.begin_nested()
                with pytest.raises(Exception, match="immutable"):
                    await conn.execute(text("""
                      DELETE FROM finance_live_uniswap_fills
                      WHERE environment='live' AND scope_id='live'
                        AND strategy_account_id=:account AND attempt_id=:attempt
                    """), base)
                await savepoint.rollback()
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
