import { runAgentTurn } from "./agent.js";
import { clearAgentKeys, getAgentConfig, saveAgentConfig } from "./config.js";
import { getFifaPlayersCache, refreshFifaPlayersCache } from "./fifa-player-cache.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getActivePageContext(tab) {
  if (!tab?.id || !tab.url || tab.url.startsWith("chrome://")) {
    return null;
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_PAGE_CONTEXT" });
  } catch {
    return {
      title: tab.title || "",
      url: tab.url
    };
  }
}

function safePostPortMessage(port, message) {
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_AGENT_CONFIG") {
    getAgentConfig()
      .then((config) => {
        sendResponse({
          llmProvider: config.llmProvider,
          openRouterApiKey: config.openRouterApiKey ? "configured" : "",
          openRouterModel: config.openRouterModel,
          openAiApiKey: config.openAiApiKey ? "configured" : "",
          openAiModel: config.openAiModel,
          anthropicApiKey: config.anthropicApiKey ? "configured" : "",
          anthropicModel: config.anthropicModel,
          tinyfishApiKey: config.tinyfishApiKey ? "configured" : ""
        });
      })
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === "SAVE_AGENT_CONFIG") {
    saveAgentConfig(message.config || {})
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === "CLEAR_AGENT_KEYS") {
    clearAgentKeys()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === "GET_FIFA_PLAYERS_CACHE_STATUS") {
    getFifaPlayersCache()
      .then((cache) => sendResponse({
        ok: true,
        fetchedAt: cache.fetchedAt,
        count: cache.count,
        url: cache.url
      }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "REFRESH_FIFA_PLAYERS_CACHE") {
    refreshFifaPlayersCache()
      .then((cache) => sendResponse({
        ok: true,
        fetchedAt: cache.fetchedAt,
        count: cache.count,
        url: cache.url
      }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "AGENT_CHAT") {
    (async () => {
      const activeTab = await getActiveTab();
      const pageContext = await getActivePageContext(activeTab);
      const result = await runAgentTurn({
        messages: message.messages || [],
        userMessage: String(message.userMessage || ""),
        pageContext,
        activeTabId: activeTab?.id
      });
      sendResponse({ ok: true, ...result });
    })().catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Agent turn failed."
      });
    });
    return true;
  }

  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "agent-chat") {
    return;
  }

  port.onMessage.addListener((message) => {
    if (message?.type !== "AGENT_CHAT") {
      return;
    }

    (async () => {
      const activeTab = await getActiveTab();
      const pageContext = await getActivePageContext(activeTab);
      const result = await runAgentTurn({
        messages: message.messages || [],
        userMessage: String(message.userMessage || ""),
        pageContext,
        activeTabId: activeTab?.id,
        onEvent: (event) => safePostPortMessage(port, event)
      });

      safePostPortMessage(port, {
        type: "final",
        assistant: result.assistant,
        toolTraces: result.toolTraces
      });
    })().catch((error) => {
      safePostPortMessage(port, {
        type: "error",
        error: error instanceof Error ? error.message : "Agent turn failed."
      });
    });
  });
});
