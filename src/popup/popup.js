const messagesEl = document.querySelector("#messages");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const sendButton = document.querySelector("#send-button");
const clearButton = document.querySelector("#clear-chat");
const clearKeysButton = document.querySelector("#clear-keys");
const settingsForm = document.querySelector("#settings-form");
const llmProvider = document.querySelector("#llm-provider");
const openRouterKey = document.querySelector("#openrouter-key");
const openRouterModel = document.querySelector("#openrouter-model");
const openAiKey = document.querySelector("#openai-key");
const openAiModel = document.querySelector("#openai-model");
const anthropicKey = document.querySelector("#anthropic-key");
const anthropicModel = document.querySelector("#anthropic-model");
const tinyfishKey = document.querySelector("#tinyfish-key");
const settingsStatus = document.querySelector("#settings-status");
const toolStatus = document.querySelector("#tool-status");

let messages = [];
let liveEvents = [];
let liveAssistantText = "";
let pendingAssistantDelta = "";
let streamRenderFrame = 0;

function sanitizeFantasyPrices(text) {
  return String(text || "").replace(/[$£€]\s*(\d+(?:\.\d+)?m\b)/gi, "$1");
}

function resizeChatInput() {
  chatInput.style.height = "auto";
  chatInput.style.height = `${chatInput.scrollHeight}px`;
}

function createMessage(role, content) {
  return {
    id: crypto.randomUUID(),
    role,
    content: role === "assistant" ? sanitizeFantasyPrices(content) : content,
    createdAt: new Date().toISOString()
  };
}

function createErrorMessage(error) {
  return {
    id: crypto.randomUUID(),
    role: "error",
    error: normalizeAgentError(error),
    createdAt: new Date().toISOString()
  };
}

function extractProviderError(rawError) {
  const text = String(rawError || "");
  const jsonStart = text.indexOf("{");
  if (jsonStart === -1) {
    return null;
  }

  try {
    return JSON.parse(text.slice(jsonStart));
  } catch {
    return null;
  }
}

function normalizeAgentError(rawError) {
  const text = String(rawError || "Agent request failed.");
  const providerPayload = extractProviderError(text);
  const providerMessage = providerPayload?.error?.message || text;
  const statusMatch = text.match(/\bstatus\s+(\d{3})\b/i);
  const retryMatch = providerMessage.match(/try again in\s+(\d+)\s*ms/i);
  const modelMatch = providerMessage.match(/for\s+([a-z0-9._:-]+)\s+in organization/i);

  if (statusMatch?.[1] === "429" || providerPayload?.error?.code === "rate_limit_exceeded") {
    const retryMs = retryMatch ? Number(retryMatch[1]) : null;
    const retryText = retryMs !== null
      ? retryMs < 1000 ? `${retryMs}ms` : `${(retryMs / 1000).toFixed(1)}s`
      : "a short moment";

    return {
      title: "Rate limit reached",
      summary: `The selected model is temporarily over its token-per-minute limit. Try again in ${retryText}.`,
      details: [
        modelMatch?.[1] ? `Model: ${modelMatch[1]}` : "",
        "Shorter prompts, fewer tool calls, or a smaller model can reduce this."
      ].filter(Boolean),
      raw: text
    };
  }

  if (statusMatch?.[1]) {
    return {
      title: `Provider error ${statusMatch[1]}`,
      summary: providerMessage,
      details: [],
      raw: text
    };
  }

  return {
    title: "Agent error",
    summary: providerMessage,
    details: [],
    raw: text
  };
}

function renderMessages() {
  const distanceFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  const shouldStickToBottom = distanceFromBottom < 80;

  messagesEl.textContent = "";

  if (!messages.length) {
    messagesEl.append(renderOnboardingCard());
    return;
  }

  for (const message of messages) {
    if (message.role === "tool") {
      messagesEl.append(renderToolCard(message.trace));
      continue;
    }

    if (message.role === "error") {
      messagesEl.append(renderErrorCard(message.error || normalizeAgentError(message.content)));
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
      ? renderMarkdown(sanitizeFantasyPrices(message.content))
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
    const content = renderMarkdown(sanitizeFantasyPrices(liveAssistantText));
    node.append(content);
    messagesEl.append(node);
  }

  if (shouldStickToBottom) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function renderOnboardingCard() {
  const card = document.createElement("div");
  card.className = "onboarding-card";

  const eyebrow = document.createElement("div");
  eyebrow.className = "onboarding-eyebrow";
  eyebrow.textContent = "Setup";

  const title = document.createElement("h2");
  title.textContent = "Connect your fantasy copilot";

  const steps = document.createElement("ol");
  for (const stepText of [
    "Click Settings in the top right.",
    "Choose OpenRouter, OpenAI, or Anthropic.",
    "Save the matching model API key.",
    "Save your Tinyfish API key."
  ]) {
    const step = document.createElement("li");
    step.textContent = stepText;
    steps.append(step);
  }

  const sample = document.createElement("button");
  sample.className = "sample-prompt";
  sample.type = "button";
  sample.textContent = "Compare David Raya and Unai Simon";
  sample.addEventListener("click", () => {
    chatInput.value = sample.textContent;
    resizeChatInput();
    chatInput.focus();
  });

  card.append(eyebrow, title, steps, sample);
  return card;
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
  const content = sanitizeFantasyPrices(liveAssistantText).trim();
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

function isTableDivider(line) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function isTableRow(line) {
  const trimmed = line.trim();
  return trimmed.includes("|") && trimmed.split("|").filter((cell) => cell.trim()).length >= 2;
}

function isHorizontalRule(line) {
  return /^-{3,}$/.test(line.trim());
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeTableLines(lines) {
  const normalized = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.includes("||")) {
      for (const part of trimmed.split(/\s*\|\|\s*/)) {
        const row = part.trim();
        if (row) {
          normalized.push(row.startsWith("|") ? row : `| ${row} |`);
        }
      }
      continue;
    }

    normalized.push(trimmed);
  }

  return normalized;
}

function renderTable(tableLines) {
  const rows = normalizeTableLines(tableLines).filter((line) => !isTableDivider(line));
  const [headerLine, ...bodyLines] = rows;
  const headers = splitTableRow(headerLine || "");

  const wrapper = document.createElement("div");
  wrapper.className = "table-wrap";

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const header of headers) {
    const th = document.createElement("th");
    appendInlineMarkdown(th, header);
    headerRow.append(th);
  }
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const line of bodyLines) {
    const cells = splitTableRow(line);
    if (!cells.length) {
      continue;
    }

    const row = document.createElement("tr");
    for (let index = 0; index < headers.length; index += 1) {
      const td = document.createElement("td");
      appendInlineMarkdown(td, cells[index] || "");
      row.append(td);
    }
    tbody.append(row);
  }
  table.append(tbody);
  wrapper.append(table);
  return wrapper;
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

    if (isHorizontalRule(line)) {
      const rule = document.createElement("hr");
      root.append(rule);
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

    if (isTableRow(line) && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const tableLines = [lines[index].trim(), lines[index + 1].trim()];
      index += 2;
      while (index < lines.length && isTableRow(lines[index])) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      root.append(renderTable(tableLines));
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
      !isHorizontalRule(lines[index].trim()) &&
      !(isTableRow(lines[index].trim()) && index + 1 < lines.length && isTableDivider(lines[index + 1])) &&
      !/^```/.test(lines[index].trim())
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    root.append(renderParagraph(paragraphLines));
  }

  return root;
}

const TOOL_DISPLAY_NAMES = {
  refresh_fifa_players: "Refresh FIFA Players",
  search_fifa_players: "FIFA Player Search",
  get_fifa_player: "FIFA Player Lookup",
  get_fifa_players_cache_status: "FIFA Cache Status",
  get_current_fantasy_squad: "Current Squad",
  validate_fifa_squad: "Squad Validator",
  add_fantasy_player: "Add Fantasy Player",
  remove_fantasy_player: "Remove Fantasy Player",
  tinyfish_search: "Tinyfish Search",
  tinyfish_fetch: "Tinyfish Fetch"
};

function formatToolName(name) {
  return TOOL_DISPLAY_NAMES[name] || String(name || "Tool")
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
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

    if (trace.name === "get_current_fantasy_squad") {
      return "Reading current squad";
    }

    if (trace.name === "validate_fifa_squad") {
      return "Checking squad budget and rules";
    }

    if (trace.name === "add_fantasy_player") {
      return `Adding ${trace.input?.playerName || "player"}`;
    }

    if (trace.name === "remove_fantasy_player") {
      return `Removing ${trace.input?.playerName || "player"}`;
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

  if (trace.name === "get_current_fantasy_squad") {
    const selectedCount = trace.result?.selectedCount ?? 0;
    const parsedCount = trace.result?.parsedPlayerCount ?? trace.result?.visiblePlayerCount ?? 0;
    const budget = typeof trace.result?.remainingBudget === "number" ? ` · ${trace.result.remainingBudget}m remaining` : "";
    const source = trace.result?.source === "raw_text" ? " from page text" : "";
    return `Read ${parsedCount} players${source} · ${selectedCount || parsedCount}/15 selected${budget}`;
  }

  if (trace.name === "validate_fifa_squad") {
    if (trace.result?.valid) {
      return `Valid squad · ${trace.result.totalCost}m spent · ${trace.result.remainingBudget}m remaining`;
    }

    const count = Array.isArray(trace.result?.violations) ? trace.result.violations.length : 0;
    return `Invalid squad · ${count} issue${count === 1 ? "" : "s"}`;
  }

  if (trace.name === "search_fifa_players") {
    return `${trace.result?.count ?? 0} result${trace.result?.count === 1 ? "" : "s"} from ${trace.result?.totalCachedPlayers ?? 0} cached players`;
  }

  if (trace.name === "get_fifa_player") {
    return trace.result?.player ? `Loaded ${trace.result.player.name}` : "Player not found";
  }

  if (trace.name === "add_fantasy_player") {
    return trace.result?.message || "Add action complete";
  }

  if (trace.name === "remove_fantasy_player") {
    return trace.result?.message || "Remove action complete";
  }

  return "Tool complete";
}

function renderThinkingCard(label) {
  const node = document.createElement("div");
  node.className = "thinking-card";
  node.textContent = label;
  return node;
}

function renderErrorCard(error) {
  const normalized = error?.title ? error : normalizeAgentError(error?.raw || error?.summary || error);
  const card = document.createElement("div");
  card.className = "error-card";

  const title = document.createElement("div");
  title.className = "error-title";
  title.textContent = normalized.title;

  const summary = document.createElement("div");
  summary.className = "error-summary";
  summary.textContent = normalized.summary;

  card.append(title, summary);

  if (Array.isArray(normalized.details) && normalized.details.length) {
    const details = document.createElement("ul");
    details.className = "error-details";
    for (const detail of normalized.details) {
      const item = document.createElement("li");
      item.textContent = detail;
      details.append(item);
    }
    card.append(details);
  }

  return card;
}

function renderToolCard(trace) {
  const toolCard = document.createElement("div");
  toolCard.className = `tool-card${trace.isError ? " error" : ""}${trace.status === "running" ? " running" : ""}`;

  const title = document.createElement("div");
  title.className = "tool-title";
  title.textContent = formatToolName(trace.name);

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

function setSelectValue(select, value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return;
  }

  if (![...select.options].some((option) => option.value === normalizedValue)) {
    const option = document.createElement("option");
    option.value = normalizedValue;
    option.textContent = normalizedValue;
    select.append(option);
  }

  select.value = normalizedValue;
}

function updateProviderFields() {
  const provider = llmProvider.value;
  for (const section of settingsForm.querySelectorAll("[data-provider-section]")) {
    const isSelected = section.dataset.providerSection === provider;
    section.open = isSelected;
    section.classList.toggle("selected", isSelected);
  }
}

async function loadConfigStatus() {
  const config = await sendRuntimeMessage({ type: "GET_AGENT_CONFIG" });
  llmProvider.value = config?.llmProvider || "openrouter";
  if (config?.openRouterModel) {
    openRouterModel.value = config.openRouterModel;
  }
  if (config?.openAiModel) {
    setSelectValue(openAiModel, config.openAiModel);
  }
  if (config?.anthropicModel) {
    setSelectValue(anthropicModel, config.anthropicModel);
  }
  openRouterKey.placeholder = config?.openRouterApiKey === "configured" ? "Configured" : "";
  openAiKey.placeholder = config?.openAiApiKey === "configured" ? "Configured" : "";
  anthropicKey.placeholder = config?.anthropicApiKey === "configured" ? "Configured" : "";
  tinyfishKey.placeholder = config?.tinyfishApiKey === "configured" ? "Configured" : "";
  updateProviderFields();
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
      clearAssistantStream();
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
      messages = [...messages, createErrorMessage(eventMessage.error || "Agent request failed.")];
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
llmProvider.addEventListener("change", updateProviderFields);
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
    llmProvider: llmProvider.value,
    openRouterApiKey: openRouterKey.value,
    openRouterModel: openRouterModel.value,
    openAiApiKey: openAiKey.value,
    openAiModel: openAiModel.value,
    anthropicApiKey: anthropicKey.value,
    anthropicModel: anthropicModel.value,
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
  openAiKey.value = "";
  anthropicKey.value = "";
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
  openAiKey.value = "";
  anthropicKey.value = "";
  tinyfishKey.value = "";
  openRouterKey.placeholder = "";
  openAiKey.placeholder = "";
  anthropicKey.placeholder = "";
  tinyfishKey.placeholder = "";
  settingsStatus.textContent = "Keys cleared.";
});

await loadMessages();
await loadConfigStatus();
await loadFifaCacheStatus();
