import { getAgentConfig } from "./config.js";
import { AGENT_TOOLS, executeAgentTool } from "./tools.js";

const MAX_TOOL_ROUNDS = 20;

const SYSTEM_PROMPT = `You are a fantasy football browser copilot running inside a Chrome extension.

Rules:
- Answer the user's latest question directly and concisely.
- The FIFA player cache is your fantasy database. Use it for official fantasy prices, positions, player status, ownership, points, and raw player fields. For requests like "best defender under 6 million", call search_fifa_players with position "DEF", maxPrice 6, and sortBy "best".
- Tinyfish is for real-world context that can fuel fantasy decisions: current news, lineup hints, injuries, form narratives, quotes, tactical context, and external research.
- For any recommendation, comparison, ranking, "better pick", "best pick", or start/sit decision, first use FIFA cache for fantasy constraints, then use Tinyfish to check current real-world context for the top candidates before finalizing. Do not make real-world research optional when it is available.
- When deciding whether a player is a good fantasy pick, consider expected minutes, role security, price efficiency, fixture quality, clean-sheet chances for defenders and goalkeepers, goal involvement for attackers and midfielders, set-piece duty, bench or dead-spot risk, rotation risk, injuries, suspensions, qualification scenarios, and group-stage planning.
- When judging likely minutes, look for recent national-team appearances, first-choice role evidence, and current lineup or team-news reporting from Tinyfish. Never state that a player will definitely start unless the evidence is official and explicit.
- Use add_fantasy_player only when the user explicitly asks you to add a player or confirms a team change. If the user asks for advice, recommend first and wait for approval before changing the browser page.
- When adding a player, provide position when known: GK, DEF, MID, or FWD. If the player list is already open and the player is visible, add_fantasy_player can be called with only playerName.
- If a player is not found in the FIFA cache, say only that they were not found in the cached fantasy player data. Do not infer that they were omitted from a national squad, are unavailable in the real tournament, or cannot be picked unless the FIFA cache or visible page context directly proves that. Try a broader search_fifa_players query or refresh before concluding.
- Treat tool results as the factual source of truth.
- If page context is provided, use it, but do not claim to have deeper site data than the context contains.
- Do not end advice with "if you want" offers to do required research. Do the required FIFA and Tinyfish research before answering, or state that the needed source is unavailable.
- Do not mention internal tool calls unless the user asks.`;

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
      [tokenLimitField]: 1200,
      messages: [
        { role: "system", content: system },
        ...messages
      ],
      stream: true,
      ...(tools ? { tools: toOpenAiCompatibleTools(tools), parallel_tool_calls: false } : {})
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
      max_tokens: 1200,
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

function summarizeToolTrace(trace) {
  if (trace.isError) {
    return `${trace.name}: ${trace.result?.error || "Tool failed"}`;
  }

  if (trace.name === "search_fifa_players") {
    const players = Array.isArray(trace.result?.players) ? trace.result.players.slice(0, 5) : [];
    const playerText = players
      .map((player) => {
        const price = typeof player.price === "number" ? `$${player.price}m` : "price unknown";
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

    const price = typeof player.price === "number" ? `$${player.price}m` : "price unknown";
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

  for (let loopCount = 0; loopCount < MAX_TOOL_ROUNDS; loopCount += 1) {
    onEvent?.({ type: "thinking", label: loopCount === 0 ? "Thinking..." : "Reading tool results..." });
    const response = await chatCompletion({
      config,
      messages: conversation.slice(-30),
      onTextDelta: (delta) => {
        onEvent?.({ type: "response_delta", delta });
      }
    });

    assistantText = response.assistantText;

    const toolUses = response.toolUses || [];
    if (!toolUses.length) {
      endedWithToolUse = false;
      break;
    }

    endedWithToolUse = true;
    hitToolLimit = loopCount === MAX_TOOL_ROUNDS - 1;
    onEvent?.({ type: "response_reset" });

    conversation = [
      ...conversation,
      response.message
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
    const addPlayerToolUses = [];

    toolUses.forEach((toolUse, index) => {
      if (toolUse.name === "add_fantasy_player") {
        addPlayerToolUses.push({ toolUse, index });
        return;
      }

      nonMutationToolPromises.push(
        runToolUse(toolUse).then((result) => {
          toolResults[index] = result;
        })
      );
    });

    await Promise.all(nonMutationToolPromises);

    for (const { toolUse, index } of addPlayerToolUses) {
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
        messages: conversation.slice(-30),
        tools: null,
        system: `${buildSystemPrompt()}

You are now writing the final answer from tool results already in the conversation.
Rules:
- Do not request or mention tools.
- Answer the user's latest question directly.
- If the tool-call limit was reached, still answer from the available context and mention any uncertainty briefly.
- Use FIFA player cache tool results as the source of truth for fantasy prices, positions, player status, ownership, points, and raw player fields.
- Use Tinyfish tool results as real-world context for news, injuries, lineup hints, form narratives, and confidence.
- Combine both sources when making recommendations.
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
    assistant: assistantText || contextFallbackAnswer({ toolTraces, hitToolLimit, finalError }),
    toolTraces
  };
}
