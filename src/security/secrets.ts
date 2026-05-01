const SECRET_ALIAS_RE = /\bPIITOOL_SECRET_[A-Fa-f0-9]{12}\b/gi;
const RAW_SECRET_RE =
  /\b(?:[A-Z][A-Z0-9_]*(?:API|TOKEN|SECRET|KEY|PASSWORD|PRIVATE)[A-Z0-9_]*\s*=\s*["']?[^"'\s]{8,}|sk-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9_-]{16,}|sk_test_[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/g;

export function containsSecretAlias(value: unknown): boolean {
  SECRET_ALIAS_RE.lastIndex = 0;
  return SECRET_ALIAS_RE.test(JSON.stringify(value ?? ""));
}

export function containsRawSecret(value: unknown): boolean {
  RAW_SECRET_RE.lastIndex = 0;
  return RAW_SECRET_RE.test(JSON.stringify(value ?? ""));
}

export function redactSecretsForGateway<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(RAW_SECRET_RE, "[SECRET_VALUE_REDACTED]") as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretsForGateway(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, redactSecretsForGateway(inner)]),
    ) as T;
  }
  return value;
}
