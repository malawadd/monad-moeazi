BEGIN;

-- Passwords/login roles are provisioned separately. This role cannot log in,
-- administer roles, own application tables or bypass row security.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='moeazi_simulation_writer') THEN
    CREATE ROLE moeazi_simulation_writer NOLOGIN NOSUPERUSER NOCREATEDB
      NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='moeazi_simulation_writer'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'existing simulation role has excessive authority';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO moeazi_simulation_writer;

-- Preserve preexisting grants for all other roles. The restrictive policy applies
-- in addition to the baseline permissive policy for simulation-role members.
-- Accounts within experiment space still require application scope checks;
-- this credential boundary excludes live financial rows altogether.
DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY[
    'finance_accounts','finance_source_events','finance_journal_transactions',
    'finance_journal_postings','finance_balances','finance_positions','finance_capacity',
    'finance_policy_versions','finance_calculation_receipts','finance_reconciliation_checkpoints',
    'finance_reservations','finance_reservation_components','finance_submission_attempts',
    'finance_command_claims','finance_pending_events','finance_outbox','finance_resolution_proofs',
    'observation_account_snapshots','simulation_runs','simulation_orders',
    'simulation_order_events','simulation_event_journal_links','simulation_positions',
    'simulation_protections','simulation_commands','simulation_advance_claims',
    'simulation_intents','simulation_approval_receipts','simulation_approval_revocations',
    'simulation_order_preparations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item);
    EXECUTE format('DROP POLICY IF EXISTS simulation_preserve_existing_grants ON public.%I', item);
    EXECUTE format('CREATE POLICY simulation_preserve_existing_grants ON public.%I
      AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true)', item);
    EXECUTE format('DROP POLICY IF EXISTS simulation_experiment_only ON public.%I', item);
    EXECUTE format('CREATE POLICY simulation_experiment_only ON public.%I
      AS RESTRICTIVE FOR ALL TO moeazi_simulation_writer
      USING (environment = ''experiment'') WITH CHECK (environment = ''experiment'')', item);
    EXECUTE format('REVOKE ALL ON public.%I FROM moeazi_simulation_writer', item);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO moeazi_simulation_writer', item);
  END LOOP;
END $$;
GRANT UPDATE ON finance_accounts,finance_balances,finance_positions,finance_capacity,
  finance_reservations,finance_reservation_components,finance_submission_attempts,
  finance_pending_events,simulation_runs,simulation_orders,simulation_positions,
  simulation_protections TO moeazi_simulation_writer;
GRANT DELETE ON finance_pending_events TO moeazi_simulation_writer;
GRANT SELECT ON observation_instrument_versions,observation_market_events,
  observation_evidence_snapshots TO moeazi_simulation_writer;

-- Prevent an experiment row from smuggling a live projection through the trusted
-- outbox publisher. Delivery independently rechecks these row/payload bindings.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='finance_outbox_payload_scope') THEN
    ALTER TABLE finance_outbox ADD CONSTRAINT finance_outbox_payload_scope CHECK (
      jsonb_typeof(payload) = 'object'
      AND jsonb_typeof(payload->'environment') IS NOT DISTINCT FROM 'string'
      AND jsonb_typeof(payload->'scopeId') IS NOT DISTINCT FROM 'string'
      AND jsonb_typeof(payload->'strategyAccountId') IS NOT DISTINCT FROM 'string'
      AND jsonb_typeof(payload->'accountRevision') IS NOT DISTINCT FROM 'string'
      AND (payload->>'environment') IS NOT DISTINCT FROM environment
      AND (payload->>'scopeId') IS NOT DISTINCT FROM scope_id
      AND (payload->>'strategyAccountId') IS NOT DISTINCT FROM strategy_account_id
      AND (payload->>'accountRevision') IS NOT DISTINCT FROM account_revision::text
    );
  END IF;
END $$;

COMMIT;
