ALTER TABLE evaluation_experiments
  ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS preview_hash text,
  ADD COLUMN IF NOT EXISTS expected_cost_microusd bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS work_plan jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS evaluation_previews (
  preview_hash text PRIMARY KEY,
  owner_subject text NOT NULL,
  spec jsonb NOT NULL,
  preview jsonb NOT NULL,
  plan_items jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evaluation_plan_items (
  plan_item_id text PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES evaluation_experiments(experiment_id),
  kind text NOT NULL CHECK (kind IN ('replay','live_shadow','adversarial')),
  case_id text,
  market text NOT NULL DEFAULT '',
  repetition integer NOT NULL DEFAULT 1,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','canceled')),
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evaluation_assets (
  asset_id text PRIMARY KEY,
  owner_subject text NOT NULL,
  asset_type text NOT NULL
    CHECK (asset_type IN ('template','safety_suite','prompt_bundle','case')),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','frozen')),
  payload jsonb NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_subject, asset_type, name, version)
);

CREATE TABLE IF NOT EXISTS evaluation_budget_allocations (
  allocation_id text PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES evaluation_experiments(experiment_id),
  budget_day date NOT NULL,
  reserved_microusd bigint NOT NULL,
  settled_microusd bigint NOT NULL DEFAULT 0,
  released_microusd bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','settled','released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(experiment_id, budget_day)
);

CREATE INDEX IF NOT EXISTS evaluation_previews_owner_created
  ON evaluation_previews(owner_subject, created_at DESC);
CREATE INDEX IF NOT EXISTS evaluation_plan_items_due
  ON evaluation_plan_items(experiment_id, scheduled_at, status);
CREATE INDEX IF NOT EXISTS evaluation_assets_owner_type
  ON evaluation_assets(owner_subject, asset_type, updated_at DESC);
CREATE INDEX IF NOT EXISTS evaluation_budget_allocations_day
  ON evaluation_budget_allocations(budget_day, status);
