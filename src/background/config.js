const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export async function getAgentConfig() {
  const stored = await chrome.storage.local.get([
    "anthropicApiKey",
    "anthropicModel",
    "tinyfishApiKey"
  ]);

  return {
    anthropicApiKey: stored.anthropicApiKey || "",
    anthropicModel: stored.anthropicModel || DEFAULT_MODEL,
    tinyfishApiKey: stored.tinyfishApiKey || ""
  };
}

export async function saveAgentConfig(config) {
  const current = await getAgentConfig();

  await chrome.storage.local.set({
    anthropicApiKey: String(config.anthropicApiKey || "").trim() || current.anthropicApiKey,
    anthropicModel: String(config.anthropicModel || "").trim() || DEFAULT_MODEL,
    tinyfishApiKey: String(config.tinyfishApiKey || "").trim() || current.tinyfishApiKey
  });
}

export async function clearAgentKeys() {
  await chrome.storage.local.remove(["anthropicApiKey", "tinyfishApiKey"]);
}
