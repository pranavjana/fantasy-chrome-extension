const messagesEl = document.querySelector("#messages");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const sendButton = document.querySelector("#send-button");
const clearButton = document.querySelector("#clear-chat");
const clearKeysButton = document.querySelector("#clear-keys");
const settingsForm = document.querySelector("#settings-form");
const openRouterKey = document.querySelector("#openrouter-key");
const openRouterModel = document.querySelector("#openrouter-model");
const tinyfishKey = document.querySelector("#tinyfish-key");
const settingsStatus = document.querySelector("#settings-status");
const toolStatus = document.querySelector("#tool-status");

let messages = [];
let liveEvents = [];
let liveAssistantText = "";
let pendingAssistantDelta = "";
let streamRenderFrame = 0;

function resizeChatInput() {
  chatInput.style.height = "auto";
  chatInput.style.height = `${chatInput.scrollHeight}px`;
}

function createMessage(role, content) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString()
  };
}

function renderMessages() {
  const distanceFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  const shouldStickToBottom = distanceFromBottom < 80;

  messagesEl.textContent = "";

  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Ask a question to test popup to background agent communication. Configure keys for live OpenRouter and Tinyfish calls.";
    messagesEl.append(empty);
    return;
  }

  for (const message of messages) {
    if (message.role === "tool") {
      messagesEl.append(renderToolCard(message.trace));
      continue;
    }

    if (message.role === "assistant" && Array.isArray(message.toolTraces) && message.toolTraces.length) {
      for (const trace of message.toolTraces) {
        messagesEl.append(renderToolCard({ ...trace, status: "done" }));
      }
    }

    const node = document.createElement("div");
    node.className = `message ${message.role}`;
    const content = message.role === "assistant"
      ? renderMarkdown(message.content)
      : document.createElement("div");

    if (message.role !== "assistant") {
      content.textContent = message.content;
    }

    node.append(content);

    messagesEl.append(node);
  }

  for (const event of liveEvents) {
    if (event.role === "status") {
      messagesEl.append(renderThinkingCard(event.label));
    }

    if (event.role === "tool") {
      messagesEl.append(renderToolCard(event.trace));
    }
  }

  if (liveAssistantText) {
    const node = document.createElement("div");
    node.className = "message assistant streaming";
    const content = renderMarkdown(liveAssistantText);
    node.append(content);
    messagesEl.append(node);
  }

  if (shouldStickToBottom) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function flushAssistantDelta() {
  streamRenderFrame = 0;
  if (!pendingAssistantDelta) {
    return;
  }

  liveAssistantText += pendingAssistantDelta;
  pendingAssistantDelta = "";
  renderMessages();
}

function queueAssistantDelta(delta) {
  pendingAssistantDelta += delta;
  if (streamRenderFrame) {
    return;
  }

  streamRenderFrame = requestAnimationFrame(flushAssistantDelta);
}

function clearAssistantStream() {
  pendingAssistantDelta = "";
  liveAssistantText = "";
  if (streamRenderFrame) {
    cancelAnimationFrame(streamRenderFrame);
    streamRenderFrame = 0;
  }
}

function commitAssistantStream() {
  flushAssistantDelta();
  const content = liveAssistantText.trim();
  if (!content) {
    clearAssistantStream();
    return;
  }

  messages = [...messages, createMessage("assistant", content)];
  clearAssistantStream();
}

function appendInlineMarkdown(parent, text) {
  const pattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      parent.append(document.createTextNode(text.slice(cursor, match.index)));
    }

    const token = match[0];
    if (token.startsWith("[") && token.includes("](") && token.endsWith(")")) {
      const closeIndex = token.indexOf("](");
      const label = token.slice(1, closeIndex);
      const href = token.slice(closeIndex + 2, -1);
      const link = document.createElement("a");
      link.textContent = label;

      try {
        const url = new URL(href);
        if (url.protocol === "http:" || url.protocol === "https:") {
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noreferrer";
        }
      } catch {
        link.removeAttribute("href");
      }

      parent.append(link);
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else if (token.startsWith("*")) {
      const emphasis = document.createElement("em");
      emphasis.textContent = token.slice(1, -1);
      parent.append(emphasis);
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    parent.append(document.createTextNode(text.slice(cursor)));
  }
}

function renderParagraph(lines) {
  const paragraph = document.createElement("p");
  appendInlineMarkdown(paragraph, lines.join(" "));
  return paragraph;
}

function renderList(lines, ordered) {
  const list = document.createElement(ordered ? "ol" : "ul");

  for (const line of lines) {
    const item = document.createElement("li");
    const text = ordered
      ? line.replace(/^\d+\.\s+/, "")
      : line.replace(/^[-*]\s+/, "");
    appendInlineMarkdown(item, text);
    list.append(item);
  }

  return list;
}

function renderMarkdown(markdown) {
  const root = document.createElement("div");
  root.className = "markdown";

  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();

    if (!line) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const heading = document.createElement(`h${headingMatch[1].length + 2}`);
      appendInlineMarkdown(heading, headingMatch[2]);
      root.append(heading);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const listLines = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        listLines.push(lines[index].trim());
        index += 1;
      }
      root.append(renderList(listLines, false));
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const listLines = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        listLines.push(lines[index].trim());
        index += 1;
      }
      root.append(renderList(listLines, true));
      continue;
    }

    if (/^```/.test(line)) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }

      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.append(code);
      root.append(pre);
      continue;
    }

    const paragraphLines = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,3})\s+/.test(lines[index].trim()) &&
      !/^[-*]\s+/.test(lines[index].trim()) &&
      !/^\d+\.\s+/.test(lines[index].trim()) &&
      !/^```/.test(lines[index].trim())
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    root.append(renderParagraph(paragraphLines));
  }

  return root;
}

function formatToolMeta(trace) {
  if (trace.status === "running") {
    if (trace.name === "refresh_fifa_players") {
      return "Syncing official FIFA player data";
    }

    if (trace.name === "search_fifa_players") {
      const query = trace.input?.query || trace.input?.team || trace.input?.position || "";
      return query ? `Searching FIFA cache for "${query}"` : "Searching FIFA player cache";
    }

    if (trace.name === "get_fifa_player") {
      return "Reading player pricing and raw fields";
    }

    if (trace.name === "get_fifa_players_cache_status") {
      return "Checking local player cache";
    }

    if (trace.name === "tinyfish_search") {
      const query = trace.input?.query || "";
      return query ? `Searching "${query}"` : "Searching";
    }

    if (trace.name === "tinyfish_fetch") {
      return "Fetching pages";
    }

    return "Running";
  }

  if (trace.isError) {
    return trace.result?.error || "Tool failed";
  }

  if (trace.name === "tinyfish_search") {
    const query = trace.input?.query || trace.result?.query || "";
    const count = Array.isArray(trace.result?.results) ? trace.result.results.length : 0;
    return query ? `Searched "${query}" · ${count} results` : `Search complete · ${count} results`;
  }

  if (trace.name === "tinyfish_fetch") {
    const count = Array.isArray(trace.result?.results) ? trace.result.results.length : 0;
    return `Fetched ${count} page${count === 1 ? "" : "s"}`;
  }

  if (trace.name === "refresh_fifa_players" || trace.name === "get_fifa_players_cache_status") {
    return `${trace.result?.count ?? 0} FIFA players cached`;
  }

  if (trace.name === "search_fifa_players") {
    return `${trace.result?.count ?? 0} result${trace.result?.count === 1 ? "" : "s"} from ${trace.result?.totalCachedPlayers ?? 0} cached players`;
  }

  if (trace.name === "get_fifa_player") {
    return trace.result?.player ? `Loaded ${trace.result.player.name}` : "Player not found";
  }

  return "Tool complete";
}

function renderThinkingCard(label) {
  const node = document.createElement("div");
  node.className = "thinking-card";
  node.textContent = label;
  return node;
}

function renderToolCard(trace) {
  const toolCard = document.createElement("div");
  toolCard.className = `tool-card${trace.isError ? " error" : ""}${trace.status === "running" ? " running" : ""}`;

  const title = document.createElement("div");
  title.className = "tool-title";
  title.textContent = trace.name;

  const meta = document.createElement("div");
  meta.className = "tool-meta";
  meta.textContent = formatToolMeta(trace);

  toolCard.append(title, meta);
  return toolCard;
}

async function loadMessages() {
  const stored = await chrome.storage.local.get(["agentMessages"]);
  messages = Array.isArray(stored.agentMessages) ? stored.agentMessages : [];
  renderMessages();
}

async function persistMessages() {
  await chrome.storage.local.set({ agentMessages: messages.slice(-30) });
}

function sendRuntimeMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function loadConfigStatus() {
  const config = await sendRuntimeMessage({ type: "GET_AGENT_CONFIG" });
  if (config?.openRouterModel) {
    openRouterModel.value = config.openRouterModel;
  }
  openRouterKey.placeholder = config?.openRouterApiKey === "configured" ? "Configured" : "";
  tinyfishKey.placeholder = config?.tinyfishApiKey === "configured" ? "Configured" : "";
}

async function loadFifaCacheStatus() {
  try {
    toolStatus.textContent = "Syncing players";
    const status = await sendRuntimeMessage({ type: "GET_FIFA_PLAYERS_CACHE_STATUS" });
    if (status?.ok) {
      toolStatus.textContent = `${status.count} FIFA players cached`;
      return;
    }

    toolStatus.textContent = status?.error || "Player cache unavailable";
  } catch {
    toolStatus.textContent = "Player cache unavailable";
  }
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const userMessage = chatInput.value.trim();
  if (!userMessage) {
    return;
  }

  chatInput.value = "";
  resizeChatInput();
  sendButton.disabled = true;
  sendButton.textContent = "·";
  toolStatus.textContent = "Thinking";
  liveEvents = [{ role: "status", label: "Thinking..." }];
  clearAssistantStream();

  messages = [...messages, createMessage("user", userMessage)];
  renderMessages();
  await persistMessages();

  renderMessages();

  const port = chrome.runtime.connect({ name: "agent-chat" });

  port.onMessage.addListener(async (eventMessage) => {
    if (eventMessage.type === "thinking") {
      liveEvents = [{ role: "status", label: eventMessage.label || "Thinking..." }, ...liveEvents.filter((item) => item.role !== "status")];
      renderMessages();
      return;
    }

    if (eventMessage.type === "tool_start") {
      liveEvents = liveEvents.filter((item) => item.role !== "status");
      liveEvents = [
        ...liveEvents,
        {
          role: "tool",
          trace: {
            ...eventMessage.trace,
            status: "running"
          }
        }
      ];
      toolStatus.textContent = "Working";
      renderMessages();
      return;
    }

    if (eventMessage.type === "response_delta") {
      liveEvents = liveEvents.filter((item) => item.role !== "status");
      queueAssistantDelta(eventMessage.delta || "");
      toolStatus.textContent = "Responding";
      return;
    }

    if (eventMessage.type === "response_reset") {
      commitAssistantStream();
      renderMessages();
      return;
    }

    if (eventMessage.type === "tool_done") {
      liveEvents = liveEvents.map((item) => {
        if (item.role !== "tool" || item.trace.id !== eventMessage.trace.id) {
          return item;
        }

        return {
          role: "tool",
          trace: {
            ...eventMessage.trace,
            status: "done"
          }
        };
      });
      renderMessages();
      return;
    }

    if (eventMessage.type === "final") {
      flushAssistantDelta();
      const completedToolEvents = liveEvents.filter((item) => item.role === "tool");
      messages = [
        ...messages,
        ...completedToolEvents,
        createMessage("assistant", eventMessage.assistant)
      ];
      liveEvents = [];
      clearAssistantStream();
      toolStatus.textContent = "Ready";
      sendButton.disabled = false;
      sendButton.textContent = "↑";
      renderMessages();
      await persistMessages();
      port.disconnect();
      return;
    }

    if (eventMessage.type === "error") {
      messages = [...messages, createMessage("assistant", eventMessage.error || "Agent request failed.")];
      liveEvents = [];
      clearAssistantStream();
      toolStatus.textContent = "Error";
      sendButton.disabled = false;
      sendButton.textContent = "↑";
      renderMessages();
      await persistMessages();
      port.disconnect();
    }
  });

  port.postMessage({
    type: "AGENT_CHAT",
    userMessage,
    messages
  });
});

clearButton.addEventListener("click", async () => {
  messages = [];
  liveEvents = [];
  clearAssistantStream();
  await persistMessages();
  renderMessages();
});

chatInput.addEventListener("input", resizeChatInput);
chatInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
    return;
  }

  event.preventDefault();

  if (!sendButton.disabled) {
    chatForm.requestSubmit();
  }
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  settingsStatus.textContent = "";

  const config = {
    openRouterApiKey: openRouterKey.value,
    openRouterModel: openRouterModel.value,
    tinyfishApiKey: tinyfishKey.value
  };

  const response = await sendRuntimeMessage({
    type: "SAVE_AGENT_CONFIG",
    config
  });

  if (response?.error) {
    settingsStatus.textContent = response.error;
    return;
  }

  openRouterKey.value = "";
  tinyfishKey.value = "";
  settingsStatus.textContent = "Saved.";
  await loadConfigStatus();
});

clearKeysButton.addEventListener("click", async () => {
  settingsStatus.textContent = "";
  const response = await sendRuntimeMessage({ type: "CLEAR_AGENT_KEYS" });

  if (response?.error) {
    settingsStatus.textContent = response.error;
    return;
  }

  openRouterKey.value = "";
  tinyfishKey.value = "";
  openRouterKey.placeholder = "";
  tinyfishKey.placeholder = "";
  settingsStatus.textContent = "Keys cleared.";
});

await loadMessages();
await loadConfigStatus();
await loadFifaCacheStatus();
