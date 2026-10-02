"""Route-aware customer Research credit and direct-BYOK estimates."""


def stage_credits(stage: dict) -> int:
    specialist = stage["stage"] not in {
        "synthesis", "review", "arbiter", "synthesis_primary", "synthesis_challenger",
        "forecast", "model_strategy", "semantic_grounding",
    }
    if stage.get("credentialSource") == "byok":
        return 1 if specialist else 2
    return 3 if specialist else 7


def summarize_customer_cost(plan: dict, semantic_sample_rate: float = 0) -> dict:
    observations = int(plan["observationCount"])
    safety = int(plan.get("adversarialObservationCount", 0))
    weight = lambda stage: (safety + (observations - safety) * semantic_sample_rate
                            if stage["stage"] == "semantic_grounding" else observations)
    stages = [stage for subject in plan["subjects"] for stage in subject["stages"]]
    platform = [stage for stage in stages if stage.get("credentialSource") != "byok"]
    byok = [stage for stage in stages if stage.get("credentialSource") == "byok"]
    return {
        "maximumCredits": observations * sum(stage_credits(stage) for stage in stages),
        "expectedCredits": round(sum(weight(stage) * stage_credits(stage) for stage in stages), 2),
        "expectedByokMicrousd": round(sum(weight(stage) * stage["expectedMicrousd"] for stage in byok)),
        "maximumByokMicrousd": observations * sum(stage["maximumMicrousd"] for stage in byok),
        "platformServiceMicrousd": observations * sum(stage["maximumMicrousd"] for stage in platform),
    }


def validated_customer_credits(plan: dict, runs: list[dict]) -> int:
    by_subject = {row["subjectId"]: {stage["stage"]: stage for stage in row["stages"]}
                  for row in plan.get("subjects", [])}
    total = 0
    for run in runs:
        if run.get("status") != "completed":
            continue
        stages = by_subject.get(run.get("subject_id"), {})
        output = run.get("output") or {}
        calls = output.get("calls") or []
        if calls:
            for call in calls:
                if call.get("status") != "completed":
                    continue
                role = {"strategy": "model_strategy",
                        "grounding_evaluator": "semantic_grounding"}.get(call.get("role"), call.get("role"))
                if role in stages:
                    total += stage_credits(stages[role])
            continue
        for report in output.get("reports") or []:
            name = report.get("role") if isinstance(report, dict) else None
            if name in stages:
                total += stage_credits(stages[name])
        if output.get("synthesis") and "synthesis" in stages:
            total += stage_credits(stages["synthesis"])
    return total
