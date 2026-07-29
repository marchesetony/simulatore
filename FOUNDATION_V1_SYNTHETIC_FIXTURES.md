# Foundation V1 synthetic fixtures

This file defines the fixed, fictional fixtures used only by the `?foundation=1` test bench. They are not extracted, calculated, persisted, uploaded, or representative of real people, companies, documents, or providers.

## Fixed identities and tenants

| Identifier | Value | Status |
| --- | --- | --- |
| User | `user-demo` / `demo@example.test` | active synthetic identity |
| Tenant A | `tenant-demo` | active synthetic tenant |
| Tenant B | `tenant-other` | separate synthetic tenant |
| Membership | `membership-demo` | active or suspended per scenario |
| Session | `session-demo`, version 1 | fixed synthetic session |
| Invitation | `invitation-demo`, digest `digest-demo` | fixed synthetic invitation |

## Scenario matrix

| Route | Closed scenario identifiers | Expected behavior |
| --- | --- | --- |
| `/api/foundation/session` | `valid-session`, `expired-session`, `revoked-session`, `rotated-session`, `malformed-request` | active validation succeeds only for the valid fixture; expired, revoked, rotated, and malformed requests deny |
| `/api/foundation/invitations` | `valid-invitation`, `expired-invitation`, `revoked-invitation`, `replayed-invitation`, `wrong-tenant-invitation`, `malformed-request` | only the valid invitation accepts; terminal, replay, wrong-tenant, and malformed cases deny |
| `/api/foundation/memberships` | `active-membership`, `inactive-membership`, `cross-tenant-membership`, `malformed-request` | only active membership in Tenant A resolves |
| `/api/foundation/authorization` | allowed and denied pairs for Product Owner, Platform Owner, Tenant Admin, Sales Manager, Sales Operator; `malformed-request` | each role has one permitted and one denied permission scenario |

Role scenario identifiers are exactly: `product-owner-allowed`, `product-owner-denied`, `platform-owner-allowed`, `platform-owner-denied`, `tenant-admin-allowed`, `tenant-admin-denied`, `sales-manager-allowed`, `sales-manager-denied`, `sales-operator-allowed`, and `sales-operator-denied`.

All requests are POST requests with the scenario in the query string. Unknown identifiers, other methods, arbitrary payloads, secrets, and tenant values fail closed with redacted errors.

## Evidence contract

Every executed scenario returns the closed scenario, request path, expected result, actual result, boolean PASS/FAIL, and a redacted audit event. Correlation and target identifiers are fixed safe values. No request body, token, secret, document content, or caller-supplied arbitrary data is echoed.

## Rollback

Remove the four route handlers and restore the two authorized application files. Delete this fixture document and its acceptance companion. No database, provider, deployment, or external resource is touched.
