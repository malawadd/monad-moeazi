"""Offline 1.231.0 L2 partial/fee/cancel comparator; run in isolated Nautilus venv."""
from decimal import Decimal
from importlib.metadata import version
import json

from nautilus_trader.backtest.config import BacktestEngineConfig
from nautilus_trader.backtest.engine import BacktestEngine
from nautilus_trader.common.config import LoggingConfig
from nautilus_trader.config import StrategyConfig
from nautilus_trader.model.data import BookOrder, OrderBookDepth10, QuoteTick
from nautilus_trader.model.enums import AccountType, BookType, OmsType, OrderSide, TimeInForce
from nautilus_trader.model.identifiers import InstrumentId, Venue
from nautilus_trader.model.instruments import CurrencyPair
from nautilus_trader.model.objects import FIXED_PRECISION, HIGH_PRECISION, Money
from nautilus_trader.test_kit.providers import TestInstrumentProvider
from nautilus_trader.trading.strategy import Strategy


class ProbeConfig(StrategyConfig, frozen=True):
    instrument_id: InstrumentId


class RestingPartial(Strategy):
    def __init__(self, config: ProbeConfig):
        super().__init__(config)
        self.order = None
        self.cancel_sent = False

    def on_start(self):
        self.subscribe_quote_ticks(self.config.instrument_id)

    def on_quote_tick(self, _tick):
        if self.order is None:
            instrument = self.cache.instrument(self.config.instrument_id)
            self.order = self.order_factory.limit(
                instrument_id=instrument.id, order_side=OrderSide.BUY,
                quantity=instrument.make_qty(Decimal("0.7")),
                price=instrument.make_price(100), time_in_force=TimeInForce.GTC)
            self.submit_order(self.order)
        elif not self.cancel_sent and self.order.filled_qty > 0 and self.order.is_open:
            self.cancel_sent = True
            self.cancel_order(self.order)


def main():
    if version("nautilus_trader") != "1.231.0":
        raise RuntimeError("This comparison pins NautilusTrader 1.231.0")
    fields = CurrencyPair.to_dict(TestInstrumentProvider.adausdt_binance())
    fields["maker_fee"] = fields["taker_fee"] = "0.001"
    instrument = CurrencyPair.from_dict(fields)
    engine = BacktestEngine(config=BacktestEngineConfig(
        logging=LoggingConfig(bypass_logging=True)))
    try:
        engine.add_venue(Venue("BINANCE"), OmsType.NETTING, AccountType.CASH,
            starting_balances=[Money(10_000, instrument.quote_currency)],
            base_currency=None, book_type=BookType.L2_MBP,
            liquidity_consumption=True, queue_position=False)
        engine.add_instrument(instrument)
        engine.add_strategy(RestingPartial(ProbeConfig(instrument_id=instrument.id)))
        ts = 1_700_000_000_000_000_000
        engine.add_data([OrderBookDepth10(instrument_id=instrument.id,
            bids=[BookOrder(OrderSide.BUY, instrument.make_price(99),
                            instrument.make_qty(Decimal("0.3")), 1)],
            asks=[BookOrder(OrderSide.SELL, instrument.make_price(100),
                            instrument.make_qty(Decimal("0.3")), 2)],
            bid_counts=[1], ask_counts=[1], flags=0, sequence=1,
            ts_event=ts, ts_init=ts)])
        engine.add_data([QuoteTick(instrument_id=instrument.id,
            bid_price=instrument.make_price(99), ask_price=instrument.make_price(100),
            bid_size=instrument.make_qty(Decimal("0.3")),
            ask_size=instrument.make_qty(Decimal("0.3")),
            ts_event=ts + 1_000_000 + i * 1_000_000,
            ts_init=ts + 1_000_000 + i * 1_000_000) for i in range(2)])
        engine.run()
        (order,) = engine.cache.orders()
        names = [type(item).__name__ for item in order.events]
        summary = engine.get_result().summary
        assert names == ["OrderInitialized", "OrderSubmitted", "OrderAccepted",
                         "OrderFilled", "OrderPendingCancel", "OrderCanceled"]
        assert str(order.filled_qty) == "0.3"
        assert "commission=0.03000000 USDT" in str(order.events[3])
        assert summary["account.BINANCE.balance.ADA.total"] == "0.300000 ADA"
        assert summary["account.BINANCE.balance.USDT.total"] == \
            "9969.97000000 USDT"
        print(json.dumps({"version": version("nautilus_trader"),
            "fixedPrecision": FIXED_PRECISION, "highPrecision": HIGH_PRECISION,
            "eventKinds": names, "filledQuantity": str(order.filled_qty),
            "commission": "0.03000000 USDT", "adaWallet": "0.300000 ADA",
            "usdtWallet": "9969.97000000 USDT", "scope": "offline_test_kit_only"},
            sort_keys=True))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
