import { runAgentTurn } from "./agent.js";
import { getAgentConfig, saveAgentConfig } from "./config.js";
import { getFifaPlayersCache, refreshFifaPlayersCache } from "./fifa-player-cache.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function getActivePageContext() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_AGENT_CONFIG") {
    getAgentConfig()
      .then((config) => {
        sendResponse({
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
      const pageContext = await getActivePageContext();
      const result = await runAgentTurn({
        messages: message.messages || [],
        userMessage: String(message.userMessage || ""),
        pageContext
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
      const pageContext = await getActivePageContext();
      const result = await runAgentTurn({
        messages: message.messages || [],
        userMessage: String(message.userMessage || ""),
        pageContext,
        onEvent: (event) => port.postMessage(event)
      });

      port.postMessage({
        type: "final",
        assistant: result.assistant,
        toolTraces: result.toolTraces
      });
    })().catch((error) => {
      port.postMessage({
        type: "error",
        error: error instanceof Error ? error.message : "Agent turn failed."
      });
    });
  });
});
