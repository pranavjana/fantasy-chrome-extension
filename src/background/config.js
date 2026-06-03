const DEFAULT_MODEL = "anthropic/claude-3.5-haiku";

export async function getAgentConfig() {
  const stored = await chrome.storage.local.get([
    "openRouterApiKey",
    "openRouterModel",
    "tinyfishApiKey"
  ]);

  return {
    openRouterApiKey: stored.openRouterApiKey || "",
    openRouterModel: stored.openRouterModel || DEFAULT_MODEL,
    tinyfishApiKey: stored.tinyfishApiKey || ""
  };
}

export async function saveAgentConfig(config) {
  const current = await getAgentConfig();

  await chrome.storage.local.set({
    openRouterApiKey: String(config.openRouterApiKey || "").trim() || current.openRouterApiKey,
    openRouterModel: String(config.openRouterModel || "").trim() || DEFAULT_MODEL,
    tinyfishApiKey: String(config.tinyfishApiKey || "").trim() || current.tinyfishApiKey
  });
}

export async function clearAgentKeys() {
  await chrome.storage.local.remove([
    "openRouterApiKey",
    "tinyfishApiKey",
    "anthropicApiKey",
    "anthropicModel"
  ]);
}
