import { getFifaPlayer, getFifaPlayersCache, refreshFifaPlayersCache, searchFifaPlayers } from "./fifa-player-cache.js";
import { tinyfishFetch, tinyfishSearch } from "./tinyfish-client.js";

function clampLimit(limit, fallback = 6, max = 10) {
  if (typeof limit !== "number" || Number.isNaN(limit)) {
    return fallback;
  }

  return Math.max(1, Math.min(max, Math.floor(limit)));
}

function isMissingContentScriptError(error) {
  return error instanceof Error &&
    error.message.includes("Receiving end does not exist");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendActiveTabMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!isMissingContentScriptError(error)) {
      throw error;
    }
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content/content-script.js"]
  });
  await delay(100);

  return chrome.tabs.sendMessage(tabId, message);
}

export const AGENT_TOOLS = [
  {
    name: "refresh_fifa_players",
    description: "Fetch https://play.fifa.com/json/fantasy/players.json and save the latest FIFA fantasy player data in local extension storage.",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "search_fifa_players",
    description: "Search the locally cached official FIFA fantasy player data for pricing, position, team, status, ownership, points, and raw player fields. Use this before answering questions about player prices or official fantasy data.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Player, team, or position text to search." },
        position: { type: "string" },
        team: { type: "string" },
        minPrice: { type: "number" },
        maxPrice: { type: "number" },
        limit: { type: "number" },
        sortBy: {
          type: "string",
          enum: ["best", "price_asc", "price_desc", "points_desc", "selected_desc"]
        },
        refresh: { type: "boolean", description: "Force a fresh fetch before searching." }
      }
    }
  },
  {
    name: "get_fifa_player",
    description: "Get one player from the locally cached official FIFA fantasy player data by player id or name query, including raw fields.",
    input_schema: {
      type: "object",
      properties: {
        playerId: { type: ["string", "number"] },
        query: { type: "string" },
        refresh: { type: "boolean", description: "Force a fresh fetch before lookup." }
      }
    }
  },
  {
    name: "get_fifa_players_cache_status",
    description: "Inspect whether official FIFA fantasy player data is cached locally and when it was last fetched.",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "add_fantasy_player",
    description: "Add a FIFA World Cup Fantasy player on the active browser tab. If position is provided and the player list is not open, first click an empty slot for that position, then use the player-pool search field and click the player's add button. Does not scroll the player list. Only use this after the user explicitly asks to change their team.",
    input_schema: {
      type: "object",
      properties: {
        playerName: {
          type: "string",
          description: "Visible player name to add, for example Hakimi, Kane, or Mbappé."
        },
        position: {
          type: "string",
          enum: ["GK", "DEF", "MID", "FWD"],
          description: "Optional empty squad slot position to open before adding the player."
        }
      },
      required: ["playerName"]
    }
  },
  {
    name: "tinyfish_search",
    description: "Search the live web for fantasy football player news, lineup hints, injuries, pricing notes, and recent reports.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" }
      },
      required: ["query"]
    }
  },
  {
    name: "tinyfish_fetch",
    description: "Fetch and summarize specific URLs returned from Tinyfish search.",
    input_schema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["urls"]
    }
  }
];

export async function executeAgentTool(name, input, context) {
  if (name === "refresh_fifa_players") {
    const cache = await refreshFifaPlayersCache();
    return {
      fetchedAt: cache.fetchedAt,
      count: cache.count,
      url: cache.url
    };
  }

  if (name === "search_fifa_players") {
    return searchFifaPlayers(input);
  }

  if (name === "get_fifa_player") {
    return getFifaPlayer(input);
  }

  if (name === "get_fifa_players_cache_status") {
    const cache = await getFifaPlayersCache();
    return {
      fetchedAt: cache.fetchedAt,
      count: cache.count,
      url: cache.url
    };
  }

  if (name === "add_fantasy_player") {
    const playerName = typeof input.playerName === "string" ? input.playerName.trim() : "";
    const position = typeof input.position === "string" ? input.position.trim().toUpperCase() : "";

    if (!playerName) {
      throw new Error("playerName is required.");
    }

    if (!context.activeTabId) {
      throw new Error("No active tab is available for browser actions.");
    }

    const result = await sendActiveTabMessage(context.activeTabId, {
      type: "ADD_FANTASY_PLAYER",
      playerName,
      position
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Could not add fantasy player.");
    }

    return result;
  }

  if (name === "tinyfish_search") {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) {
      throw new Error("query is required.");
    }

    const results = await tinyfishSearch({
      apiKey: context.tinyfishApiKey,
      query,
      limit: clampLimit(input.limit)
    });

    return {
      query,
      results: results.map((hit) => ({
        title: hit.title,
        snippet: hit.snippet,
        url: hit.url,
        source: hit.site_name
      }))
    };
  }

  if (name === "tinyfish_fetch") {
    const urls = Array.isArray(input.urls)
      ? input.urls.filter((value) => typeof value === "string").slice(0, 5)
      : [];

    if (!urls.length) {
      throw new Error("urls is required.");
    }

    const results = await tinyfishFetch({
      apiKey: context.tinyfishApiKey,
      urls
    });

    return {
      results: results.map((hit) => ({
        url: hit.url,
        finalUrl: hit.final_url,
        title: hit.title,
        description: hit.description,
        publishedDate: hit.published_date,
        text: hit.text ? hit.text.slice(0, 4000) : "",
        imageLinks: hit.image_links ? hit.image_links.slice(0, 5) : []
      }))
    };
  }

  throw new Error(`Unknown tool ${name}`);
}
