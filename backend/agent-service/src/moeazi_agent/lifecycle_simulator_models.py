"""Frozen identifiers for separate legacy and causal simulation models."""
from .finance_contracts import _digest
from .lifecycle_execution_envelope import CAUSAL_MODEL_VERSION

MODEL_VERSION = "moeazi-clob-linear-v1"
MODEL_ASSUMPTIONS = {
    "book": "visible_depth_only_no_queue_priority",
    "participation": "floor_each_level_to_native_quantity",
    "fee": "ceil_quote_native_bps_unless_exact_fee_rule",
    "perpetual": "linear_quote_settled_no_liquidation_model",
    "latency": "dispatch_plus_fixed_latency_then_observation_availability",
    "unsupported": ["amm", "inverse_perpetual", "hidden_depth", "venue_queue", "native_execution"],
}
MODEL_HASH = _digest("moeazi-simulation-model-v1", {
    "modelVersion": MODEL_VERSION, "assumptions": MODEL_ASSUMPTIONS,
})
CAUSAL_MODEL_ASSUMPTIONS = {
    "book": "shared_visible_depth_ordered_by_acceptance_no_venue_queue_claim",
    "execution": "decision_bound_limit_then_source_time_fill_or_tif_cancel",
    "capacity": "single_held_wallet_vector_with_fee_subcaps",
    "fee": "declared_max_fill_count_and_exact_fee_rules",
    "perpetual": "linear_quote_settled_no_liquidation_model",
    "unsupported": ["amm", "inverse_perpetual", "hidden_depth", "native_execution"],
}
CAUSAL_MODEL_HASH = _digest("moeazi-simulation-model-v2", {
    "modelVersion": CAUSAL_MODEL_VERSION, "assumptions": CAUSAL_MODEL_ASSUMPTIONS,
})
