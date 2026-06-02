import { getAgentConfig } from "./config.js";
import { AGENT_TOOLS, executeAgentTool } from "./tools.js";

const SYSTEM_PROMPT = `You are a fantasy football browser copilot running inside a Chrome extension.

Rules:
- Answer the user's latest question directly and concisely.
- The FIFA player cache is your fantasy database. Use it for official fantasy prices, positions, player status, ownership, points, and raw player fields. For requests like "best defender under 6 million", call search_fifa_players with position "DEF", maxPrice 6, and sortBy "best".
- Tinyfish is for real-world context that can fuel fantasy decisions: current news, lineup hints, injuries, form narratives, quotes, tactical context, and external research.
- For any recommendation, ranking, "best pick", or start/sit decision, first use FIFA cache for fantasy constraints, then use Tinyfish to check current real-world context for the top candidates before finalizing.
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
      content: [{ type: "text", text: String(message.content || "") }]
    }));
}

function extractAssistantText(content) {
  return (content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

async function anthropicMessagesCreate({ config, messages, onTextDelta, tools = AGENT_TOOLS, system = buildSystemPrompt() }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "x-api-key": config.anthropicApiKey
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 1200,
      system,
      ...(tools ? { tools } : {}),
      stream: true,
      messages
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
  const blocks = [];
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
      const dataLine = chunk
        .split("\n")
        .find((line) => line.startsWith("data: "));

      if (!dataLine) {
        continue;
      }

      const data = dataLine.slice(6);
      if (data === "[DONE]") {
        continue;
      }

      const event = JSON.parse(data);

      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "text") {
          blocks[event.index] = {
            type: "text",
            text: block.text || ""
          };
        }

        if (block.type === "tool_use") {
          blocks[event.index] = {
            type: "tool_use",
            id: block.id,
            name: block.name,
            inputText: ""
          };
        }
      }

      if (event.type === "content_block_delta") {
        const block = blocks[event.index];
        if (!block) {
          continue;
        }

        if (event.delta.type === "text_delta" && block.type === "text") {
          block.text += event.delta.text;
          onTextDelta?.(event.delta.text);
        }

        if (event.delta.type === "input_json_delta" && block.type === "tool_use") {
          block.inputText += event.delta.partial_json || "";
        }
      }
    }
  }

  return {
    content: blocks.filter(Boolean).map((block) => {
      if (block.type === "tool_use") {
        let input = {};
        try {
          input = block.inputText ? JSON.parse(block.inputText) : {};
        } catch {
          input = {};
        }

        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input
        };
      }

      return block;
    })
  };
}

function buildPageContextMessage(pageContext) {
  if (!pageContext) {
    return null;
  }

  return {
    role: "user",
    content: [
      {
        type: "text",
        text: `Current browser page context:\n${JSON.stringify(pageContext, null, 2).slice(0, 6000)}`
      }
    ]
  };
}

function localFallback(userMessage, pageContext) {
  const trimmed = userMessage.trim();
  const contextLine = pageContext?.url ? `\n\nCurrent page: ${pageContext.title || "Untitled"} (${pageContext.url})` : "";

  return [
    "The extension communication harness is working.",
    "",
    "Configure Anthropic and Tinyfish keys in Settings to enable live agent/tool calls.",
    "",
    `Last message: ${trimmed || "(empty)"}`,
    contextLine
  ].join("\n");
}

export async function runAgentTurn({ messages, userMessage, pageContext, onEvent }) {
  const config = await getAgentConfig();
  const toolTraces = [];

  if (!config.anthropicApiKey) {
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

  for (let loopCount = 0; loopCount < 5; loopCount += 1) {
    onEvent?.({ type: "thinking", label: loopCount === 0 ? "Thinking..." : "Reading tool results..." });
    const response = await anthropicMessagesCreate({
      config,
      messages: conversation.slice(-30),
      onTextDelta: (delta) => {
        onEvent?.({ type: "response_delta", delta });
      }
    });

    assistantText = extractAssistantText(response.content);
    const toolUses = (response.content || []).filter((block) => block.type === "tool_use");
    if (!toolUses.length) {
      endedWithToolUse = false;
      break;
    }

    endedWithToolUse = true;
    onEvent?.({ type: "response_reset" });

    conversation = [
      ...conversation,
      {
        role: "assistant",
        content: response.content
      }
    ];

    const toolResults = await Promise.all(
      toolUses.map(async (toolUse) => {
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
            type: "tool_result",
            tool_use_id: toolUse.id,
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
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
            is_error: true
          };
        }
      })
    );

    conversation = [
      ...conversation,
      {
        role: "user",
        content: toolResults
      }
    ];
  }

  if (endedWithToolUse) {
    onEvent?.({ type: "thinking", label: "Writing final answer..." });
    const finalResponse = await anthropicMessagesCreate({
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

    assistantText = extractAssistantText(finalResponse.content);
  }

  return {
    assistant: assistantText || "I could not produce a response.",
    toolTraces
  };
}
