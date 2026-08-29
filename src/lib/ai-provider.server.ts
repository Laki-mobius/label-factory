import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Shared AI provider resolution for every feature that used to call the
 * Lovable AI Gateway (Reward AI, prelabel/extraction, field suggestions,
 * synthetic data generation).
 *
 * Both OpenAI and Google Gemini expose an OpenAI-compatible chat completions
 * endpoint, so we can keep using `@ai-sdk/openai-compatible` for both and
 * avoid pulling in extra SDK packages. Preference order: OpenAI first (if
 * OPENAI_API_KEY is set), falling back to Gemini (GEMINI_API_KEY).
 */

type Provider = "openai" | "gemini";

const DEFAULT_MODEL: Record<Provider, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
};

function activeProvider(): Provider {
  if (process.env["OPENAI_API_KEY"]) return "openai";
  if (process.env["GEMINI_API_KEY"]) return "gemini";
  throw new Error(
    "AI is not configured for this project. Set OPENAI_API_KEY or GEMINI_API_KEY in your .env.",
  );
}

function clientFor(provider: Provider) {
  if (provider === "openai") {
    return createOpenAICompatible({
      name: "openai",
      baseURL: "https://api.openai.com/v1",
      apiKey: process.env["OPENAI_API_KEY"]!,
    });
  }
  return createOpenAICompatible({
    name: "gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: process.env["GEMINI_API_KEY"]!,
  });
}

/** Strips a Lovable-style "vendor/model" prefix (e.g. "google/gemini-2.5-flash")
 *  down to the bare model id the direct provider APIs expect. */
function bareModelId(model: string): string {
  const slash = model.indexOf("/");
  return slash === -1 ? model : model.slice(slash + 1);
}

/**
 * Resolves a ready-to-use AI SDK model for `generateText({ model: ... })`.
 * Pass the raw model string stored on a label profile (or undefined/null to
 * use the active provider's default).
 */
export function resolveAiModel(modelOverride?: string | null) {
  const provider = activeProvider();
  const requested =
    modelOverride && modelOverride.trim().length > 0
      ? bareModelId(modelOverride.trim())
      : DEFAULT_MODEL[provider];
  return clientFor(provider)(requested);
}

/** Default model name for whichever provider is currently configured. */
export function defaultAiModel(): string {
  return DEFAULT_MODEL[activeProvider()];
}

/**
 * Read-only status for display purposes — e.g. showing what a label
 * profile's "Default — active provider" model choice actually resolves to.
 */
export function activeProviderInfo(): { provider: Provider | null; model: string | null; label: string } {
  try {
    const provider = activeProvider();
    const model = DEFAULT_MODEL[provider];
    const label = provider === "openai" ? `OpenAI (${model})` : `Gemini (${model})`;
    return { provider, model, label };
  } catch {
    return { provider: null, model: null, label: "Not configured — set OPENAI_API_KEY or GEMINI_API_KEY" };
  }
}

export type { Provider as AiProvider };

/**
 * Model catalog for the Benchmarking screen's model-comparison mode, where a
 * user picks 2-3 CONCRETE models to run side by side (unlike resolveAiModel's
 * single active-provider-with-fallback behavior used everywhere else).
 */
export type BenchmarkModelChoice = { provider: Provider; modelId: string; label: string };

export const BENCHMARK_MODEL_CATALOG: BenchmarkModelChoice[] = [
  { provider: "openai", modelId: "gpt-4o-mini", label: "GPT-4o mini" },
  { provider: "openai", modelId: "gpt-4o", label: "GPT-4o" },
  { provider: "gemini", modelId: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { provider: "gemini", modelId: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
];

/** Only the catalog entries whose provider actually has an API key configured. */
export function availableBenchmarkModels(): BenchmarkModelChoice[] {
  return BENCHMARK_MODEL_CATALOG.filter((choice) =>
    choice.provider === "openai"
      ? Boolean(process.env["OPENAI_API_KEY"])
      : Boolean(process.env["GEMINI_API_KEY"]),
  );
}

/**
 * Resolves a specific model on a specific provider, bypassing the
 * primary/fallback selection — used only where the point is to compare named
 * models against each other (Benchmarking's model-comparison mode).
 */
export function resolveExplicitModel(provider: Provider, modelId: string) {
  const key = provider === "openai" ? process.env["OPENAI_API_KEY"] : process.env["GEMINI_API_KEY"];
  if (!key) {
    throw new Error(
      `${provider === "openai" ? "OpenAI" : "Gemini"} is not configured (missing API key).`,
    );
  }
  return clientFor(provider)(modelId);
}

/**
 * Resolves a model from a label profile's stored `model_config` (a real,
 * user-chosen {provider, model} pair — see label-profile.tsx's "Model
 * Selection for Entire Workflow" picker). Falls back to the active
 * provider's default whenever the config is empty, malformed, or its
 * provider's API key is no longer configured (e.g. removed after the
 * profile was saved) — a stale choice degrades gracefully instead of
 * throwing.
 */
export function resolveModelConfig(config: unknown) {
  const row = (config ?? {}) as { provider?: unknown; model?: unknown };
  const provider = row.provider === "openai" || row.provider === "gemini" ? row.provider : null;
  const modelId = typeof row.model === "string" && row.model.trim().length > 0 ? row.model.trim() : null;
  if (provider && modelId) {
    try {
      return resolveExplicitModel(provider, modelId);
    } catch {
      // Fall through — the chosen provider's key is missing now.
    }
  }
  return resolveAiModel();
}
