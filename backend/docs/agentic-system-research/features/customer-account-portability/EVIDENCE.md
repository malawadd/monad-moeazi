# Evidence

GDPR Article 20 and EDPB guidance support authenticated, structured portability as a
legal analogy only. NIST Privacy Framework supports inventory/access/transfer. RFC
8493 BagIt (S158) and RFC 8785 (S159) support payload checksums and canonical JSON
hashing, not legal
scope, truth, confidentiality or cross-store atomicity.

Repository review found only client-side export of visible usage CSV or one loaded
sanitized trace, with no account-wide request, cutoff, manifest, completeness or
delivery lifecycle.

Limitations: Convex, Timescale, workflows and public chain references cannot provide
one honest atomic timestamp; rights/holds can require omissions; large archives add
storage/egress exposure. Exact links are registered in [SOURCES.md](../../SOURCES.md).
# Local evidence boundary

Timescale/Postgres persistence is append-only metadata for synthetic fixture graphs. It
excludes package bytes, record values, URLs, bearer material, credentials, hidden reasoning,
and customer identity. Feature 03 is selected only as `requires_revalidation` context and
cannot become export authority.
