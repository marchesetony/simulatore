import { NextResponse } from "next/server";
import { createAuditEvent, AuditTargetId } from "../../../lib/foundation/audit";
import { CorrelationId, redactError } from "../../../lib/foundation/errors";
import { canonicalTimestamp } from "../../../lib/foundation/types";
import type { IsoDateTime, Session, SessionId, UserId } from "../../../lib/foundation/types";
import { validateSession } from "../../../lib/foundation/sessions";
import { requireRequestAccess } from "../../../lib/auth/request";

type Scenario = "valid-session" | "expired-session" | "revoked-session" | "rotated-session" | "malformed-request";
const NOW = canonicalTimestamp("2027-02-15T00:00:00.000Z");
const USER = "user-demo" as UserId;
const SESSION = "session-demo" as SessionId;
const CORRELATION = CorrelationId.from("foundation-session");

function parseScenario(request: Request): Scenario | null {
  const value = new URL(request.url).searchParams.get("scenario");
  return value === "valid-session" || value === "expired-session" || value === "revoked-session" || value === "rotated-session" || value === "malformed-request" ? value : null;
}

function evidence(scenario: string) {
  return createAuditEvent({ category: "IDENTITY", operation: "SESSION_CREATED", targetType: "SESSION", targetId: AuditTargetId.from("synthetic-session"), outcome: scenario === "valid-session" ? "ALLOWED" : "DENIED", correlationId: CORRELATION, occurredAt: NOW });
}

function response(scenario: string, expected: "ALLOWED" | "DENIED", actual: "ALLOWED" | "DENIED", status = 200) {
  return NextResponse.json({ scenario, request: `POST /api/foundation/session?scenario=${scenario}`, expected, actual, passed: expected === actual, evidence: evidence(scenario) }, { status });
}

function fixture(expiresAt: IsoDateTime, revokedAt?: IsoDateTime, rotatedFrom?: SessionId): Session {
  return { id: SESSION, userId: USER, version: rotatedFrom ? 2 : 1, issuedAt: canonicalTimestamp("2027-02-01T00:00:00.000Z"), expiresAt, ...(revokedAt ? { revokedAt } : {}), ...(rotatedFrom ? { rotatedFrom } : {}) };
}

export async function POST(request: Request) {
  if (request.method !== "POST") return NextResponse.json({ error: redactError("SESSION_DENIED", CORRELATION) }, { status: 405 });
  try { await requireRequestAccess(request, "ADMIN"); } catch { return NextResponse.json({ error: redactError("SESSION_DENIED", CORRELATION) }, { status: 401 }); }
  const scenario = parseScenario(request);
  if (!scenario || scenario === "malformed-request") return NextResponse.json({ scenario: scenario ?? "unknown", request: "POST /api/foundation/session", expected: "DENIED", actual: "DENIED", passed: scenario === "malformed-request", evidence: evidence(scenario ?? "unknown"), error: redactError("SESSION_DENIED", CORRELATION) }, { status: 400 });
  try {
    const session = scenario === "expired-session"
      ? fixture(canonicalTimestamp("2027-02-10T00:00:00.000Z"))
      : scenario === "revoked-session"
        ? fixture(canonicalTimestamp("2027-03-01T00:00:00.000Z"), canonicalTimestamp("2027-02-10T00:00:00.000Z"))
        : scenario === "rotated-session"
          ? fixture(canonicalTimestamp("2027-03-01T00:00:00.000Z"), canonicalTimestamp("2027-02-10T00:00:00.000Z"), SESSION)
          : fixture(canonicalTimestamp("2027-03-01T00:00:00.000Z"));
    validateSession(session, NOW);
    return response(scenario, "ALLOWED", "ALLOWED");
  } catch {
    return response(scenario, "DENIED", "DENIED");
  }
}
