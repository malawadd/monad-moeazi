from __future__ import annotations
from .risk_tiered_consent_canonical import digest
def claim(packet,outcome,now):
    if now>=packet.expires_at: outcome="expired"
    return {"challengeHash":packet.challenge_hash,"packetHash":packet.packet_hash,"outcome":outcome,"claimHash":digest({"challenge":packet.challenge_hash,"outcome":outcome,"now":now})}
def validate_observation(packet,observation,now):
    if now>=packet.expires_at: return "expired"
    if observation.synthetic is not True or observation.provider!=packet.scope.owner_provider or observation.packet_hash!=packet.packet_hash or observation.challenge_hash!=packet.challenge_hash: return "rejected"
    if observation.verified_at>now or observation.expected_signer_fingerprint!=observation.observed_signer_fingerprint: return "rejected"
    return "accepted" if observation.status=="accepted" else observation.status
