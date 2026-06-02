import { getFifaPlayer, getFifaPlayersCache, refreshFifaPlayersCache, searchFifaPlayers } from "./fifa-player-cache.js";
import { tinyfishFetch, tinyfishSearch } from "./tinyfish-client.js";

function clampLimit(limit, fallback = 6, max = 10) {
  if (typeof limit !== "number" || Number.isNaN(limit)) {
    return fallback;
  }

  return Math.max(1, Math.min(max, Math.floor(limit)));
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
