# Regulatory foundation — Phase A

See `../market/README.md` for shared governance, repository, provenance and time rules.
No tariff, fiscal formula, pro-rata, total or official source is supplied by this module.

RegulatorySource identifies a stable source/dataset and explicit authority reference. The specific document reference
belongs to RegulatoryVersion, alongside its content hash and review evidence. A correction may keep sourceId while
using a new attested document. Document changes never confer approval or permit cross-source supersedes links.
Authority is verified by the trusted port, never inferred from this folder name. Economic domains are explicit labels;
the authority must verify their classification against the document, not merely accept the input label.

Economic identity is the tuple code/domain/customerScope/applicationBasis/unit. componentId identifies the exact
versioned record, sourceVersionId its source version, and validFrom/validTo its inclusive economic interval.
Records with different bases are distinct even if their code is identical. Exact duplicate identity/period fails;
overlapping segments of one economic identity fail. Adjacent inclusive intervals provide continuous coverage.

The request must explicitly enumerate requiredIdentities. Every identity needs full period coverage, with no
implicit default requirement list and no assertion that this represents a complete bill. Extra identities fail.
Applicability evidence is attested for every selected component. NOT_APPLICABLE additionally needs exclusion evidence.
Includes/excludes pin exact component records. Every reachable target must exist, have attested provenance and cover
the referring component's required interval. Unknown targets, economic self-relations, cycles, duplicate target
identities and ambiguous bindings of one economic identity to different records block publication. A selected revised
component also conflicts with a relation targeting its earlier economic identity; physical ID comparison alone is insufficient.
Resolved targets are embedded in relationComponents, with their versions/sources in the snapshot, for deterministic replay.
These are evidence records, not additional selected charges. No arithmetic is performed.
Undeclared relationships and indirect commercial overlaps cannot be invented; a future economic policy must provide
the complete applicable set and verified relationships. There is no authority to sum these components here.

Supported bases: kWh, MWh, kW, kW/year, month, year, period, percentage, each with its corresponding explicit unit.
Unknown/other units fail until deliberately modeled. Signed finite decimal strings have at most 9 integer and 6
fractional digits. This is validation precision, not a numeric tariff or a rounding rule. No conversion is performed.

Snapshots embed normalized components, selected versions, correction history, sources, required coverage, explicit
as-of selection, technical validation result, creation timestamp and integrity hash. Replay validates the original
policy against the trusted published-snapshot view, including predecessors for RECALCULATION, and rebuilds embedded data.
Recalculation must retain required economic identities; replacing the set is a new assessment, outside this contract.
No connection to Bill or CTE is made, and no approved invoice is reinterpreted.
