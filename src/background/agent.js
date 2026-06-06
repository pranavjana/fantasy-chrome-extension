import { getAgentConfig } from "./config.js";
import { FANTASY_WORLD_CUP_CONTEXT } from "./fantasy-context.js";
import { AGENT_TOOLS, executeAgentTool } from "./tools.js";

const MAX_FORCED_SQUAD_REVISIONS = 6;
const MAX_TOOL_ROUNDS = 30;
const RESPONSE_TOKEN_LIMIT = 4096;

const SYSTEM_PROMPT = `You are a FIFA World Cup Fantasy browser copilot running inside a Chrome extension.

Core behavior:
- Answer the user's latest question directly, with concise reasoning and actionable recommendations.
- Treat tool results as the factual source of truth. If tool data is missing or uncertain, say exactly what is missing instead of guessing.
- Ground every substantive claim in tool evidence. If the claim is about official fantasy data, use FIFA cache results. If the claim is about current form, role, injuries, lineup, fixtures, tactics, or news, use Tinyfish search/fetch results. Do not rely on memory for football facts that affect advice.
- Use page context when it helps, but do not claim deeper site data than the provided context contains.
- Do not mention internal tool calls unless the user asks.

Source policy:
- FIFA player cache is authoritative for fantasy constraints and validation: player names, prices, positions, teams/squads, statuses, ownership, points, and raw player fields.
- Tinyfish is the decision-making layer for player quality: current news, likely starters, injuries, suspensions, call-ups, coach quotes, tactical role, form narratives, fixtures, and recent reporting.
- Use FIFA cache to know what is legal/selectable and to validate budget, positions, country limits, status, and exact prices. Do not use cache popularity, price, or fame alone to decide who is best.
- Use Tinyfish search evidence to decide which legal players are actually good picks. Real-world role, minutes, fitness, fixture, form, tactics, and team strength should drive selection/ranking.
- Never invent fantasy prices, positions, statuses, teams, fixtures, or squad eligibility from memory.
- Never invent current form, injury status, role security, lineup expectation, tactical role, or fixture context from memory. Search first or state that no current evidence was checked.
- Fantasy prices are budget values. Format them as "5.0m" or "4.3m", never as pounds, euros, or dollars unless the user explicitly asks for currency conversion.

Tool workflow:
- For official fantasy data questions, call search_fifa_players or get_fifa_player before answering.
- For questions about the user's current team, selected players, remaining budget, missing slots, or page state, call get_current_fantasy_squad before answering.
- For current squad questions, use the players returned by get_current_fantasy_squad as the current page squad list. It parses the page's raw squad text when available; selectedCount and remainingBudget are the page-state counters.
- Pass filters explicitly: team, position, minPrice/maxPrice, status, sortBy, limit. Do not bury filters inside one long query string.
- For normal player lists, rankings, and recommendations, exclude transferred or unavailable players unless the user explicitly asks for them.
- If a player is not found, try broader spelling/name searches or refresh before concluding. Say only that they were not found in cached fantasy data; do not infer squad omission or real-world unavailability unless a source proves it.
- For recommendations, comparisons, rankings, full-squad builds, transfer choices, captaincy, or start/sit decisions, use FIFA cache as the constraint set and Tinyfish as the primary evidence for football judgement.
- Do not give recommendations, comparisons, rankings, captaincy calls, transfer advice, or full-squad picks without first using FIFA cache for fantasy facts and Tinyfish search for freshness-sensitive reasoning. If Tinyfish is unavailable, explicitly label the answer as based only on official fantasy cache data and avoid claims about current form/news.
- For any full-squad build, bulk player set, or "add this team" request, call validate_fifa_squad before presenting the final squad or adding players. If validate_fifa_squad returns invalid, revise the squad and validate again; never present, add, or call final an invalid or unvalidated squad.
- For full-team builds, do not show failed drafts, invalid templates, or "valid direction" placeholders. Keep iterating internally until the exact 15 players are valid, or say you could not construct a valid team from the available data and list the blocking validation errors.
- For full-team builds, search enough official FIFA candidates by position and constraints before selecting: at minimum use position searches for GK, DEF, MID, and FWD with broad limits, then validate the exact 2 GK / 5 DEF / 5 MID / 3 FWD squad.
- For full-team builds, use Tinyfish searches on the important decision points before finalizing: premium anchors, captain candidates, injury/rotation risks, likely starters, fixtures, defensive stacks, and cheap enablers. Do not rely only on ownership, fame, price, or cached points.
- Break Tinyfish research into focused searches. Each tinyfish_search query should focus on one topic only: one player, one team, one match, one injury angle, one lineup angle, or one tactical angle. Do not combine many questions or unrelated entities in a single search query.
- Prefer multiple tinyfish_search calls in the same turn instead of one broad query. As a default: comparisons need at least one search per player plus one shared context search; team news needs separate searches for squad/injuries, lineup/tactics, and fixtures/recent match; full-squad or transfer advice needs focused searches for the most important shortlisted players or teams.
- If a task is freshness-sensitive and Tinyfish is available, a single tinyfish_search call is usually insufficient unless the user asks a narrow factual question.
- Search first, fetch second. Before calling tinyfish_fetch for a normal research task, try to answer from multiple targeted tinyfish_search calls and compare snippets. Prefer 2 to 5 focused searches over fetching a page immediately after the first search.
- Use search result titles/snippets as evidence. Fetch only after the search snippets leave a specific unresolved question, contradict each other, a high-impact claim needs source confirmation, or the user explicitly asks to inspect a URL/source.
- Do not fetch every search result by default.

Decision workflow:
- First identify the task type: fact lookup, list/filter, comparison, recommendation, full squad, transfer, captaincy, lineup/substitution, browser action, or general research.
- Determine hard constraints before ranking: budget, positions, formation, country limits, player status, user-owned players, transfer limits, and explicit user preferences.
- Then shortlist legal candidates with official fantasy data, rank them primarily from Tinyfish-backed real-world context, and verify the final answer against constraints.
- For multi-player or squad answers, calculate and state total budget/remaining budget when budget matters.
- If constraints cannot be satisfied from available data, explain the blocker and give the closest valid alternative.
- For full-squad construction, optimize for expected fantasy value under constraints: premium captain candidates, reliable minutes, fixture/team strength, set pieces, clean-sheet paths, price efficiency, bench viability, country caps, and budget balance. Avoid stacking one country beyond the cap and avoid filling with transferred/unavailable players.

Fantasy judgement:
- The goal is expected fantasy points, not simply picking famous or expensive players.
- Consider expected minutes, role security, price efficiency, fixture quality, clean-sheet chances for GK/DEF, goal involvement for MID/FWD, set pieces, bench risk, rotation risk, injuries, suspensions, tournament incentives, and group-stage planning.
- Separate floor from ceiling when helpful. Floor is minutes, role security, team strength, clean-sheet path. Ceiling is attacking upside, set pieces, recent output spikes, favorable matchup, and differential potential.
- Do not optimize only for price, ownership, or total points. Use them as signals alongside role and fixture context.

Action safety:
- Use add_fantasy_player only when the user explicitly asks to add a player or confirms a team change.
- Use remove_fantasy_player only when the user explicitly asks to remove a selected player or confirms a team change.
- If the user asks for advice, recommend first and wait for approval before changing the browser page.
- When adding a player, provide position when known: GK, DEF, MID, or FWD. If the player list is already open and the player is visible, add_fantasy_player can be called with only playerName.
- Before adding players to a partially built squad, call get_current_fantasy_squad to understand selected count, remaining budget, and open position needs.
- Before removing players, call get_current_fantasy_squad to confirm the target is currently selected when practical.
- After browser actions, report only what the add_fantasy_player or remove_fantasy_player tool actually confirmed. Never say all players were added or removed unless every requested action succeeded and the final selected count confirms the expected squad size. If an action fails or the selected count is unexpected, say which player failed and what count was reached.

Output rules:
- Keep answers concise but specific.
- For lists, use tables when they improve scanability.
- For recommendations, include the pick, short why, key risk, and relevant constraints.
- For full squads, show position groups, total cost, remaining budget, formation/bench assumption, and any uncertainty. Keep per-player notes short; avoid long paragraph explanations inside table cells.
- For full squads, only state "valid" or "budget-verified" when validate_fifa_squad returned valid true for that exact player list. If the latest validation is invalid, do not output a replacement template unless that replacement has also been validated.
- Do not end advice with "if you want" offers to do required research. Do required FIFA/Tinyfish research before answering, or state that the needed source is unavailable.

${FANTASY_WORLD_CUP_CONTEXT}`;

function sanitizeFantasyPrices(text) {
  return String(text || "").replace(/[$£€]\s*(\d+(?:\.\d+)?m\b)/gi, "$1");
}

function buildSystemPrompt() {
  const now = new Date();
  return `${SYSTEM_PROMPT}

Current date: ${now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  })}.`;
}

function normalizeMessages(messages) {
  return messages
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .map((message) => ({
      role: message.role,
      content: String(message.content || "")
    }));
}

function recentConversationWithToolPairs(messages, limit = 30) {
  let start = Math.max(0, messages.length - limit);

  while (start > 0 && messages[start]?.role === "tool") {
    start -= 1;
  }

  return messages.slice(start);
}

function buildFinalAnswerMessages({ messages, userMessage, toolTraces, hitToolLimit }) {
  const recentPlainMessages = normalizeMessages(messages).slice(-8);
  const summarizedToolResults = toolTraces.slice(-30).map((trace) => ({
    tool: trace.name,
    input: trace.input,
    isError: Boolean(trace.isError),
    result: trace.result
  }));

  return [
    ...recentPlainMessages,
    {
      role: "user",
      content: [
        "Write the final answer for the latest user request using only these tool results and the conversation context.",
        `Latest user request: ${userMessage}`,
        `Tool-call limit reached: ${hitToolLimit ? "yes" : "no"}`,
        `Tool results:\n${JSON.stringify(summarizedToolResults, null, 2).slice(0, 24000)}`
      ].join("\n\n")
    }
  ];
}

function isFullSquadRequest(userMessage) {
  const text = String(userMessage || "").toLowerCase();
  return (/\b(full|complete|entire|whole|15[- ]?(man|player)?)\b/.test(text) &&
    /\b(team|squad|players|side|xi)\b/.test(text)) ||
    /\b(make|build|create|pick|add)\s+(me\s+)?(a\s+)?(team|squad)\b/.test(text);
}

function getLatestSquadValidation(toolTraces) {
  return [...toolTraces].reverse().find((trace) => trace.name === "validate_fifa_squad" && !trace.isError)?.result || null;
}

function needsFullSquadRevision({ userMessage, toolTraces }) {
  const latestValidation = getLatestSquadValidation(toolTraces);
  return isFullSquadRequest(userMessage) &&
    latestValidation &&
    latestValidation.valid !== true;
}

function buildFullSquadRevisionMessage(validation) {
  const violations = Array.isArray(validation?.violations) && validation.violations.length
    ? validation.violations.join("; ")
    : "the latest squad validation is invalid";

  return {
    role: "user",
    content: [
      "The latest validate_fifa_squad result is invalid.",
      `Validation blockers: ${violations}`,
      "Do not answer yet and do not present this squad or an unvalidated template.",
      "Revise the exact 15-player squad using available FIFA candidate data, obey 2 GK / 5 DEF / 5 MID / 3 FWD, budget, country limits, and player status, then call validate_fifa_squad again.",
      "Only answer after validate_fifa_squad returns valid true for the exact squad."
    ].join("\n")
  };
}

function toOpenAiCompatibleTools(tools) {
  if (!tools) {
    return null;
  }

  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema
    }
  }));
}

function toAnthropicTools(tools) {
  if (!tools) {
    return null;
  }

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema
  }));
}

function parseToolCallArguments(rawArguments) {
  try {
    return rawArguments ? JSON.parse(rawArguments) : {};
  } catch {
    return {};
  }
}

function getActiveProvider(config) {
  if (config.llmProvider === "openai" || config.llmProvider === "anthropic") {
    return config.llmProvider;
  }

  return "openrouter";
}

function getProviderConfig(config) {
  const provider = getActiveProvider(config);

  if (provider === "openai") {
    return {
      provider,
      apiKey: config.openAiApiKey,
      model: config.openAiModel,
      label: "OpenAI"
    };
  }

  if (provider === "anthropic") {
    return {
      provider,
      apiKey: config.anthropicApiKey,
      model: config.anthropicModel,
      label: "Anthropic"
    };
  }

  return {
    provider,
    apiKey: config.openRouterApiKey,
    model: config.openRouterModel,
    label: "OpenRouter"
  };
}

async function openAiCompatibleChatCompletion({
  apiKey,
  endpoint,
  model,
  label,
  extraHeaders = {},
  tokenLimitField = "max_tokens",
  messages,
  onTextDelta,
  tools = AGENT_TOOLS,
  system = buildSystemPrompt()
}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
      ...extraHeaders
    },
    body: JSON.stringify({
      model,
      [tokenLimitField]: RESPONSE_TOKEN_LIMIT,
      messages: [
        { role: "system", content: system },
        ...messages
      ],
      stream: true,
      ...(tools ? { tools: toOpenAiCompatibleTools(tools), parallel_tool_calls: true } : {})
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${label} API failed with status ${response.status}: ${text}`);
  }

  return readOpenAiCompatibleStream(response, onTextDelta);
}

async function readOpenAiCompatibleStream(response, onTextDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const toolCalls = [];
  let assistantText = "";
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      const dataLines = chunk
        .split("\n")
        .filter((line) => line.startsWith("data: "));

      for (const dataLine of dataLines) {
        const data = dataLine.slice(6).trim();
        if (!data || data === "[DONE]") {
          continue;
        }

        const event = JSON.parse(data);
        const delta = event?.choices?.[0]?.delta || {};

        if (delta.content) {
          assistantText += delta.content;
          onTextDelta?.(delta.content);
        }

        for (const toolCallDelta of delta.tool_calls || []) {
          const index = toolCallDelta.index ?? toolCalls.length;
          toolCalls[index] ||= {
            id: "",
            type: "function",
            function: {
              name: "",
              arguments: ""
            }
          };

          if (toolCallDelta.id) {
            toolCalls[index].id = toolCallDelta.id;
          }

          if (toolCallDelta.type) {
            toolCalls[index].type = toolCallDelta.type;
          }

          if (toolCallDelta.function?.name) {
            toolCalls[index].function.name += toolCallDelta.function.name;
          }

          if (toolCallDelta.function?.arguments) {
            toolCalls[index].function.arguments += toolCallDelta.function.arguments;
          }
        }
      }
    }
  }

  const normalizedToolCalls = toolCalls
    .filter((toolCall) => toolCall?.function?.name)
    .map((toolCall, index) => ({
      id: toolCall.id || `tool_call_${index}`,
      type: toolCall.type || "function",
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments || "{}"
      }
    }));

  return {
    message: {
      role: "assistant",
      content: assistantText || null,
      ...(normalizedToolCalls.length ? { tool_calls: normalizedToolCalls } : {})
    },
    assistantText: assistantText.trim(),
    toolUses: normalizedToolCalls.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function.name,
      input: parseToolCallArguments(toolCall.function.arguments)
    }))
  };
}

function appendAnthropicToolResults(messages, pendingToolResults) {
  if (!pendingToolResults.length) {
    return;
  }

  messages.push({
    role: "user",
    content: pendingToolResults.splice(0)
  });
}

function toAnthropicMessages(messages) {
  const anthropicMessages = [];
  const pendingToolResults = [];

  for (const message of messages) {
    if (!message) {
      continue;
    }

    if (message.role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: message.tool_call_id,
        content: String(message.content || ""),
        ...(message.isError ? { is_error: true } : {})
      });
      continue;
    }

    appendAnthropicToolResults(anthropicMessages, pendingToolResults);

    if (message.role === "user") {
      anthropicMessages.push({
        role: "user",
        content: String(message.content || "")
      });
      continue;
    }

    if (message.role === "assistant") {
      const content = Array.isArray(message.content) ? [...message.content] : [];
      if (message.content && !Array.isArray(message.content)) {
        content.push({
          type: "text",
          text: String(message.content)
        });
      }

      for (const toolCall of message.tool_calls || []) {
        content.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function?.name || "",
          input: parseToolCallArguments(toolCall.function?.arguments)
        });
      }

      if (content.length) {
        anthropicMessages.push({
          role: "assistant",
          content
        });
      }
    }
  }

  appendAnthropicToolResults(anthropicMessages, pendingToolResults);

  return anthropicMessages;
}

async function anthropicChatCompletion({ config, messages, onTextDelta, tools = AGENT_TOOLS, system = buildSystemPrompt() }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: RESPONSE_TOKEN_LIMIT,
      system,
      messages: toAnthropicMessages(messages),
      stream: true,
      ...(tools ? { tools: toAnthropicTools(tools) } : {})
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API failed with status ${response.status}: ${text}`);
  }

  return readAnthropicStream(response, onTextDelta);
}

async function readAnthropicStream(response, onTextDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const contentBlocks = [];
  let assistantText = "";
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      const dataLines = chunk
        .split("\n")
        .filter((line) => line.startsWith("data: "));

      for (const dataLine of dataLines) {
        const data = dataLine.slice(6).trim();
        if (!data || data === "[DONE]") {
          continue;
        }

        const event = JSON.parse(data);

        if (event.type === "content_block_start") {
          contentBlocks[event.index] = {
            ...event.content_block,
            inputJson: ""
          };
          continue;
        }

        if (event.type !== "content_block_delta") {
          continue;
        }

        const block = contentBlocks[event.index];
        if (!block) {
          continue;
        }

        if (event.delta?.type === "text_delta" && event.delta.text) {
          block.text = `${block.text || ""}${event.delta.text}`;
          assistantText += event.delta.text;
          onTextDelta?.(event.delta.text);
        }

        if (event.delta?.type === "input_json_delta" && event.delta.partial_json) {
          block.inputJson = `${block.inputJson || ""}${event.delta.partial_json}`;
        }
      }
    }
  }

  const normalizedContent = contentBlocks
    .filter(Boolean)
    .map((block) => {
      if (block.type === "tool_use") {
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: parseToolCallArguments(block.inputJson)
        };
      }

      return {
        type: block.type,
        text: block.text || ""
      };
    })
    .filter((block) => block.type === "tool_use" || block.text);

  const toolUses = normalizedContent
    .filter((block) => block.type === "tool_use" && block.name)
    .map((block, index) => ({
      id: block.id || `tool_call_${index}`,
      name: block.name,
      input: block.input || {}
    }));

  return {
    message: {
      role: "assistant",
      content: normalizedContent
    },
    assistantText: assistantText.trim(),
    toolUses
  };
}

async function chatCompletion({ config, messages, onTextDelta, tools = AGENT_TOOLS, system = buildSystemPrompt() }) {
  const providerConfig = getProviderConfig(config);

  if (!providerConfig.apiKey) {
    throw new Error(`${providerConfig.label} API key is not configured.`);
  }

  if (providerConfig.provider === "anthropic") {
    return anthropicChatCompletion({ config, messages, onTextDelta, tools, system });
  }

  if (providerConfig.provider === "openai") {
    return openAiCompatibleChatCompletion({
      apiKey: providerConfig.apiKey,
      endpoint: "https://api.openai.com/v1/chat/completions",
      model: providerConfig.model,
      label: providerConfig.label,
      tokenLimitField: "max_completion_tokens",
      messages,
      onTextDelta,
      tools,
      system
    });
  }

  return openAiCompatibleChatCompletion({
    apiKey: providerConfig.apiKey,
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: providerConfig.model,
    label: providerConfig.label,
    extraHeaders: {
      "x-openrouter-title": "TinyFish Fantasy World Cup Companion"
    },
    messages,
    onTextDelta,
    tools,
    system
  });
}

function buildPageContextMessage(pageContext) {
  if (!pageContext) {
    return null;
  }

  return {
    role: "user",
    content: `Current browser page context:\n${JSON.stringify(pageContext, null, 2).slice(0, 6000)}`
  };
}

function assistantToolMessageOnly(message) {
  if (!message) {
    return message;
  }

  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: message.content.filter((block) => block?.type === "tool_use")
    };
  }

  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    return {
      ...message,
      content: null
    };
  }

  return message;
}

function summarizeToolTrace(trace) {
  if (trace.isError) {
    return `${trace.name}: ${trace.result?.error || "Tool failed"}`;
  }

  if (trace.name === "search_fifa_players") {
    const players = Array.isArray(trace.result?.players) ? trace.result.players.slice(0, 5) : [];
    const playerText = players
      .map((player) => {
        const price = typeof player.price === "number" ? `${player.price}m` : "price unknown";
        return `${player.name} (${player.positionGroup || player.position || "position unknown"}, ${player.team || "team unknown"}, ${price})`;
      })
      .join("; ");
    return `search_fifa_players: ${trace.result?.count ?? 0} result(s)${playerText ? ` - ${playerText}` : ""}`;
  }

  if (trace.name === "get_fifa_player") {
    const player = trace.result?.player;
    if (!player) {
      return "get_fifa_player: player not found";
    }

    const price = typeof player.price === "number" ? `${player.price}m` : "price unknown";
    return `get_fifa_player: ${player.name} (${player.positionGroup || player.position || "position unknown"}, ${player.team || "team unknown"}, ${price})`;
  }

  if (trace.name === "tinyfish_search") {
    const results = Array.isArray(trace.result?.results) ? trace.result.results.slice(0, 3) : [];
    return `tinyfish_search: ${results.map((result) => result.title).filter(Boolean).join("; ") || "no summarized results"}`;
  }

  if (trace.name === "tinyfish_fetch") {
    const results = Array.isArray(trace.result?.results) ? trace.result.results.slice(0, 3) : [];
    return `tinyfish_fetch: ${results.map((result) => result.title || result.url).filter(Boolean).join("; ") || "no summarized pages"}`;
  }

  if (trace.name === "refresh_fifa_players" || trace.name === "get_fifa_players_cache_status") {
    return `${trace.name}: ${trace.result?.count ?? 0} FIFA players cached`;
  }

  return `${trace.name}: completed`;
}

function contextFallbackAnswer({ toolTraces, hitToolLimit, finalError }) {
  const usefulTraces = toolTraces.slice(-8).map(summarizeToolTrace).filter(Boolean);

  if (!usefulTraces.length) {
    return finalError
      ? `I gathered no usable tool results before the final answer step failed: ${finalError}`
      : "I do not have enough context to answer reliably yet. Try narrowing the request or checking the selected provider settings.";
  }

  return [
    hitToolLimit
      ? "I hit the tool-call limit, so here is the best answer from the completed context:"
      : "Here is the best answer from the completed context:",
    "",
    ...usefulTraces.map((trace) => `- ${trace}`)
  ].join("\n");
}

function localFallback(userMessage, pageContext) {
  const trimmed = userMessage.trim();
  const contextLine = pageContext?.url ? `\n\nCurrent page: ${pageContext.title || "Untitled"} (${pageContext.url})` : "";

  return [
    "The extension communication harness is working.",
    "",
    "Configure OpenRouter and Tinyfish keys in Settings to enable live agent/tool calls.",
    "",
    `Last message: ${trimmed || "(empty)"}`,
    contextLine
  ].join("\n");
}

export async function runAgentTurn({ messages, userMessage, pageContext, activeTabId, onEvent }) {
  const config = await getAgentConfig();
  const providerConfig = getProviderConfig(config);
  const toolTraces = [];

  if (!providerConfig.apiKey) {
    return {
      assistant: localFallback(userMessage, pageContext).replace(
        "Configure OpenRouter and Tinyfish keys",
        `Configure ${providerConfig.label} and Tinyfish keys`
      ),
      toolTraces
    };
  }

  let conversation = normalizeMessages(messages);
  const pageContextMessage = buildPageContextMessage(pageContext);
  if (pageContextMessage) {
    conversation = [pageContextMessage, ...conversation];
  }

  let assistantText = "";
  let endedWithToolUse = false;
  let hitToolLimit = false;
  let finalError = "";
  let forcedSquadRevisions = 0;

  for (let loopCount = 0; loopCount < MAX_TOOL_ROUNDS; loopCount += 1) {
    onEvent?.({ type: "thinking", label: loopCount === 0 ? "Thinking..." : "Reading tool results..." });
    const response = await chatCompletion({
      config,
      messages: recentConversationWithToolPairs(conversation),
      onTextDelta: (delta) => {
        onEvent?.({ type: "response_delta", delta });
      }
    });

    assistantText = response.assistantText;

    const toolUses = response.toolUses || [];
    if (!toolUses.length) {
      if (needsFullSquadRevision({ userMessage, toolTraces })) {
        onEvent?.({ type: "response_reset" });
        forcedSquadRevisions += 1;

        if (forcedSquadRevisions > MAX_FORCED_SQUAD_REVISIONS) {
          assistantText = [
            "I could not construct a valid full squad after multiple revision attempts.",
            "",
            "Latest validation blockers:",
            ...((getLatestSquadValidation(toolTraces)?.violations || ["The latest squad validation is invalid."]).map((violation) => `- ${violation}`))
          ].join("\n");
          endedWithToolUse = false;
          break;
        }

        conversation = [
          ...conversation,
          buildFullSquadRevisionMessage(getLatestSquadValidation(toolTraces))
        ];
        assistantText = "";
        continue;
      }

      endedWithToolUse = false;
      break;
    }

    endedWithToolUse = true;
    hitToolLimit = loopCount === MAX_TOOL_ROUNDS - 1;
    onEvent?.({ type: "response_reset" });

    conversation = [
      ...conversation,
      assistantToolMessageOnly(response.message)
    ];

    const runToolUse = async (toolUse) => {
      onEvent?.({
        type: "tool_start",
        trace: {
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input || {}
        }
      });

      try {
        const result = await executeAgentTool(toolUse.name, toolUse.input || {}, {
          activeTabId,
          tinyfishApiKey: config.tinyfishApiKey
        });

        toolTraces.push({
          name: toolUse.name,
          input: toolUse.input || {},
          result
        });

        onEvent?.({
          type: "tool_done",
          trace: {
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input || {},
            result
          }
        });

        return {
          role: "tool",
          tool_call_id: toolUse.id,
          content: JSON.stringify(result)
        };
      } catch (error) {
        const result = {
          error: error instanceof Error ? error.message : "Tool execution failed"
        };

        toolTraces.push({
          name: toolUse.name,
          input: toolUse.input || {},
          result,
          isError: true
        });

        onEvent?.({
          type: "tool_done",
          trace: {
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input || {},
            result,
            isError: true
          }
        });

        return {
          role: "tool",
          tool_call_id: toolUse.id,
          content: JSON.stringify(result),
          isError: true
        };
      }
    };

    const toolResults = new Array(toolUses.length);
    const nonMutationToolPromises = [];
    const mutationToolUses = [];

    toolUses.forEach((toolUse, index) => {
      if (toolUse.name === "add_fantasy_player" || toolUse.name === "remove_fantasy_player") {
        mutationToolUses.push({ toolUse, index });
        return;
      }

      nonMutationToolPromises.push(
        runToolUse(toolUse).then((result) => {
          toolResults[index] = result;
        })
      );
    });

    await Promise.all(nonMutationToolPromises);

    for (const { toolUse, index } of mutationToolUses) {
      toolResults[index] = await runToolUse(toolUse);
    }

    conversation = [
      ...conversation,
      ...toolResults.filter(Boolean)
    ];
  }

  if (endedWithToolUse) {
    onEvent?.({ type: "thinking", label: "Writing final answer..." });
    try {
      const finalResponse = await chatCompletion({
        config,
        messages: buildFinalAnswerMessages({
          messages,
          userMessage,
          toolTraces,
          hitToolLimit
        }),
        tools: null,
        system: `${buildSystemPrompt()}

You are now writing the final answer from tool results already in the conversation.
Rules:
- Do not request or mention tools.
- Answer the user's latest question directly.
- If the tool-call limit was reached, still answer from the available context and mention any uncertainty briefly.
- Use FIFA player cache tool results as the source of truth for fantasy prices, positions, player status, ownership, points, and raw player fields.
- Use Tinyfish tool results as the source of football judgement for news, injuries, lineup hints, fixtures, team strength, form narratives, tactical role, and confidence.
- Use FIFA cache to validate legality and exact prices; use Tinyfish search evidence to explain why players were selected.
- Do not introduce new football facts or reasoning that are not grounded in the tool results already in the conversation.
- If Tinyfish evidence is absent, avoid claims about current form, injuries, tactics, lineup expectation, or recent news; say the answer is based only on available FIFA cache data.
- Format fantasy prices as "5.0m" or "4.3m", not as currency.
- Verify hard constraints before presenting any squad, transfer, captaincy, or lineup recommendation. If the available tool results are insufficient to verify a constraint, state that limitation briefly.
- For full squads, state total cost, remaining budget, position counts, and any assumption about formation or bench from validate_fifa_squad. Use compact tables and short notes so the full squad fits in one response.
- For full squads, output a complete squad only when validate_fifa_squad returned valid true for that exact 15-player list.
- If the latest validate_fifa_squad result is invalid, do not present a "template", "direction", "draft", or replacement squad unless that replacement was also validated valid. Mention the validation blockers and stop.
- Do not claim a squad maximizes value unless the tool results show it satisfies budget, positions, country limits, player statuses, and relevant Tinyfish freshness checks for key picks.
- For full squads, briefly explain the real-world Tinyfish-backed logic for the main picks and risks; do not justify the team only by cache validity, price, or ownership.
- For browser add/remove actions, base success claims only on add_fantasy_player and remove_fantasy_player results. If final selected count is less than 15, do not say the full squad was added.
- For recommendations and comparisons, do not offer real-world context as a follow-up. If Tinyfish results are present, use them now. If they are absent, say the recommendation is based only on available fantasy cache data.
- Keep it concise and actionable.

Tool-call limit reached: ${hitToolLimit ? "yes" : "no"}.`,
        onTextDelta: (delta) => {
          onEvent?.({ type: "response_delta", delta });
        }
      });

      assistantText = finalResponse.assistantText;
    } catch (error) {
      finalError = error instanceof Error ? error.message : "Final answer step failed.";
    }
  }

  return {
    assistant: sanitizeFantasyPrices(assistantText || contextFallbackAnswer({ toolTraces, hitToolLimit, finalError })),
    toolTraces
  };
}
