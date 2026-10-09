# Market / Regulatory foundation — Phase A

EE only. No provider, acquisition, scheduler, UI, API, database adapter or consumer wiring is installed.
`marketRepository` and `regulatoryRepository` throw `FoundationError("UNAVAILABLE")` for every operation.
`unavailableAuthority` denies every attestation. Production persistence and source verification are NOT implemented.

## Boundaries

Market observations use monthly `YYYY-MM`, exactly F1/F2/F3 and EUR_PER_MWH decimal strings.
There is no monorario, averaging, conversion, price, fallback, calculation or rounding in this domain.
The current Simulation consumer also uses these bands and units, but its snapshot type is different;
a future reviewed adapter must verify provenance and map references. This module does not modify Simulation.
Regulatory cannot alter Bill history, calculate taxes, produce totals or combine commercial CTE costs.
Records and sources here are shared institutional data. Do not place tenant, customer, supply or bill data in them.
Tenant authorization belongs to future consumer services; no access-control policy is implemented here.

## Source authority and lifecycle

Strict schemas prove structure, not official origin. A server-owned `SourceAuthority` must verify the full
authorized source identity, dataset, document bytes/reference/hash, parser version, normalized record binding,
review evidence and applicability evidence. HTTPS strings, hashes and client-provided APPROVED flags confer no trust.
An implementation must verify historical evidence, not consult only the current source status during replay.
No implementation returning unconditional approval is permitted in production; the test authority is fixture-only.

The append-only review sequence is ACQUIRED → VALIDATED → APPROVED → PUBLISHED.
APPROVED requires a human actor plus trusted evidence. `transition` appends a review and validates the sequence;
it never invents review evidence or approves automatically. Version data stays immutable; validation status is a
projection of the review ledger. Repository adapters must persist reviews as events and reject version overwrites.
An ACQUIRED-only version may be PENDING or INVALID, never VALID. From VALIDATED onward the status must be VALID.
Acquisition, technical validation and economic approval are distinct. Unpublished versions cannot supply snapshots.

## Time, identity and replay

Dates are strict YYYY-MM-DD, inclusive, range 1900–2199 (aligned with existing V2 dates).
Timestamps are explicit UTC ISO with milliseconds. No clock fallback is used.
Publication evidence, acquiredAt, referenceMonth, economic validity, asOf and createdAt are separate.
createdAt is snapshot assembly time, not calculation time; a future consumer records its own calculation timestamp.
Unknown publication evidence can be stored but blocks official as-of selection. Both publication and acquisition,
and every review, must be no later than asOf. The parser refuses publication after acquisition for a version.

Every selection lists explicit version IDs; no revision sorting or latest lookup exists.
REPLAY is a pinned selection, also used to create the initial snapshot. `replayMarket` rebuilds from embedded data
without replacing the original selection policy. Replay requires a server-owned `SnapshotEvidence` published read
view: the exact snapshot must match an independently stored publication. A caller-recomputed hash is insufficient.
The default view is unavailable and blocks. Tests pin independent immutable copies before manipulating inputs.
RECALCULATION requires a distinct snapshot ID, the prior snapshot, unchanged economic coverage, an explicit newer
revision chain and a non-earlier asOf. The previous snapshot is verified and remains unchanged. All ancestors are
embedded as versionHistory. Correction replay additionally verifies every predecessor snapshot through the trusted
published read view, with cycle/identity/coverage/version-chain checks; it never asks a live provider or selects latest.
The future persistence adapter must supply these immutable records. Hashes are real SHA-256 over
canonical sorted JSON; decimal strings are normalized without floating-point arithmetic. Hashes prove integrity,
not authenticity. Deep cloning/freezing prevents in-process mutation; database immutability is a future adapter duty.
Ancestor acquisition, publication and review events must also be no later than asOf, and review evidence is checked.
A future event blocks the supplied historical view; the service does not truncate, backdate or delete ledger events.
Array validators reject holes, null and undefined elements using typed errors before lifecycle indexing.

KNOWN includes zero; NOT_APPLICABLE has evidence; NOT_PROVIDED, MISSING and INVALID have null value.
Missing required values block. Market requires KNOWN for every month/band. Freshness is separate: STALE alone
does not reject a valid historical snapshot. Revocation/security policy is not inferred from acquisition recency.

## Repository and operations

`AtomicBatch` registers sources, versions, observations/components, review events, snapshots, attempts and publication events.
The transaction must validate all references and rebuild snapshots against persisted records before publication.
No partial writes; IDs are append-only; compare-and-swap uses expectedRevision; idempotency binds the entire command
including its guard to a key and returns the original receipt on identical retry. A different payload conflicts.
Unknown IDs, incompatible corrections and unverified provenance block publication. Source changes require a new
source identity in this minimum append-only model; there is no mutable source-admin API.
These are persistence requirements, not proof that a real database implements them. The memory adapter is tests only.

AcquisitionAttempt records completed attempts with separate NEW_DATA_AVAILABLE, NO_NEW_DATA, ERROR, INVALID_DATA,
PUBLISHED outcomes; only PUBLISHED has a publishedVersionId and publicationEventId, and only failures have errorCode.
A publication event binds eventId, attemptId, sourceId, versionId, snapshotId and an explicit publishedAt timestamp.
It must be recorded atomically with the new snapshot and matching attempt. Its timestamp must fall within the attempt,
not precede snapshot creation or version acquisition/reviews, and refer to a selected PUBLISHED version.
An existing snapshot alone cannot substantiate a new publication event. validatePublication checks identities and
chronology; adapters must also enforce the same-transaction constraint. The memory test adapter exercises this rule.
scheduledFor is a Europe/Rome calendar control date on day 1 or 16. There is no execution hour or scheduler.
No acquisition date implies economic validity. Failed refresh does not delete a snapshot.

## Verification

Tests `v2/tests/market-regulatory-*.test.mjs` use explicit SYNTHETIC fixtures, never official economic golden values.
Run using the existing V2 loader: `node --import ./v2/tests/register.mjs --test v2/tests/market-regulatory-*.test.mjs`.
Shared implementation primitives live in this module to avoid a new cross-project shared layer; Regulatory depends
on them, Market never imports Regulatory. No earlier brick or V1 dependency is imported.
