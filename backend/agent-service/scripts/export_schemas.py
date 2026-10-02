import json
from pathlib import Path

from moeazi_agent.contracts import EvidenceRef, ExecutionDecision, MarketSynthesis, SignalReport, TradeProposal


def main() -> None:
    output = Path(__file__).parents[1] / "schemas"
    output.mkdir(exist_ok=True)
    for model in (EvidenceRef, SignalReport, MarketSynthesis, TradeProposal, ExecutionDecision):
        target = output / f"{model.__name__}.schema.json"
        target.write_text(json.dumps(model.model_json_schema(), indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
