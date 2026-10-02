"""Scoped simulation lifecycle facade; financial balances remain FinanceRepository-owned."""
from __future__ import annotations

from collections.abc import Awaitable, Callable

from .finance_repository import FinanceRepository
from .lifecycle_advance import LifecycleAdvanceMixin
from .lifecycle_contracts import ExecutionEvent, ExecutionPermit
from .lifecycle_controls import LifecycleControlsMixin
from .lifecycle_control_processing import LifecycleControlProcessingMixin
from .lifecycle_protection_supervisor import LifecycleProtectionSupervisorMixin
from .lifecycle_flat_resolution import LifecycleFlatResolutionMixin
from .lifecycle_intents import LifecycleIntentMixin
from .lifecycle_entry_requests import LifecycleEntryRequestMixin
from .lifecycle_entry_processor import LifecycleEntryProcessorMixin
from .lifecycle_replay_entry import LifecycleReplayEntryMixin
from .lifecycle_maintenance_issuance import LifecycleMaintenanceIssuanceMixin
from .lifecycle_event_fold import LifecycleEventFoldMixin
from .lifecycle_checkpoint_store import LifecycleCheckpointStoreMixin
from .lifecycle_replay_cursor import LifecycleReplayCursorMixin
from .lifecycle_reservation_settlement import LifecycleReservationSettlementMixin
from .lifecycle_dataset_requests import LifecycleDatasetMixin
from .lifecycle_decision_store import LifecycleDecisionStoreMixin
from .lifecycle_order_preparation import LifecycleOrderPreparationMixin
from .lifecycle_order_start import LifecycleOrderStartMixin
from .lifecycle_run_store import LifecycleRunStoreMixin
from .lifecycle_state import EntryAuthorizationRequest, EntryAuthorityReceipt
from .lifecycle_run_contracts import SimulationScenario
from .observation_contracts import InstrumentVersion, MarketObservation

Simulator = Callable[[ExecutionPermit, InstrumentVersion,
                      tuple[MarketObservation, ...], SimulationScenario],
                     tuple[ExecutionEvent, ...]]
EntryAuthorizer = Callable[[EntryAuthorizationRequest], Awaitable[EntryAuthorityReceipt]]


class SimulationLifecycleRepository(LifecycleRunStoreMixin, LifecycleControlsMixin,
                                    LifecycleControlProcessingMixin,
                                    LifecycleProtectionSupervisorMixin,
                                    LifecycleFlatResolutionMixin,
                                    LifecycleAdvanceMixin, LifecycleIntentMixin,
                                    LifecycleOrderPreparationMixin,
                                    LifecycleOrderStartMixin,
                                    LifecycleEntryRequestMixin,
                                    LifecycleEntryProcessorMixin,
                                    LifecycleReplayEntryMixin,
                                    LifecycleMaintenanceIssuanceMixin,
                                    LifecycleDatasetMixin,
                                    LifecycleDecisionStoreMixin,
                                    LifecycleEventFoldMixin,
                                    LifecycleCheckpointStoreMixin,
                                    LifecycleReplayCursorMixin,
                                    LifecycleReservationSettlementMixin):
    def __init__(self, finance: FinanceRepository, *, simulator: Simulator,
                 entry_authorizer: EntryAuthorizer | None = None):
        self.finance = finance
        self.simulator = simulator
        self.entry_authorizer = entry_authorizer
