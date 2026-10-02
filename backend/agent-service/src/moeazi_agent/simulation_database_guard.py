"""Fail startup unless the actual SQL credential has an experiment-only boundary."""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .finance_contracts import FinanceError


ROLE = "moeazi_simulation_writer"
_MARKET_READS = {"observation_instrument_versions", "observation_market_events",
                 "observation_evidence_snapshots"}
_LIFECYCLE_GRANTS = {
    "simulation_phase_receipts": frozenset({"SELECT", "INSERT"}),
    "simulation_protections": frozenset({"SELECT", "INSERT", "UPDATE"}),
    "simulation_reservation_resolutions": frozenset({"SELECT", "INSERT"}),
    "simulation_flat_resolutions": frozenset({"SELECT", "INSERT"}),
    "simulation_maintenance_reductions": frozenset({"SELECT", "INSERT"}),
    "simulation_maintenance_obligation_links": frozenset({"SELECT", "INSERT"}),
    "simulation_order_ordinal_allocations": frozenset({"SELECT", "INSERT"}),
}


async def verify_simulation_database_role(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        role = (await conn.execute(text("""
            SELECT oid,rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
            FROM pg_roles WHERE rolname=current_user
        """))).mappings().one()
        if any(role[key] for key in ("rolsuper", "rolcreatedb", "rolcreaterole",
                                     "rolreplication", "rolbypassrls")):
            raise FinanceError("Simulation SQL credential has administrative authority")
        membership = (await conn.execute(text("""
            SELECT rolname FROM pg_roles
            WHERE oid<>:oid AND pg_has_role(current_user,oid,'MEMBER')
        """), {"oid": role["oid"]})).scalars().all()
        if set(membership) != {ROLE}:
            raise FinanceError("Simulation SQL credential has missing or excessive role membership")
        schemas = (await conn.execute(text("""
            SELECT nspname FROM pg_namespace WHERE has_schema_privilege(current_user,oid,'CREATE')
              AND nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%'
        """))).scalars().all()
        if schemas:
            raise FinanceError("Simulation SQL credential may create schema objects")
        definers = (await conn.execute(text("""
            SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')
              AND has_schema_privilege(current_user,n.oid,'USAGE')
              AND has_function_privilege(current_user,p.oid,'EXECUTE') LIMIT 1
        """))).first()
        if definers:
            raise FinanceError("Simulation SQL credential can execute an unqualified privileged function")
        tables = (await conn.execute(text("""
            SELECT c.oid,c.relname,n.nspname,c.relrowsecurity,c.relowner,
              pg_has_role(current_user,c.relowner,'MEMBER') AS owns_table,
              (has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE') OR
               has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE')) AS writable,
              (has_table_privilege(current_user,c.oid,'TRUNCATE,TRIGGER,REFERENCES') OR
               has_any_column_privilege(current_user,c.oid,'REFERENCES')) AS schema_authority,
              EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid
                AND p.polname=CASE c.relname
                  WHEN 'simulation_maintenance_reductions' THEN 'simulation_maintenance_experiment'
                  WHEN 'simulation_maintenance_obligation_links' THEN 'simulation_maintenance_links_experiment'
                  WHEN 'simulation_order_ordinal_allocations' THEN 'simulation_ordinal_experiment'
                  ELSE 'simulation_experiment_only' END
                AND NOT p.polpermissive
                AND p.polcmd='*'
                AND (SELECT oid FROM pg_roles WHERE rolname=:role)=ANY(p.polroles)
                AND pg_get_expr(p.polqual,p.polrelid)='(environment = ''experiment''::text)'
                AND pg_get_expr(p.polwithcheck,p.polrelid)='(environment = ''experiment''::text)')
                AS experiment_policy
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname NOT IN ('pg_catalog','information_schema')
              AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
              AND c.relkind IN ('r','p','v','m','f')
              AND (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE')
                   OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
        """), {"role": ROLE})).mappings().all()
        for row in tables:
            if row["owns_table"] or row["schema_authority"]:
                raise FinanceError("Simulation SQL credential owns or administers data objects")
            if row["nspname"] == "public" and row["relname"] in _MARKET_READS:
                if row["writable"]:
                    raise FinanceError("Simulation worker may not replace admitted market evidence")
            elif not row["relrowsecurity"] or not row["experiment_policy"]:
                raise FinanceError("Simulation SQL credential can access an unconfined table")
        names = {row["relname"] for row in tables if row["nspname"] == "public"}
        if not ({"finance_accounts", "simulation_runs", "finance_outbox"} |
                set(_LIFECYCLE_GRANTS)).issubset(names):
            raise FinanceError("Simulation SQL credential lacks required scoped tables")
        for table, required in _LIFECYCLE_GRANTS.items():
            grants = (await conn.execute(text("""
                SELECT has_table_privilege(current_user,:table,'SELECT') AS can_select,
                  has_table_privilege(current_user,:table,'INSERT') AS can_insert,
                  has_table_privilege(current_user,:table,'UPDATE') AS can_update,
                  has_any_column_privilege(current_user,:table,'UPDATE') AS column_update,
                  has_table_privilege(current_user,:table,'DELETE') AS can_delete
            """), {"table": f"public.{table}"})).mappings().one()
            if not grants["can_select"] or not grants["can_insert"] or \
                    bool(grants["can_update"] or grants["column_update"]) != \
                    ("UPDATE" in required) or grants["can_delete"]:
                raise FinanceError("Simulation lifecycle table grants differ from scoped writer role")
        outbox_update = (await conn.execute(text("""
            SELECT has_table_privilege(current_user,'public.finance_outbox','UPDATE,DELETE')
              OR has_any_column_privilege(current_user,'public.finance_outbox','UPDATE')
        """))).scalar_one()
        if outbox_update:
            raise FinanceError("Simulation worker may not acknowledge or alter projection delivery")
