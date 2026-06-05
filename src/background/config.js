const DEFAULT_MODEL = "anthropic/claude-3.5-haiku";
const DEFAULT_PROVIDER = "openrouter";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const SUPPORTED_PROVIDERS = new Set(["openrouter", "openai", "anthropic"]);

function normalizeProvider(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  return SUPPORTED_PROVIDERS.has(normalized) ? normalized : DEFAULT_PROVIDER;
}

export async function getAgentConfig() {
  const stored = await chrome.storage.local.get([
    "llmProvider",
    "openRouterApiKey",
    "openRouterModel",
    "openAiApiKey",
    "openAiModel",
    "anthropicApiKey",
    "anthropicModel",
    "tinyfishApiKey"
  ]);

  return {
    llmProvider: normalizeProvider(stored.llmProvider),
    openRouterApiKey: stored.openRouterApiKey || "",
    openRouterModel: stored.openRouterModel || DEFAULT_MODEL,
    openAiApiKey: stored.openAiApiKey || "",
    openAiModel: stored.openAiModel || DEFAULT_OPENAI_MODEL,
    anthropicApiKey: stored.anthropicApiKey || "",
    anthropicModel: stored.anthropicModel || DEFAULT_ANTHROPIC_MODEL,
    tinyfishApiKey: stored.tinyfishApiKey || ""
  };
}

export async function saveAgentConfig(config) {
  const current = await getAgentConfig();

  await chrome.storage.local.set({
    llmProvider: normalizeProvider(config.llmProvider || current.llmProvider),
    openRouterApiKey: String(config.openRouterApiKey || "").trim() || current.openRouterApiKey,
    openRouterModel: String(config.openRouterModel || "").trim() || DEFAULT_MODEL,
    openAiApiKey: String(config.openAiApiKey || "").trim() || current.openAiApiKey,
    openAiModel: String(config.openAiModel || "").trim() || DEFAULT_OPENAI_MODEL,
    anthropicApiKey: String(config.anthropicApiKey || "").trim() || current.anthropicApiKey,
    anthropicModel: String(config.anthropicModel || "").trim() || DEFAULT_ANTHROPIC_MODEL,
    tinyfishApiKey: String(config.tinyfishApiKey || "").trim() || current.tinyfishApiKey
  });
}

export async function clearAgentKeys() {
  await chrome.storage.local.remove([
    "openRouterApiKey",
    "openAiApiKey",
    "tinyfishApiKey",
    "anthropicApiKey"
  ]);
}
