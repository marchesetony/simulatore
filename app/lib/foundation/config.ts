export type FoundationEnvironment = "LOCAL" | "CI" | "PREVIEW" | "PRODUCTION";

export class ServerSecretCapability {
  private constructor(private readonly marker: "SERVER_ONLY") {
    Object.freeze(this);
  }

  static fromValidatedSecret(secret: unknown): ServerSecretCapability | null {
    if (typeof secret !== "string" || secret.trim().length < 16) return null;
    return new ServerSecretCapability("SERVER_ONLY");
  }

  toJSON(): { readonly kind: "SERVER_ONLY" } {
    return { kind: this.marker };
  }
}

export interface FoundationConfig {
  readonly environment: FoundationEnvironment;
  readonly sessionLifetimeSeconds: number;
  readonly invitationLifetimeSeconds: number;
  readonly serverCapability: ServerSecretCapability;
}

export interface FoundationConfigInput {
  readonly environment?: string;
  readonly sessionLifetimeSeconds?: number;
  readonly invitationLifetimeSeconds?: number;
  readonly serverSecret?: unknown;
  readonly clientVisibleSecrets?: ReadonlyArray<unknown>;
}

export type ConfigResult =
  | { readonly valid: true; readonly config: FoundationConfig }
  | { readonly valid: false; readonly errors: ReadonlyArray<string> };

function isEnvironment(value: string | undefined): value is FoundationEnvironment {
  return value === "LOCAL" || value === "CI" || value === "PREVIEW" || value === "PRODUCTION";
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function validateConfig(input: FoundationConfigInput): ConfigResult {
  const errors: string[] = [];
  const environment = input.environment;
  const sessionLifetimeSeconds = input.sessionLifetimeSeconds;
  const invitationLifetimeSeconds = input.invitationLifetimeSeconds;
  const serverCapability = ServerSecretCapability.fromValidatedSecret(input.serverSecret);

  if (!isEnvironment(environment)) errors.push("ENVIRONMENT_INVALID");
  if (!isPositiveFinite(sessionLifetimeSeconds)) errors.push("SESSION_LIFETIME_INVALID");
  if (!isPositiveFinite(invitationLifetimeSeconds)) errors.push("INVITATION_LIFETIME_INVALID");
  if (!serverCapability) errors.push("SERVER_SECRET_INVALID");
  if ((input.clientVisibleSecrets ?? []).length > 0) errors.push("CLIENT_SECRET_FORBIDDEN");
  if (errors.length > 0 || !isEnvironment(environment) || !isPositiveFinite(sessionLifetimeSeconds) || !isPositiveFinite(invitationLifetimeSeconds) || !serverCapability) {
    return { valid: false, errors: errors.length > 0 ? errors : ["CONFIGURATION_INVALID"] };
  }
  return {
    valid: true,
    config: { environment, sessionLifetimeSeconds, invitationLifetimeSeconds, serverCapability },
  };
}
