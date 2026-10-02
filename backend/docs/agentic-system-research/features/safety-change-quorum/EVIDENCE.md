# Evidence

## Claim-to-source map

| Claim | Evidence | Status |
| --- | --- | --- |
| Some control-plane relaxations currently have a single-principal path | U24 | Repository evidence |
| Separation of duties reduces abuse without collusion | S105 | Government guidance |
| Market-access controls emphasize authorized access and documented control | S106 | Regulatory analogy only |
| Threshold owners demonstrate multi-confirmation mechanics | S107 | Production documentation/analogy |
| Emergency access should be approved, incident-linked, logged and tested | S108 | Production architecture guidance |

Sources are registered in [SOURCES.md](../../SOURCES.md).

## Evidence conclusion

The sources support separation-of-duty and constrained emergency-access patterns.
They do not prove independent Unimoazi staffing, prevent collusion or establish legal
obligations. Safe threshold design does not justify replacing Particle/Magic.

## Limitations

- Two compromised or colluding humans can approve a bad change.
- Identity systems may not prove that accounts represent distinct people.
- A catalog can omit a privileged mutation path.
- Human quorum adds availability and response-time risk.
- A break-glass path is itself a high-value attack surface.

## Classification and freshness

S105 is government guidance, S106 official regulatory material used only as analogy,
S107 product documentation and S108 architecture guidance. U24 is repository evidence.
Sources were checked on 2026-08-05. Role qualification, catalog, current state and
approval versions bind every decision.

## Claims excluded

No broker-dealer compliance, organizational independence, collusion prevention or
incident-reduction percentage is claimed.

## Local fixture evidence

The local Test Center corpus exercises deterministic failure modes with explicitly
`synthetic_untrusted` qualifications. It is not evidence that two real qualified
operators exist or that Feature 17 has supplied authoritative qualification.
