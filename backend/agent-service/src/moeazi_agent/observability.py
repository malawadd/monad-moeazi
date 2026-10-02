import json
import logging
from datetime import datetime, timezone

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        value = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname, "logger": record.name, "message": record.getMessage(),
        }
        for field in ("analysis_id", "job_id", "account_id", "market", "provider", "venue"):
            if hasattr(record, field): value[field] = getattr(record, field)
        if record.exc_info: value["exception"] = self.formatException(record.exc_info)
        return json.dumps(value, separators=(",", ":"), default=str)


def configure_observability(service_name: str, endpoint: str = "") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    if endpoint:
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint, insecure=True)))
    trace.set_tracer_provider(provider)
