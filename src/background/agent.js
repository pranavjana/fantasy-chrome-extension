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

function parseToolCallInput(toolCall) {
  const rawArguments = toolCall?.function?.arguments || "{}";
  try {
    return JSON.parse(rawArguments);
  } catch {
    return {};
  }
}

function normalizeOpenRouterResponse(payload) {
  const message = payload?.choices?.[0]?.message || {};
  return {
    message,
    assistantText: String(message.content || "").trim(),
    toolUses: (message.tool_calls || [])
      .filter((toolCall) => toolCall?.function?.name)
      .map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function.name,
        input: parseToolCallInput(toolCall)
      }))
  };
}

async function openRouterChatCompletion({ config, messages, tools = AGENT_TOOLS, system = buildSystemPrompt() }) {
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
      ...(tools ? { tools: toOpenRouterTools(tools), parallel_tool_calls: false } : {})
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter API failed with status ${response.status}: ${text}`);
  }

  return normalizeOpenRouterResponse(await response.json());
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
      messages: conversation.slice(-30)
    });

    assistantText = response.assistantText;
    if (assistantText) {
      onEvent?.({ type: "response_delta", delta: assistantText });
    }

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
- Keep it concise and actionable.`
    });

    assistantText = finalResponse.assistantText;
    if (assistantText) {
      onEvent?.({ type: "response_delta", delta: assistantText });
    }
  }

  return {
    assistant: assistantText || "I could not produce a response.",
    toolTraces
  };
}
