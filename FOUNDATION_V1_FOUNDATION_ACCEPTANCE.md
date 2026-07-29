# Foundation V1 core acceptance evidence

## Authorized test bench

The test bench is exposed only when the existing homepage is opened with `?foundation=1`. The normal graphical report at `/` is unchanged. The bench is synthetic-only, in-memory, provider-neutral, and deny-by-default. It does not implement real authentication, persistence, providers, database access, secrets, real data, OCR, extraction, calculations, comparison, reports, PDF generation, or Production behavior.

## Acceptance matrix

| Area | Required evidence | Pass condition |
| --- | --- | --- |
| Session lifecycle | five clickable session scenarios | valid passes; expired, revoked, rotated, and malformed deny |
| Invitation lifecycle | six clickable invitation scenarios | valid accepts; expired, revoked, replayed, wrong-tenant, and malformed deny |
| Membership | four clickable membership scenarios | active resolves; inactive, cross-tenant, and malformed deny |
| Roles and permissions | ten role outcomes plus malformed request | every approved role has an allowed and denied permission result |
| Safe evidence | response evidence object for every scenario | typed operation/target, safe correlation, no secret/token/document content |
| UI boundary | `/` and `?foundation=1` comparison | report unchanged; bench is visible only for the explicit query flag |
| Failure behavior | unknown scenario, wrong method, and malformed request | HTTP denial with redacted error and no input echo |

## Verification checklist

1. Run `npx tsc --noEmit`, `npm run lint`, and `npm run build`.
2. Open `/` and confirm the graphical report is unchanged.
3. Open `/?foundation=1`, execute every card, and confirm visible scenario, request, expected result, actual result, PASS/FAIL, and audit evidence.
4. Confirm no network request leaves the application, no browser persistence is written, and no provider or real-data path exists.
5. Confirm routes accept only the identifiers in `FOUNDATION_V1_SYNTHETIC_FIXTURES.md`.

## Acceptance boundary and rollback

This evidence documents the synthetic testable subset only. It does not authorize Production, real authentication, providers, persistence, real data, or future capabilities. Rollback removes the four route handlers, restores `app/page.tsx`, `app/layout.tsx`, and `app/globals.css` to their prior approved contents, and removes both Foundation test documents without touching unrelated history or resources.
