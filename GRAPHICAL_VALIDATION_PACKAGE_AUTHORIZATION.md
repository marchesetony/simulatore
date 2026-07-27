# Graphical Validation Package Authorization

## Status and purpose

This is a proposed authorization package for Product Owner approval. It describes one reversible, synthetic-only, presentation-only graphical prototype. It authorizes no implementation.

- **Current status:** AUTHORIZATION_PENDING
- **Implementation status:** NOT AUTHORIZED
- **Required approval:** explicit Product Owner approval of this exact perimeter
- **Source precedence:** Product Owner Decisions 1–11, repository facts, canonical Foundation V1 documents, then this proposal

## Proposed package

The package validates desktop and mobile presentation before any functional package. It uses fixed synthetic fixtures and may show a local logo preview in browser memory. It has no server upload, persistence, tenant storage, provider call, network request, or real company logo requirement.

### Exact application perimeter

Repository inspection identifies the current application as a single client component in `app/page.tsx`, global presentation styles in `app/globals.css`, and document metadata in `app/layout.tsx`.

- **Proposed modified existing files:** `app/page.tsx` and `app/globals.css` only.
- **Proposed new application files:** none.
- **Proposed screens:** the existing application screen gains a synthetic comparison-result view and an A4 print-oriented preview state; no new route is proposed.
- **Proposed components:** local logo selector/preview, comparison summary, comparison table, expiry-state display, and print-preview presentation regions within the existing screen boundary.
- **Dependencies:** zero new dependencies proposed. No framework, SDK, library, PDF engine, OCR system, provider, storage mechanism, or calculation mechanism is selected.
- **Excluded files:** `app/layout.tsx`, package files, configuration, public assets, and all unrelated prototype behavior remain outside the package.

### Logo presentation

The user may select a local image for immediate browser-memory preview, replace it, or remove it. The package performs no upload, persistence, tenant association, storage, or server access. A fictional placeholder logo is sufficient for validation; no real company logo is required.

### Synthetic comparison screen

The screen uses one fixed fixture and displays current supplier/offer, proposed supplier/offer, POD or PDR, annual consumption, current and proposed annual estimated costs, euro saving or additional cost, percentage difference, expiry date, fixed/variable price, index, spread, fixed charges, duration, billing frequency, payment method, discounts/bonuses, services, other charges, assumptions, unavailable data, source-document/page placeholders, calculation date, and an estimate/non-guaranteed-saving warning. Values are precomputed fixture values; application logic performs no calculation, extraction, comparison, or inference.

## Synthetic fixture contract

The fixture is explicitly fictional: supplier `Aurora Energia Demo`, current offer `Demo Luce Base`, proposed supplier `Lumenica Demo`, proposed offer `Demo Variabile Chiara`, POD/PDR `POD-DEMO-0001`, annual consumption `12000 kWh`, current estimated annual cost `€2,400.00`, proposed estimated annual cost `€2,160.00`, difference `€240.00`, percentage `10%`, expiry `31/12/2027`, variable price, index `Indice Demo`, spread `€0.012/kWh`, fixed charges `€120/year`, duration `12 mesi`, monthly billing, bank transfer, synthetic discount `€50`, demo service, other charges `€0`, assumptions `consumo costante`, source document `bolletta-demo.pdf`, source page `2`, calculation date `01/01/2027`, and unavailable data `tax treatment not supplied`.

The fixture contains no real personal, tenant, supplier, customer, or commercial data. It is never labelled extracted, calculated, official, verified, or real.

## Expiry-date presentation states

1. **Present:** show the fixed synthetic expiry value with `bolletta-demo.pdf`, page `2`, as its source.
2. **Missing, unreadable, or ambiguous:** show exactly `Data di scadenza: non rilevata nel documento — verifica necessaria`.

No extraction, interpretation, derivation, activation-date arithmetic, duration arithmetic, contract-date inference, or other calculation is permitted.

## Visual PDF preview boundary

The package presents an A4 print-oriented preview only; it does not generate, download, or store a PDF. The preview contains the selected logo, report title, current/proposed summaries, comparison table, expiry, economic difference, offer details, source documents/pages, assumptions, unavailable data, and the estimate/non-guaranteed-saving warning. It must provide professional pagination and print readability.

## Graphical quality and states

Use linear professional typography, clear hierarchy, readable tables, restrained colour, accessible contrast, visible keyboard focus, responsive desktop/mobile layout, no horizontal overflow, and A4 print preview. Validate loading, empty, complete-result, present-expiry, and missing-expiry states.

## Strict exclusions

OCR, Bill/CTE extraction, expiry extraction or inference, calculations, logic-driven comparisons, PDF generation/download, database, persistence, storage, authentication, tenancy, providers, APIs, new dependencies, real documents, real data, Production, Vercel, GitHub settings, unrelated corrections, and functional-package work are excluded. All remain NOT AUTHORIZED.

## Verification contract

Approval evidence must cover desktop and mobile layout, logo select/preview/replace/remove, complete and missing-expiry states, A4 preview, overflow, hierarchy, readability, absence of calculation execution, absence of network requests, absence of persistence, absence of real-data paths, absence of PDF download, existing-application safety, and complete rollback.

## Rollback contract

Restore the pre-package versions of `app/page.tsx` and `app/globals.css`, remove no other file, leave package/configuration files untouched, verify the working tree against the approved baseline, and record rollback evidence. No history rewrite, provider action, or Production action is permitted.

## Product Owner approval block

Approval must explicitly cover the exact files (`app/page.tsx`, `app/globals.css`), screens/components, synthetic fixture, exclusions, verification contract, rollback contract, and zero-dependency boundary. Until signed approval exists: **Current status: AUTHORIZATION_PENDING; Implementation status: NOT AUTHORIZED.** Functional validation cannot begin until graphical approval and formal graphical-package closure are recorded.
