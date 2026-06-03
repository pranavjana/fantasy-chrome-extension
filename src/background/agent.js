import { getAgentConfig } from "./config.js";
import { AGENT_TOOLS, executeAgentTool } from "./tools.js";

const MAX_TOOL_ROUNDS = 10;

const SYSTEM_PROMPT = `You are a fantasy football browser copilot running inside a Chrome extension.

Rules:
- Answer the user's latest question directly and concisely.
- The FIFA player cache is your fantasy database. Use it for official fantasy prices, positions, player status, ownership, points, and raw player fields. For requests like "best defender under 6 million", call search_fifa_players with position "DEF", maxPrice 6, and sortBy "best".
- Tinyfish is for real-world context that can fuel fantasy decisions: current news, lineup hints, injuries, form narratives, quotes, tactical context, and external research.
- For any recommendation, ranking, "best pick", or start/sit decision, first use FIFA cache for fantasy constraints, then use Tinyfish to check current real-world context for the top candidates before finalizing.
- When deciding whether a player is a good fantasy pick, consider expected minutes, role security, price efficiency, fixture quality, clean-sheet chances for defenders and goalkeepers, goal involvement for attackers and midfielders, set-piece duty, bench or dead-spot risk, rotation risk, injuries, suspensions, qualification scenarios, and group-stage planning.
- When judging likely minutes, look for recent national-team appearances, first-choice role evidence, and current lineup or team-news reporting from Tinyfish. Never state that a player will definitely start unless the evidence is official and explicit.
- Use add_fantasy_player only when the user explicitly asks you to add a player or confirms a team change. If the user asks for advice, recommend first and wait for approval before changing the browser page.
- When adding a player, provide position when known: GK, DEF, MID, or FWD. If the player list is already open and the player is visible, add_fantasy_player can be called with only playerName.
- Treat tool results as the factual source of truth.
- If page context is provided, use it, but do not claim to have deeper site data than the context contains.
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

function toOpenRouterTools(tools) {
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

function parseToolCallArguments(rawArguments) {
  try {
    return rawArguments ? JSON.parse(rawArguments) : {};
  } catch {
    return {};
  }
}

async function openRouterChatCompletion({ config, messages, onTextDelta, tools = AGENT_TOOLS, system = buildSystemPrompt() }) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${config.openRouterApiKey}`,
      "x-openrouter-title": "TinyFish Fantasy World Cup Companion"
    },
    body: JSON.stringify({
      model: config.openRouterModel,
      max_tokens: 1200,
      messages: [
        { role: "system", content: system },
        ...messages
      ],
      stream: true,
      ...(tools ? { tools: toOpenRouterTools(tools), parallel_tool_calls: false } : {})
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter API failed with status ${response.status}: ${text}`);
  }

  return readOpenRouterStream(response, onTextDelta);
}

async function readOpenRouterStream(response, onTextDelta) {
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

function buildPageContextMessage(pageContext) {
  if (!pageContext) {
    return null;
  }

  return {
    role: "user",
    content: `Current browser page context:\n${JSON.stringify(pageContext, null, 2).slice(0, 6000)}`
  };
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
  const toolTraces = [];

  if (!config.openRouterApiKey) {
    return {
      assistant: localFallback(userMessage, pageContext),
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

  for (let loopCount = 0; loopCount < MAX_TOOL_ROUNDS; loopCount += 1) {
    onEvent?.({ type: "thinking", label: loopCount === 0 ? "Thinking..." : "Reading tool results..." });
    const response = await openRouterChatCompletion({
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
    const finalResponse = await openRouterChatCompletion({
      config,
      messages: conversation.slice(-30),
      tools: null,
      system: `${buildSystemPrompt()}

You are now writing the final answer from tool results already in the conversation.
Rules:
- Do not request or mention tools.
- Answer the user's latest question directly.
- Use FIFA player cache tool results as the source of truth for fantasy prices, positions, player status, ownership, points, and raw player fields.
- Use Tinyfish tool results as real-world context for news, injuries, lineup hints, form narratives, and confidence.
- Combine both sources when making recommendations.
- Keep it concise and actionable.`,
      onTextDelta: (delta) => {
        onEvent?.({ type: "response_delta", delta });
      }
    });

    assistantText = finalResponse.assistantText;
  }

  return {
    assistant: assistantText || "I could not produce a response.",
    toolTraces
  };
}
