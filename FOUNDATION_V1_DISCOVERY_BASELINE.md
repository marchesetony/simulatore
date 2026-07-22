# Foundation V1 Technical Discovery Baseline

## 1. Document status

| Item | Status |
|---|---|
| Discovery phase | **AUTHORIZED** by Product Owner Decision 10 |
| Implementation | **NOT AUTHORIZED** |
| Source branch | `rebuild/foundation-v1` |
| Repository status | Treated as a legacy prototype, not as a production system |
| Product Owner decisions | Authoritative for this discovery |
| Date of analysis | 22 July 2026 |
| Provider selection | No provider has been selected or approved |

This document is a technical-discovery index. It reconciles verified repository evidence with the existing audit, implementation plan, and ten approved Product Owner decisions. It does not change the application or authorize implementation.

## 2. Authoritative inputs

| Input | Role in this baseline |
|---|---|
| [`PROJECT_AUDIT.md`](./PROJECT_AUDIT.md) | Records the initial repository audit, prototype maturity assessment, observed implementation risks, and the original KEEP / REFACTOR / REPLACE recommendations. Relevant sections: 2–10 and 14. |
| [`FOUNDATION_V1_PLAN.md`](./FOUNDATION_V1_PLAN.md) | Provides the earlier proposed Foundation V1 structure, layers, sequence, acceptance criteria, testing, release, and rollback approach. It remains a proposal where later owner decisions have not approved its details. Relevant sections: 1–20. |
| [`OWNER_DECISIONS_FOUNDATION_V1.md`](./OWNER_DECISIONS_FOUNDATION_V1.md) | Contains Decisions 1–10 marked **APPROVED BY PRODUCT OWNER**. It is the controlling source for product scope, SaaS tenancy, roles, access, document rules, PUN rules, data location, release workflow, and discovery authorization. |
| Current repository source code | Primary evidence for behavior that exists now. In particular, [`app/page.tsx`](./app/page.tsx), [`app/layout.tsx`](./app/layout.tsx), and [`app/globals.css`](./app/globals.css) define the visible application. |
| Package and configuration files | Primary evidence for the declared toolchain and repository-visible configuration: [`package.json`](./package.json), [`package-lock.json`](./package-lock.json), [`next.config.ts`](./next.config.ts), [`tsconfig.json`](./tsconfig.json), [`eslint.config.mjs`](./eslint.config.mjs), and [`postcss.config.mjs`](./postcss.config.mjs). |

When sources conflict, this precedence order applies:

1. approved Product Owner decisions;
2. verified repository facts;
3. approved audit findings;
4. planning assumptions and proposals.

“Approved audit findings” means only audit findings whose acceptance is explicitly documented through the project review and decision workflow. An audit observation must not be treated as a Product Owner decision. Verified but not explicitly approved audit observations may be used as supporting evidence, but they cannot override Product Owner decisions or verified repository facts. Proposals or assumptions contained in an audit remain proposals or assumptions.

An older proposal is not an approval. A UI label is not evidence that the named capability is operational.

## 3. Verified current-state baseline

### 3.1 Framework, language, and dependency model

- **VERIFIED FACT:** `package.json` declares Next.js `16.2.4`, React and React DOM `19.2.4`, and TypeScript `^5`. The application uses the App Router convention through the `app/` directory.
- **VERIFIED FACT:** Tailwind CSS `^4` is configured through `@tailwindcss/postcss`; ESLint `^9` uses the Next.js Core Web Vitals and TypeScript configurations.
- **VERIFIED FACT:** `package-lock.json` uses lockfile version 3 and locks the npm dependency graph. No database, ORM, authentication, storage, validation, test, monitoring, OCR, AI, or job-scheduler package is declared as a direct dependency.
- **INFERENCE:** Next.js, React, TypeScript, and Tailwind are viable foundations, but their suitability for the final architecture still depends on detailed discovery and verification against the installed Next.js documentation before later code changes, as required by [`AGENTS.md`](./AGENTS.md).
- **UNKNOWN:** The production Node.js runtime, package-manager policy, dependency update policy, and supported browser matrix are not documented in the inspected files.

### 3.2 Application structure and major source files

- **VERIFIED FACT:** The application source visible under `app/` consists of `page.tsx`, `layout.tsx`, `globals.css`, and `favicon.ico`.
- **VERIFIED FACT:** `app/page.tsx` is a 715-line client component with four UI tabs: bills, CTE documents, PUN history, and simulator.
- **VERIFIED FACT:** `app/layout.tsx` provides the root layout, Geist fonts, and default Create Next App metadata. `app/globals.css` contains Tailwind import, color variables, dark-mode variables, and global body styling.
- **VERIFIED FACT:** No repository-visible `components/`, `lib/`, `server/`, `api/`, `db/`, `migrations/`, `tests/`, `.github/`, or equivalent modular application directories exist.
- **INFERENCE:** The current UI communicates useful product concepts, but the single-component structure couples presentation, document parsing, state, and calculations.

### 3.3 Client-side and server-side boundaries

- **VERIFIED FACT:** `app/page.tsx` starts with `'use client'`; file reading, PDF text extraction, parsing, state mutation, PUN display, and calculations occur in that client component.
- **VERIFIED FACT:** No Route Handlers, Server Actions, middleware, application service layer, or repository layer are visible in the repository.
- **UNKNOWN:** Hosting-platform behavior, external server components, or untracked services cannot be established from this repository.

### 3.4 Persistence and document handling

- **VERIFIED FACT:** CTE records and bill data are held in React `useState`; a browser refresh loses them.
- **VERIFIED FACT:** CTE PDFs are read with `FileReader`; PDF.js `3.11.174` and its worker are loaded dynamically from `cdnjs.cloudflare.com` by `app/page.tsx`.
- **VERIFIED FACT:** The source PDF is not uploaded to private server storage and no document metadata is persisted.
- **VERIFIED FACT:** Removing a CTE filters the in-memory array. It is not a controlled archival or deletion workflow.
- **UNKNOWN:** No repository evidence establishes private object storage, backups, malware scanning, signed access, retention jobs, or deletion reconciliation.

### 3.5 Current extraction, calculation, and PUN behavior

- **VERIFIED FACT:** Bill “OCR” does not inspect the selected PDF. After a 1.5-second timer it assigns a fixed object containing realistic-looking identity, supply, payment, consumption, PUN, and cost values (`app/page.tsx`, `handleUploadBolletta`).
- **VERIFIED FACT:** CTE handling extracts only an existing PDF text layer and applies regular expressions in the browser. It is not OCR.
- **VERIFIED FACT:** Missing CTE matches become zero; supplier and voltage compatibility are fixed; the expiration date defaults to `2026-12-31`.
- **VERIFIED FACT:** Six PUN rows for January–June 2026 are hardcoded in `storicoPUN`, without repository-visible source provenance, acquisition timestamp, or verification state.
- **VERIFIED FACT:** The calculation adds hardcoded bill PUN values to parsed CTE components, multiplies by band consumption, adds one fixed monthly charge, compares the result with a fixed current monthly amount, annualizes by multiplying by 12, sorts by monthly saving, and labels the first result as the best offer.
- **INFERENCE:** The current outputs cannot satisfy Decisions 5–7 because provenance, exact-month eligibility, verified source data, blocking validation, and definitive-calculation controls are absent.

### 3.6 Authentication, authorization, tenancy, tests, and CI

- **VERIFIED FACT:** No authentication, session handling, invitation flow, user model, membership model, role enforcement, or authorization layer is visible.
- **VERIFIED FACT:** No tenant identifier, tenant-scoped query, tenant-isolation enforcement, subscription state, licensed-seat limit, entitlement, or suspension enforcement is visible.
- **VERIFIED FACT:** `package.json` provides `dev`, `build`, `start`, and `lint` scripts only. No `test` or explicit `typecheck` script exists.
- **VERIFIED FACT:** No test files or repository-visible CI workflow were found.
- **UNKNOWN:** External CI checks or GitHub branch rules cannot be inferred from repository contents and were not modified or queried during this task.

### 3.7 Repository-visible deployment configuration

- **VERIFIED FACT:** `next.config.ts` exports an otherwise empty typed Next.js configuration.
- **VERIFIED FACT:** No tracked `vercel.json`, `.vercel/` configuration, Dockerfile, environment schema, or environment example is visible.
- **VERIFIED FACT:** `README.md` is generic Create Next App documentation and mentions Vercel deployment; it is not evidence of a linked or configured Vercel project.
- **UNKNOWN:** Actual Vercel project settings, environment variables, domains, deployment protection, and production linkage are external to the inspected repository.

## 4. Legacy classification matrix

The classifications below govern discovery only. They do not authorize the corresponding code action.

| Existing area | Classification | Evidence | Reason | Foundation V1 consequence | Later implementation authorization required? |
|---|---|---|---|---|---|
| Next.js foundation | KEEP | `package.json`; `app/` | Approved plan is Next.js-oriented and no verified fact requires framework replacement. | Design modular server/client boundaries within Next.js. | Yes, for any code/configuration change. |
| React and TypeScript | KEEP | `package.json`; `.tsx` source; strict `tsconfig.json` | Suitable typed UI foundation; current usage is monolithic. | Preserve stack while introducing domain and application boundaries. | Yes. |
| Tailwind and UI shell | REFACTOR | `app/globals.css`; JSX classes in `app/page.tsx` | Visual shell is useful, but metadata, accessibility, responsiveness, and component boundaries need formalization. | Treat UI as a replaceable presentation layer over authorized services. | Yes. |
| `app/page.tsx` | TEMPORARILY ISOLATE | 715-line client component | It is the only functional prototype reference but mixes all concerns. | Keep as legacy reference until replacement routes/modules are authorized and reviewed. | Yes. |
| Current PDF handling | REPLACE | Runtime CDN injection, `FileReader`, browser PDF.js | No private upload, provenance, governed dependency, or server authorization. | Design private storage and non-interpretive lifecycle first. | Yes. |
| Current OCR-like behavior | REPLACE | Bill timer returns a fixed object | It is simulated and misleading; OCR is outside Foundation V1. | Disable or isolate the claim in a later authorized phase; do not build OCR in V1. | Yes. |
| Current CTE parser | REMOVE ONLY DURING A LATER AUTHORIZED IMPLEMENTATION PHASE | Browser text-layer extraction and regex fallbacks | Not authoritative or auditable; CTE extraction is outside V1. | Preserve only as legacy evidence until authorized removal. | Yes. |
| Current PUN data | REPLACE | Hardcoded `storicoPUN` | No official source, verification, provenance, or exact matching controls. | Define future market-index boundary only; acquisition remains outside V1. | Yes. |
| Current calculation engine | REPLACE | `calcolaSimulazioneArchivio` in UI render path | Partial formula, fixed inputs, silent defaults, and unsupported annualization/ranking. | No simulation engine in V1; reserve a future deterministic domain boundary. | Yes. |
| Current in-memory archive | REPLACE | `useState<CTEArchiviata[]>` | No persistence, tenancy, lifecycle, audit, or safe deletion. | Design database metadata plus private storage and lifecycle services. | Yes. |
| Current reporting output | TEMPORARILY ISOLATE | Simulator cards and detailed breakdown | Useful workflow reference, but values are not production-grade and reports are outside V1. | Retain only as product-discovery evidence. | Yes. |
| Current navigation and workflow | REFACTOR | Four client-side tabs | Product concepts are visible, but routes, access controls, lifecycle states, and scope claims are absent. | Derive an authenticated, role-aware Foundation shell without interpretive modules. | Yes. |
| Current error handling | REPLACE | `console.error`, empty-string resolution, silent numeric/date defaults | Errors can become plausible false data and logs are not structured or redacted. | Design typed errors, explicit validation, audit boundaries, and redacted observability. | Yes. |
| Current deployment configuration | KEEP | Minimal `next.config.ts`; no tracked Vercel configuration | There is little configuration to preserve and no authorization to modify Vercel. | Document environment and release requirements without changing external configuration. | Yes. |

## 5. Approved decision coverage matrix

| Decision | Approved rule (summary) | Architectural consequence | Discovery deliverables affected | Current support | Missing foundation | Unresolved implementation choice | Further Product Owner approval? |
|---|---|---|---|---|---|---|---|
| 1 | Foundation V1 is a professional foundation; interpretive energy features are excluded. | Modular layers, auth, data, private documents, validation, audit, environments, tests, CI, rollback. | Architecture, repository structure, roadmap, acceptance criteria. | Next.js/React/TS only. | All production foundations. | Final architecture and implementation sequence. | Yes: architecture and implementation authorization. |
| 2 | SaaS multi-tenant with operator, tenant, plan, limits, status, and server enforcement. | Tenant-rooted data model; subscription/entitlement policy; suspension without deletion. | Tenant model, licensing model, authorization design. | None. | Tenant, plans, limits, enforcement. | Exact schema and policy evaluation model. | Yes where pending commercial rules affect behavior. |
| 3 | Four initial roles with granular, extensible permissions. | Roles cannot replace permission checks; platform operations are separated. | Authorization matrix and administration boundaries. | None. | Identity-to-membership-to-permission chain. | Exact permission identifiers and assignment rules. | Yes. |
| 4 | Controlled invitations; no public registration; tenant access requires active membership. | Invitation state/token model, seat checks, membership lifecycle, audit. | Auth/invitation flow, membership model, audit events. | None. | Auth, invitations, memberships, recovery boundary. | Provider, token lifetime, resend and recovery details. | Yes for pending business/identity details. |
| 5 | Operational product will handle protected real bills and CTEs; ordinary non-production uses synthetic data. | Private-by-default storage, provenance, redacted logs, environment authorization. | Storage, provenance, threat analysis, environment model. | Browser-local PDF access only; no protected controls. | Private storage and all operational safeguards. | Provider, pilot procedure, operational authorization. | Yes. |
| 6 | Approved bill/CTE states and retention: bills 60 days after archive; CTEs 12 months after archive. | State machines, timestamps, idempotent deletion jobs, minimal audit evidence. | Lifecycle, retention/deletion, audit, jobs. | In-memory add/remove only. | Persistent states, authorization, scheduler, deletion reconciliation. | Legal hold, restore, backup purge, runbooks. | Yes for listed exceptions/details. |
| 7 | Future simulations require exact verified monthly F1/F2/F3 and a four-complete-month eligibility window. | Immutable/provenanced market-index records and deterministic validation boundary. | Future PUN boundary, data integrity, job/adapter design. | Unverified hardcoded rows and fixed bill PUN. | Verified index model and import boundary. | Acquisition mechanism, corrections, verification workflow. | Yes; import remains outside V1. |
| 8 | International processing is permitted only after provider-specific assessment; no provider is approved. | Replaceable adapters, provider register, regional/config boundaries, exit capability. | Adapter strategy, decision records, threat analysis, environment model. | No provider integrations declared. | Provider assessment and register model. | Every provider, region, transfer mechanism, and operational approval. | Yes. |
| 9 | Branch/PR/Preview/check/approval/merge/deploy/verify workflow is mandatory. | CI gates, isolated environments, migration/release records, rollback and emergency controls. | CI/release strategy, environment model, rollback design. | Git branch exists; no tracked CI/Vercel config. | Automated gates and documented release control. | Exact branch protection, checks, reviewers, merge and deployment mechanism. | Yes. |
| 10 | Technical discovery and architecture design are authorized; implementation is not. | Documentation-first workstreams with explicit assumptions and pending decisions. | All documents indexed by this baseline. | This baseline begins that work. | Remaining detailed discovery documents and reviews. | Final architecture and first implementation authorization. | Yes. |

## 6. Foundation V1 scope boundary

### Included in Foundation V1

- modular professional foundation;
- authentication and controlled invitations;
- SaaS multi-tenancy;
- memberships, roles, and server-side authorization;
- licensing, seats, entitlements, and suspension foundations;
- database and migrations;
- private storage;
- non-interpretive bill and CTE lifecycle;
- audit;
- retention and scheduled-deletion foundations;
- environment separation;
- validated configuration;
- tests, CI, release gates, and rollback foundations;
- provider-neutral adapters and decision records.

### Excluded from Foundation V1

- OCR extraction;
- AI document interpretation;
- CTE commercial-condition extraction;
- GME PUN acquisition;
- electricity simulations;
- gas simulations;
- comparisons;
- rankings;
- final reports.

Future requirements still constrain Foundation V1 boundaries. Document metadata must support immutable provenance; lifecycle and audit records must support later extracted artifacts without treating them as verified; market-index storage must be separable from customer documents; deterministic simulation modules must be able to consume verified, versioned inputs; provider adapters must be replaceable; authorization must extend to future capabilities without weakening tenant isolation. These are boundary requirements, not authorization to implement the future modules.

## 7. Discovery workstreams

Every workstream below has implementation status **NOT AUTHORIZED**. Section 8 is the canonical source for every expected-output filename. Where two workstreams share one consolidated document, both mappings are stated explicitly below.

| # | Workstream and objective | Inputs | Expected output document | Dependencies | Blocking decisions | Implementation status |
|---|---|---|---|---|---|---|
| 1 | Target architecture and repository modularization: define layers, dependency direction, runtime boundaries, and legacy isolation. | Decisions 1, 9, 10; repository; audit; plan | `FOUNDATION_V1_TARGET_ARCHITECTURE.md` | None — the current baseline is an authoritative input, not a discovery-document dependency. | Final architecture approval blocks implementation, not discovery. | **NOT AUTHORIZED** |
| 2 | Authentication, sessions, invitations, and memberships: define identity/access separation and controlled onboarding. | Decisions 2–4 | `FOUNDATION_V1_IDENTITY_AND_ACCESS.md` | `FOUNDATION_V1_TARGET_ARCHITECTURE.md` | Identity provider, token duration, recovery workflow. | **NOT AUTHORIZED** |
| 3 | Multi-tenancy and authorization: define tenant context, deny-by-default policy, roles, permissions, and cross-tenant tests. | Decisions 2–4 | `FOUNDATION_V1_TENANCY_AUTHORIZATION.md` | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_IDENTITY_AND_ACCESS.md` | Exact authorization matrix and assignment rules. | **NOT AUTHORIZED** |
| 4 | Subscription, licensing, seats, and entitlements: define policy boundaries and enforcement points. | Decisions 2–4 | `FOUNDATION_V1_LICENSING_ENTITLEMENTS.md` | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_TENANCY_AUTHORIZATION.md` | Plan catalog, grace/payment state details, default limits. | **NOT AUTHORIZED** |
| 5 | Database model and migrations: propose relational entities, invariants, migration and compatibility rules. | Decisions 1–7, 9 | `FOUNDATION_V1_DATA_MODEL.md` | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_IDENTITY_AND_ACCESS.md`; `FOUNDATION_V1_TENANCY_AUTHORIZATION.md`; `FOUNDATION_V1_LICENSING_ENTITLEMENTS.md` | Exact model, database provider/region, access layer. | **NOT AUTHORIZED** |
| 6 | Private document storage and provenance: define metadata/content separation, private access, and source lineage. | Decisions 5, 6, 8 | `FOUNDATION_V1_DOCUMENT_STORAGE.md` | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_TENANCY_AUTHORIZATION.md`; `FOUNDATION_V1_DATA_MODEL.md` | Storage provider/region, limits, scanning and key model. | **NOT AUTHORIZED** |
| 7 | Bill and CTE lifecycle state machines: formalize transitions, visibility, authorization, and timestamps. | Decisions 5, 6 | `FOUNDATION_V1_DOCUMENT_LIFECYCLE.md` | `FOUNDATION_V1_TENANCY_AUTHORIZATION.md`; `FOUNDATION_V1_DATA_MODEL.md`; `FOUNDATION_V1_DOCUMENT_STORAGE.md` | Restoration and exceptional retention rules. | **NOT AUTHORIZED** |
| 8 | Audit model: define event taxonomy, actors, subject references, redaction, and evidence retention. | Decisions 2–6, 9 | `FOUNDATION_V1_AUDIT_RETENTION.md` | `FOUNDATION_V1_TENANCY_AUTHORIZATION.md`; `FOUNDATION_V1_DATA_MODEL.md`; `FOUNDATION_V1_DOCUMENT_STORAGE.md`; `FOUNDATION_V1_DOCUMENT_LIFECYCLE.md` | Exact audit retention/access policy. | **NOT AUTHORIZED** |
| 9 | Retention and deletion jobs: define idempotency, retries, reconciliation, failure handling, and backup boundary. | Decision 6 | `FOUNDATION_V1_AUDIT_RETENTION.md` | `FOUNDATION_V1_DATA_MODEL.md`; `FOUNDATION_V1_DOCUMENT_STORAGE.md`; `FOUNDATION_V1_DOCUMENT_LIFECYCLE.md`; audit-model portion of `FOUNDATION_V1_AUDIT_RETENTION.md` | Scheduler, legal hold, backup purge timing, runbook. | **NOT AUTHORIZED** |
| 10 | Environment and configuration model: define Local/CI/Preview/pilot/Production isolation and validated configuration. | Decisions 5, 8, 9 | `FOUNDATION_V1_ENVIRONMENTS_PROVIDERS.md` | `FOUNDATION_V1_TARGET_ARCHITECTURE.md` | Provider-specific configuration and pilot authorization. | **NOT AUTHORIZED** |
| 11 | Provider-adapter strategy: define ports, registers, assessment records, portability, and exit boundaries. | Decision 8 | `FOUNDATION_V1_ENVIRONMENTS_PROVIDERS.md` | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_DATA_MODEL.md`; `FOUNDATION_V1_DOCUMENT_STORAGE.md`; environment-model portion of `FOUNDATION_V1_ENVIRONMENTS_PROVIDERS.md` | Providers and regions remain pending. | **NOT AUTHORIZED** |
| 12 | Testing and CI strategy: define test layers, synthetic fixtures, negative tenancy tests, and progressive gates. | Decisions 1, 5, 9 | `FOUNDATION_V1_TESTING_RELEASE.md` | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_IDENTITY_AND_ACCESS.md`; `FOUNDATION_V1_TENANCY_AUTHORIZATION.md`; `FOUNDATION_V1_LICENSING_ENTITLEMENTS.md`; `FOUNDATION_V1_DATA_MODEL.md`; `FOUNDATION_V1_DOCUMENT_STORAGE.md`; `FOUNDATION_V1_DOCUMENT_LIFECYCLE.md`; `FOUNDATION_V1_AUDIT_RETENTION.md`; `FOUNDATION_V1_ENVIRONMENTS_PROVIDERS.md` | Exact tools, mandatory checks, reviewer rules. | **NOT AUTHORIZED** |
| 13 | Release, migration, rollback, and recovery: define evidence, compatibility, release records, and emergency path. | Decision 9 | `FOUNDATION_V1_TESTING_RELEASE.md` | `FOUNDATION_V1_DATA_MODEL.md`; `FOUNDATION_V1_AUDIT_RETENTION.md`; `FOUNDATION_V1_ENVIRONMENTS_PROVIDERS.md`; testing/CI portion of `FOUNDATION_V1_TESTING_RELEASE.md` | Merge/deployment authorization and detailed runbooks. | **NOT AUTHORIZED** |
| 14 | Observability and redacted errors: define error taxonomy, correlation, redaction, alert boundary, and audit separation. | Decisions 1, 5, 8, 9 | `FOUNDATION_V1_OBSERVABILITY_SECURITY.md` | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_TENANCY_AUTHORIZATION.md`; `FOUNDATION_V1_DOCUMENT_STORAGE.md`; `FOUNDATION_V1_AUDIT_RETENTION.md`; `FOUNDATION_V1_ENVIRONMENTS_PROVIDERS.md` | Monitoring provider, retention, incident details. | **NOT AUTHORIZED** |
| 15 | Security and privacy threat analysis: identify assets, trust boundaries, abuse cases, transfer and data-minimization controls. | Decisions 2–9 | `FOUNDATION_V1_OBSERVABILITY_SECURITY.md` | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_IDENTITY_AND_ACCESS.md`; `FOUNDATION_V1_TENANCY_AUTHORIZATION.md`; `FOUNDATION_V1_LICENSING_ENTITLEMENTS.md`; `FOUNDATION_V1_DATA_MODEL.md`; `FOUNDATION_V1_DOCUMENT_STORAGE.md`; `FOUNDATION_V1_DOCUMENT_LIFECYCLE.md`; `FOUNDATION_V1_AUDIT_RETENTION.md`; `FOUNDATION_V1_ENVIRONMENTS_PROVIDERS.md`; observability portion of `FOUNDATION_V1_OBSERVABILITY_SECURITY.md` | Provider assessments, lawful-processing documentation, operational authorization. | **NOT AUTHORIZED** |
| 16 | Future PUN, OCR, AI, and simulation boundaries: prevent V1 dead ends without designing prohibited features as V1 scope. | Decisions 1, 5–8, 10 | `FOUNDATION_V1_FUTURE_BOUNDARIES.md` | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_DATA_MODEL.md`; `FOUNDATION_V1_DOCUMENT_STORAGE.md`; `FOUNDATION_V1_DOCUMENT_LIFECYCLE.md`; `FOUNDATION_V1_AUDIT_RETENTION.md`; `FOUNDATION_V1_ENVIRONMENTS_PROVIDERS.md`; `FOUNDATION_V1_OBSERVABILITY_SECURITY.md` | Future module approvals and workflows remain pending. | **NOT AUTHORIZED** |

## 8. Proposed discovery document set

The files below are proposals only and were not created by this task. This table is the canonical and complete discovery-document filename set; sections 7 and 12 must reference only these filenames.

| Proposed file | Purpose and major sections | Dependencies | Decisions implemented architecturally | Still requires Product Owner approval |
|---|---|---|---|---|
| `FOUNDATION_V1_TARGET_ARCHITECTURE.md` | Context, runtime boundaries, layers, dependency rules, modular repository tree, legacy isolation, ADR index. | None — indexed by `FOUNDATION_V1_DISCOVERY_BASELINE.md` as an authoritative input. | 1, 2, 9, 10 | Final architecture and exact restructuring. |
| `FOUNDATION_V1_IDENTITY_AND_ACCESS.md` | Identity/session model, invitation states, membership lifecycle, recovery boundary, sequence diagrams. | `FOUNDATION_V1_TARGET_ARCHITECTURE.md` | 2–4 | Provider, invitation expiry/resend, recovery details. |
| `FOUNDATION_V1_TENANCY_AUTHORIZATION.md` | Tenant context, roles, permission vocabulary, policy evaluation, matrices, negative cases. | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_IDENTITY_AND_ACCESS.md` | 2–4 | Exact matrix and assignment rules. |
| `FOUNDATION_V1_LICENSING_ENTITLEMENTS.md` | Tenant status, plan/contract facts, seats, entitlements, suspension and reinstatement policy. | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_TENANCY_AUTHORIZATION.md` | 2–4 | Commercial state details and plan catalog. |
| `FOUNDATION_V1_DATA_MODEL.md` | Proposed entities, relationships, invariants, indexes, migration rules, version compatibility, open choices. | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_IDENTITY_AND_ACCESS.md`; `FOUNDATION_V1_TENANCY_AUTHORIZATION.md`; `FOUNDATION_V1_LICENSING_ENTITLEMENTS.md` | 1–7, 9 | Exact schema, database/access layer/provider. |
| `FOUNDATION_V1_DOCUMENT_STORAGE.md` | Private storage boundary, metadata/content split, access grants, provenance, integrity, replacement and deletion interface. | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_TENANCY_AUTHORIZATION.md`; `FOUNDATION_V1_DATA_MODEL.md` | 5, 6, 8 | Provider/region, file limits, scanning and keys. |
| `FOUNDATION_V1_DOCUMENT_LIFECYCLE.md` | Bill/CTE state machines, transitions, visibility, timestamps, permission points, invariants. | `FOUNDATION_V1_TENANCY_AUTHORIZATION.md`; `FOUNDATION_V1_DATA_MODEL.md`; `FOUNDATION_V1_DOCUMENT_STORAGE.md` | 5, 6 | Restore, cancellation, legal hold and exception details. |
| `FOUNDATION_V1_AUDIT_RETENTION.md` | Event catalog, minimum evidence, redaction, retention jobs, idempotency, retries, reconciliation, backup boundary. | `FOUNDATION_V1_TENANCY_AUTHORIZATION.md`; `FOUNDATION_V1_DATA_MODEL.md`; `FOUNDATION_V1_DOCUMENT_STORAGE.md`; `FOUNDATION_V1_DOCUMENT_LIFECYCLE.md` | 2–6, 9 | Audit retention, scheduler, legal hold, backup purge. |
| `FOUNDATION_V1_ENVIRONMENTS_PROVIDERS.md` | Environment matrix, configuration schema categories, provider ports/register, assessment and exit records. | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_DATA_MODEL.md`; `FOUNDATION_V1_DOCUMENT_STORAGE.md` | 5, 8, 9 | Every provider, region, transfer mechanism and environment authorization. |
| `FOUNDATION_V1_TESTING_RELEASE.md` | Test pyramid, synthetic fixtures, CI gates, migration checks, PR evidence, release records, rollback/recovery. | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_IDENTITY_AND_ACCESS.md`; `FOUNDATION_V1_TENANCY_AUTHORIZATION.md`; `FOUNDATION_V1_LICENSING_ENTITLEMENTS.md`; `FOUNDATION_V1_DATA_MODEL.md`; `FOUNDATION_V1_DOCUMENT_STORAGE.md`; `FOUNDATION_V1_DOCUMENT_LIFECYCLE.md`; `FOUNDATION_V1_AUDIT_RETENTION.md`; `FOUNDATION_V1_ENVIRONMENTS_PROVIDERS.md` | 1, 5, 6, 9 | Tooling, mandatory checks, reviewers, merge/deploy mechanism. |
| `FOUNDATION_V1_OBSERVABILITY_SECURITY.md` | Error taxonomy, redaction, monitoring boundary, trust model, threat register, incident dependencies. | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_TENANCY_AUTHORIZATION.md`; `FOUNDATION_V1_DOCUMENT_STORAGE.md`; `FOUNDATION_V1_AUDIT_RETENTION.md`; `FOUNDATION_V1_ENVIRONMENTS_PROVIDERS.md` | 1, 2, 5, 8, 9 | Monitoring provider, incident details, privacy documentation. |
| `FOUNDATION_V1_FUTURE_BOUNDARIES.md` | Provenance contracts and isolation boundaries for later PUN/OCR/AI/simulation modules; explicit non-scope. | `FOUNDATION_V1_TARGET_ARCHITECTURE.md`; `FOUNDATION_V1_DATA_MODEL.md`; `FOUNDATION_V1_DOCUMENT_STORAGE.md`; `FOUNDATION_V1_DOCUMENT_LIFECYCLE.md`; `FOUNDATION_V1_AUDIT_RETENTION.md`; `FOUNDATION_V1_ENVIRONMENTS_PROVIDERS.md`; `FOUNDATION_V1_OBSERVABILITY_SECURITY.md` | 1, 5–8, 10 | All future module implementation and provider decisions. |
| `FOUNDATION_V1_IMPLEMENTATION_ROADMAP.md` | Ordered phases, small commits, acceptance gates, dependencies, risk gates, blocking decisions. | Every preceding canonical discovery document in this table | 1, 9, 10 | Sequence approval, first phase, first PR, and code-change authorization. |

## 9. Conflicts and reconciliation findings

| Source | Conflict, ambiguity, duplication, or obsolete assumption | Authoritative resolution | Remaining action |
|---|---|---|---|
| `app/page.tsx` labels versus verified behavior | UI claims intelligent OCR, real CTE analysis, GME comparison, exact breakdown, and best offer; bill data is fixed, CTE parsing is regex, PUN is hardcoded, and calculations are partial. | Treat all such behavior as legacy prototype behavior, not production capability (`PROJECT_AUDIT.md`, sections 5–10; Decisions 1, 5, 7, 10). | Classify and isolate in architecture; remove or replace only after implementation authorization. |
| `PROJECT_AUDIT.md`, section 13 versus Decision 1 | Original milestone proposed one bill format, one CTE format, extraction evidence, and a limited calculation engine. | Decision 1 supersedes that scope: OCR, CTE extraction, PUN import, simulations, ranking, and reports are outside Foundation V1. | Do not carry the obsolete extraction/simulation scope into the roadmap. |
| `FOUNDATION_V1_PLAN.md`, sections 2 and 7 versus Decisions 2–4 | Plan initially described an organization model and authentication at a more generic level. | Decisions 2–4 require SaaS multi-tenancy, four roles, controlled invitations, licensing/entitlements, suspension, and server enforcement. | Replace generic assumptions with detailed tenancy, identity, and authorization discovery. |
| `FOUNDATION_V1_PLAN.md`, sections 7 and 13 versus Decisions 5, 6, and 8 | Plan contains recommendations about document safety but predates approved real-document, retention, and international-processing rules. | Apply Decisions 5, 6, and 8: synthetic-only ordinary environments, protected operational authorization, approved state/retention rules, and provider-by-provider assessment. | Design lifecycle, deletion, environment, and provider records; do not claim legal compliance. |
| `FOUNDATION_V1_PLAN.md`, sections 10–12 versus Decision 10 | Plan gives an implementation sequence and commit list that could be read as ready to execute. | Decision 10 authorizes discovery only. The sequence is a proposal and cannot start. | Produce and review detailed discovery documents, then seek separate implementation authorization. |
| `FOUNDATION_V1_PLAN.md`, sections 15–16 versus Decision 9 | The plan proposed Preview/Production and rollback workflow; Decision 9 now makes the controlled workflow authoritative while leaving exact controls pending. | Use Decision 9 for mandatory policy; retain plan details only as proposals. | Specify exact checks, reviewers, merge/deploy mechanism, and runbooks for approval. |
| `app/page.tsx` deletion versus Decision 6 | “Delete” only removes an in-memory CTE immediately and has no bill/CTE lifecycle or retention timing. | Decision 6 controls future lifecycle and deletion behavior. | Define state machines and idempotent scheduled deletion design. |
| Hardcoded PUN and bill values versus Decision 7 | Current calculation can use fixed values without official verification or exact eligibility enforcement. | Only verified official exact-month values may support future definitive simulation; simulations remain outside V1. | Define future immutable market-index boundary without implementing acquisition. |
| Provider lists in `FOUNDATION_V1_PLAN.md`, section 9 | Named services are alternatives, not approvals; costs and current capabilities may change. | Decision 8 and Decision 10 require provider neutrality and current provider-specific assessment. | Establish comparison criteria and ADR process; verify facts later when selection is authorized. |
| README and layout metadata versus intended product | Generic Create Next App text and metadata do not describe the energy platform. | This is verified legacy boilerplate, not an approved branding decision. | Keep branding/content decisions pending; change only in an authorized implementation phase. |

## 10. Open decision register

Only genuinely pending decisions are listed. “Blocks discovery” means detailed work cannot be completed responsibly, not that all other discovery must stop.

| Group | Pending decision | Why it matters | Decision deadline | Blocks discovery? | Blocks implementation? | Recommended owner |
|---|---|---|---|---|---|---|
| Architecture | Final target architecture and exact repository restructuring | Establishes module/runtime boundaries and migration shape. | After architecture document review | No | Yes | Product Owner with technical reviewer |
| Providers and regions | Each provider, service region, transfer mechanism, subprocessors, and exit terms | Determines adapters, operations, data location, and assessment scope. | Before integration design is finalized | Partly | Yes | Product Owner with security/privacy and technical review |
| Authentication | Identity provider, session mechanism, invitation lifetime/resend, and recovery workflow | Affects threat model, membership flow, and operational support. | Before identity implementation | No | Yes | Product Owner for workflow; technical team for approved implementation details |
| Database | Provider/region, query layer, migration tool, pooling/runtime strategy | Affects schema operations, testing, deployment, and portability. | Before database implementation | No | Yes | Product Owner approves provider; technical team proposes stack |
| Storage | Provider/region, access-grant mechanism, size/type limits, malware control, encryption/key responsibilities | Determines private document boundary and operations. | Before storage implementation or protected pilot | No | Yes | Product Owner with technical/security review |
| Authorization | Exact permission identifiers, role-permission matrix, assignment rules, and audit access | Required for consistent server enforcement and tests. | Before authorization implementation | Partly | Yes | Product Owner approves behavior; technical team formalizes |
| Subscriptions and licensing | Plans, default limits, grace/payment states, contract-expiry behavior, exceptions | Drives policy outcomes and seat/entitlement enforcement. | Before commercial enforcement implementation | Partly | Yes | Product Owner |
| Retention implementation | Legal hold, restore/cancel rules, exceptional retention, backup purge, scheduler, runbook | Completes safe deletion beyond approved base durations. | Before deletion automation or real-document pilot | Partly | Yes | Product Owner with privacy/operations/technical review |
| CI and release controls | Exact checks, branch protection, reviewers, merge strategy, deployment authorization, emergency authority, versioning | Converts Decision 9 into enforceable gates. | Before first application-code Pull Request | No | Yes | Product Owner and designated technical reviewer |
| Security and privacy | Lawful-processing documentation, pilot procedure, incident details, audit retention, provider assessments | Required before operational processing of protected data. | Before protected pilot or Production | No | Yes for real data | Product Owner with qualified privacy/security review |
| Implementation authorization | Approved architecture, sequence, first phase, first PR scope, branch controls, and permission to change code | Decision 10 expressly withholds implementation authority. | After discovery completion and review | No | Yes | Product Owner |

## 11. Risks and dependencies

| Risk | Cause | Consequence | Mitigation to design | Discovery workstream | Implementation gate |
|---|---|---|---|---|---|
| Tenant data leakage | Missing or inconsistent tenant scoping | Cross-company disclosure or mutation | Server-derived tenant context, scoped repositories, deny-by-default policy, negative tests | 3, 5, 15 | Cross-tenant suite must pass |
| Authorization defects | Role-name checks or client-only controls | Unauthorized operations | Granular policy matrix and server enforcement at every use case | 2, 3 | Authorization matrix approved and tests pass |
| Unsafe document URLs | Public or durable object links | Uncontrolled document access | Private storage, short-lived grants, authorization before access, cache rules | 6, 15 | Private-access tests pass |
| Destructive migrations | Incompatible schema/data changes | Loss or outage | Expand/contract patterns, compatibility matrix, rehearsal, roll-forward/rollback evidence | 5, 13 | Migration review and rehearsal pass |
| Incomplete deletion | Copies, caches, derived data, or references survive | Retention rule failure and inconsistent state | Deletion inventory, idempotent orchestration, reconciliation, minimal audit evidence | 7–9 | Deletion acceptance and retry tests pass |
| Provider lock-in | Provider SDKs spread through domain/application code | Costly or unsafe exit | Narrow ports, adapters, export format, provider register and exit design | 11 | Adapter boundary reviewed |
| Preview/Production contamination | Shared credentials, data, storage, jobs, or webhooks | Production impact or data disclosure | Environment matrix, fail-fast config, isolated resources, synthetic fixtures | 10, 12, 13 | Isolation verification passes |
| Accidental real-data use | Unclear environment status or copied fixtures | Protected data enters uncontrolled systems | Synthetic-only defaults, environment classification, upload guardrails, documented authorization | 10, 15 | No-real-data gate passes |
| Secret exposure | Client bundles, logs, CI output, or shared variables | Credential compromise | Server-only configuration, validation, masking, secret scanning, rotation process | 10, 12, 14 | Secret checks and bundle review pass |
| Unreliable scheduled jobs | Duplicate, missed, or partially failed execution | Retention and status transitions become incorrect | Idempotency keys, leases/uniqueness, retries, checkpoints, reconciliation and alerts | 9, 14 | Retry/idempotency tests pass |
| Audit gaps | Events omitted or mutable/incomplete records | Actions cannot be reconstructed | Central event taxonomy, transactional emission strategy, access controls, integrity checks | 8 | Required-event coverage passes |
| Future OCR provenance | Extracted values detached from source/evidence | Unverifiable calculations | Immutable source reference, extraction version/status, field evidence and review boundary | 6, 8, 16 | Future module cannot activate without provenance contract |
| Future PUN integrity | Wrong month/unit/source or silent correction | Incorrect definitive simulations | Unique month-band keys, explicit units, verification and revision history | 5, 8, 16 | Future import integrity suite passes |
| Legacy-code coupling | UI, parsing, state, and calculations remain intertwined | High regression risk and accidental scope leakage | Legacy isolation and strangler-style module boundaries after authorization | 1, 16 | No legacy dependency from new domain layer |
| Insufficient tests | No current automated suite | Defects reach Preview/Production | Layered test strategy, synthetic fixtures, negative authorization tests, release gates | 12 | Mandatory suite and build pass |

## 12. Recommended discovery order

1. **`FOUNDATION_V1_TARGET_ARCHITECTURE.md`** — first because it defines provider-neutral layers, boundaries, and document dependencies. It must use ports and capability requirements rather than require a provider decision.
2. **`FOUNDATION_V1_IDENTITY_AND_ACCESS.md`** — establishes identity, sessions, invitations, and membership states before permission or database detail.
3. **`FOUNDATION_V1_TENANCY_AUTHORIZATION.md`** — defines tenant context and policy semantics used by every later service.
4. **`FOUNDATION_V1_LICENSING_ENTITLEMENTS.md`** — adds commercial enforcement inputs without binding storage or database products.
5. **`FOUNDATION_V1_DATA_MODEL.md`** — models approved invariants after identity, tenancy, and licensing concepts stabilize.
6. **`FOUNDATION_V1_DOCUMENT_STORAGE.md`** — defines private content/provenance ports against the stable data and authorization model.
7. **`FOUNDATION_V1_DOCUMENT_LIFECYCLE.md`** — formalizes approved states and transitions using the data/storage boundaries.
8. **`FOUNDATION_V1_AUDIT_RETENTION.md`** — derives auditable events and deletion orchestration from all lifecycle operations.
9. **`FOUNDATION_V1_ENVIRONMENTS_PROVIDERS.md`** — maps isolation and provider-neutral adapter/assessment records after required capabilities are known.
10. **`FOUNDATION_V1_OBSERVABILITY_SECURITY.md`** — threat-models the complete set of trust boundaries and defines redacted errors.
11. **`FOUNDATION_V1_TESTING_RELEASE.md`** — converts the stable designs into verification and release gates.
12. **`FOUNDATION_V1_FUTURE_BOUNDARIES.md`** — checks that provenance, market data, and future engines have no architectural dead ends while remaining excluded.
13. **`FOUNDATION_V1_IMPLEMENTATION_ROADMAP.md`** — last, because phases and commits must follow the approved architecture and measurable gates rather than precede them.

This order reduces rework by resolving semantic boundaries before physical schemas, provider comparisons, test plans, or commit sequencing. Provider choices can be deferred until capability and assessment requirements are explicit.

## 13. Discovery completion criteria

Technical discovery is complete and ready for Product Owner architecture review only when:

1. every proposed discovery document is either complete or explicitly deferred with an owner and rationale;
2. every approved Decision 1–10 maps to architecture components, invariants, verification evidence, and affected documents;
3. all repository statements are marked as verified facts, inferences, or unknowns where appropriate;
4. the target architecture defines server/client boundaries, layers, dependency direction, legacy isolation, and provider-neutral ports;
5. identity, invitation, membership, tenant, role, permission, seat, entitlement, and suspension semantics are mutually consistent;
6. the proposed data model expresses tenant ownership, lifecycle timestamps, approved retention rules, provenance, and audit references;
7. document storage and access are private by design and deletion scope includes required copies and operational derivatives;
8. environment isolation and synthetic-data rules are defined for Local, CI, Preview, protected pilot, and Production;
9. the threat analysis covers the risk register in section 11 and links each material risk to a mitigation and implementation gate;
10. testing, CI, migration, release, rollback, and recovery criteria are measurable;
11. no excluded OCR, AI, CTE extraction, PUN acquisition, simulation, comparison, ranking, or reporting feature has entered Foundation V1 scope;
12. provider alternatives remain non-binding and every operational provider requires the Decision 8 assessment;
13. all unresolved choices are present in a decision register with owner, deadline, and blocking status;
14. conflicts with the audit, plan, prototype, and approved decisions are explicitly reconciled;
15. the implementation roadmap proposes small reviewable phases but is clearly marked **NOT AUTHORIZED**;
16. a designated technical review and Product Owner review have been completed and their unresolved findings are recorded;
17. the Product Owner has enough evidence to approve, reject, or request changes to the architecture and first implementation phase.

Completion of these criteria does not itself authorize implementation.

## 14. Explicit non-authorizations

This document does not authorize:

- application-code changes;
- dependency installation or updates;
- database creation or migration execution;
- provider account creation or final provider selection;
- real-document processing;
- OCR or AI activation;
- GME acquisition;
- electricity or gas simulations;
- creation of a Pull Request;
- merge into `main`;
- Production deployment or Production-use authorization.

No implementation action was performed while producing this baseline. Any future repository document must be separately instructed, and any future application-code change requires the separate implementation authorization required by Product Owner Decision 10.
