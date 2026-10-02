BEGIN;

-- A mutable zero projection cannot establish flatness. Independently require a
-- zero signed sum of the instrument's immutable, journal-linked source fills.
CREATE OR REPLACE FUNCTION simulation_check_flat_source_economics() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE position_row record; fill_count bigint; net_quantity numeric; exact_source boolean;
BEGIN
  PERFORM 1 FROM finance_accounts WHERE environment=NEW.environment
    AND scope_id=NEW.scope_id AND strategy_account_id=NEW.strategy_account_id FOR UPDATE;
  FOR position_row IN SELECT * FROM simulation_positions WHERE environment=NEW.environment
    AND scope_id=NEW.scope_id AND strategy_account_id=NEW.strategy_account_id
    AND run_id=NEW.run_id AND instrument_version_id=NEW.instrument_version_id
  LOOP
    SELECT count(*), coalesce(sum(CASE o.side WHEN 'buy' THEN 1 WHEN 'sell' THEN -1 END *
        (e.event_json->>'fill_quantity_units')::numeric),0), bool_and((
        f.event_hash IS NOT NULL AND f.event_kind='fill' AND f.order_id=o.order_id
        AND f.transaction_id IS NOT NULL AND l.transaction_id=f.transaction_id
        AND j.transaction_id=f.transaction_id AND s.event_kind='fill'
        AND s.source_owner='simulation:'||NEW.run_id
        AND s.source_stream=e.event_json->>'source_stream'
        AND s.source_event_id=e.source_event_id
        AND s.source_revision=e.event_json->>'source_revision'
        AND s.source_payload_hash=e.event_json->>'source_payload_hash'
        AND e.event_json->>'permit_hash'=o.permit_hash
        AND e.event_json->>'instrument_version_id'=NEW.instrument_version_id
        AND e.event_json->>'quantity_kind'=position_row.quantity_kind
        AND o.quantity_kind=position_row.quantity_kind
        AND (e.event_json->>'contract_size_unit_id') IS NOT DISTINCT FROM
          (o.permit_json->>'contract_size_unit_id')
        AND (e.event_json->>'contract_size_units') IS NOT DISTINCT FROM
          (o.permit_json->>'contract_size_units')
        AND (e.event_json->>'fill_quantity_units')::numeric>0
      ) IS TRUE) INTO fill_count,net_quantity,exact_source
      FROM simulation_orders o JOIN simulation_order_events e
        USING(environment,scope_id,strategy_account_id,run_id,order_id)
      LEFT JOIN simulation_event_folds f
        USING(environment,scope_id,strategy_account_id,run_id,event_hash)
      LEFT JOIN simulation_event_journal_links l
        USING(environment,scope_id,strategy_account_id,run_id,event_hash)
      LEFT JOIN finance_journal_transactions j ON j.environment=e.environment
        AND j.scope_id=e.scope_id AND j.strategy_account_id=e.strategy_account_id
        AND j.transaction_id=f.transaction_id
      LEFT JOIN finance_source_events s ON s.environment=j.environment
        AND s.scope_id=j.scope_id AND s.strategy_account_id=j.strategy_account_id
        AND s.source_event_hash=j.source_event_hash
      WHERE o.environment=NEW.environment AND o.scope_id=NEW.scope_id
        AND o.strategy_account_id=NEW.strategy_account_id AND o.run_id=NEW.run_id
        AND o.instrument_version_id=NEW.instrument_version_id
        AND o.permit_json->>'location_id'=position_row.location_id
        AND e.kind='fill' AND e.simulation_cursor_at<=NEW.replay_cursor_at;
    IF fill_count=0 OR net_quantity<>0 OR exact_source IS NOT TRUE THEN
      RAISE EXCEPTION 'flat resolution differs from immutable folded fill exposure';
    END IF;
    IF position_row.quantity_kind='contracts' AND NOT EXISTS (
      SELECT 1 FROM observation_account_snapshots s
        JOIN observation_instrument_versions i ON i.instrument_version_id=NEW.instrument_version_id,
        jsonb_array_elements(s.observed_positions) observed
      WHERE s.snapshot_hash=NEW.account_snapshot_hash AND s.origin='simulation_derived'
        AND s.environment=NEW.environment AND s.scope_id=NEW.scope_id
        AND s.strategy_account_id=NEW.strategy_account_id
        AND observed->>'instrument_version_id'=NEW.instrument_version_id
        AND observed->>'location_id'=position_row.location_id
        AND observed->>'instrument_registry_hash'=i.registry_hash
        AND position_row.arithmetic_state_json->>'instrument_registry_hash'=i.registry_hash
        AND observed->>'contract_size_unit_id'=i.manifest->>'base_asset_unit_id'
        AND observed->>'collateral_asset_unit_id'=i.manifest->>'settlement_asset_unit_id'
        AND observed->>'signed_contracts'='0' AND observed->>'margin_units'='0'
    ) THEN
      RAISE EXCEPTION 'flat perpetual differs from derived source position';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS simulation_flat_source_economics_guard ON simulation_flat_resolutions;
CREATE TRIGGER simulation_flat_source_economics_guard BEFORE INSERT ON simulation_flat_resolutions
  FOR EACH ROW EXECUTE FUNCTION simulation_check_flat_source_economics();

COMMIT;
