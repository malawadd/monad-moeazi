from dataclasses import dataclass

from .roles import assignments_for_tier, required_synthesis_steps


@dataclass(frozen=True)
class RateCard:
    version: int = 1
    specialist_credits: int = 3
    synthesis_credits: int = 7
    arbiter_credits: int = 9


def estimated_credits(tier: str, card: RateCard = RateCard()) -> int:
    roles = len(assignments_for_tier(tier)) * card.specialist_credits
    synthesis = sum(card.arbiter_credits if step == "arbiter" else card.synthesis_credits for step in required_synthesis_steps(tier))
    return roles + synthesis


def billable_credits(successful_specialists: int, successful_syntheses: int, card: RateCard = RateCard()) -> int:
    return max(0, successful_specialists) * card.specialist_credits + max(0, successful_syntheses) * card.synthesis_credits
