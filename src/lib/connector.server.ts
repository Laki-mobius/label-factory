import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Vault key for connector credentials. Absence is a hard failure: we never fall
 * back to storing an API key as plaintext.
 */
function vaultKey(): Buffer {
  const raw = process.env["CONNECTOR_VAULT_KEY"];
  if (!raw || raw.length < 32) {
    throw new Error(
      "CONNECTOR_VAULT_KEY is not configured. Credentials cannot be stored without an encryption key.",
    );
  }
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function decryptSecret(stored: string): string {
  const buffer = Buffer.from(stored, "base64");
  const decipher = createDecipheriv("aes-256-gcm", vaultKey(), buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8");
}

/** Only ever store/show the tail of a credential. */
export function maskHint(secret: string): string {
  const tail = secret.slice(-4);
  return tail.length === 4 ? `••••••••${tail}` : "••••••••";
}

export type ConnectorConfig = {
  provider: string;
  modelName: string;
  baseUrl: string | null;
  authType: string;
  apiKey: string | null;
  customHeaders: Record<string, string>;
};

export function defaultBaseUrl(provider: string) {
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1";
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "google":
      return "https://generativelanguage.googleapis.com/v1beta";
    case "lovable":
      return "https://ai.gateway.lovable.dev/v1";
    default:
      return "";
  }
}

function authHeaders(config: ConnectorConfig): Record<string, string> {
  const key = config.apiKey ?? "";
  if (config.authType === "none" || !key) return {};
  if (config.authType === "x-api-key") return { "x-api-key": key, "anthropic-version": "2023-06-01" };
  if (config.authType === "api-key") return { "api-key": key };
  return { Authorization: `Bearer ${key}` };
}

/** Validates a connector config against the provider without persisting anything. */
export async function probeConnector(config: ConnectorConfig) {
  const base = (config.baseUrl || defaultBaseUrl(config.provider)).replace(/\/$/, "");
  if (!base) throw new Error("A base URL is required for this provider.");

  const url = `${base}/models`;
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...authHeaders(config), ...config.customHeaders },
    });
  } catch (error) {
    throw new Error(
      `Could not reach ${url}: ${error instanceof Error ? error.message : "network error"}`,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Provider responded ${response.status}: ${text.slice(0, 300)}`);
  }

  let modelSeen: boolean | null = null;
  try {
    const parsed = JSON.parse(text) as { data?: { id?: string }[] };
    if (Array.isArray(parsed.data)) {
      modelSeen = parsed.data.some((entry) => entry.id === config.modelName);
    }
  } catch {
    modelSeen = null;
  }

  return {
    ok: true as const,
    status: response.status,
    latencyMs: Date.now() - started,
    endpoint: url,
    modelSeen,
  };
}
