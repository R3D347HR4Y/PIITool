export interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model?: string;
}

export interface PiiToolConfig {
  vaultPath: string;
  detectorMode: "regex" | "local_llm" | "hybrid";
  ollama: ProviderConfig;
  upstream: ProviderConfig;
  gatewayPort: number;
  reviewMode: "auto" | "queue";
  failClosed: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PiiToolConfig {
  return {
    vaultPath: env.PIITOOL_VAULT_PATH ?? "./piitool.sqlite",
    detectorMode: (env.PIITOOL_DETECTOR_MODE as PiiToolConfig["detectorMode"]) ?? "hybrid",
    ollama: {
      baseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      model: env.PIITOOL_DETECTOR_MODEL ?? "qwen2.5:7b",
    },
    upstream: {
      baseUrl: env.PIITOOL_UPSTREAM_BASE_URL ?? "https://api.openai.com",
      apiKey: env.PIITOOL_UPSTREAM_API_KEY ?? env.OPENAI_API_KEY,
      model: env.PIITOOL_UPSTREAM_MODEL,
    },
    gatewayPort: Number(env.PIITOOL_GATEWAY_PORT ?? 4317),
    reviewMode: (env.PIITOOL_REVIEW_MODE as PiiToolConfig["reviewMode"]) ?? "auto",
    failClosed: env.PIITOOL_FAIL_CLOSED === "1",
  };
}
