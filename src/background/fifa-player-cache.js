const PLAYERS_URL = "https://play.fifa.com/json/fantasy/players.json";
const STORAGE_KEY = "fifaPlayersCache";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 2;

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function stringifyValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return Object.values(value).map(stringifyValue).filter(Boolean).join(" ");
  }

  return String(value);
}

function firstPresent(source, keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }

  return null;
}

function pickName(player) {
  return firstPresent(player, [
    "displayName",
    "webName",
    "knownName",
    "name",
    "fullName",
    "playerName",
    "shortName"
  ]) || [player.firstName, player.lastName].filter(Boolean).join(" ");
}

function pickPrice(player) {
  const value = firstPresent(player, ["price", "cost", "value", "nowCost", "currentPrice"]);
  if (typeof value === "number") {
    return value > 100 ? value / 10 : value;
  }

  const parsed = Number(value);
  if (!Number.isNaN(parsed)) {
    return parsed > 100 ? parsed / 10 : parsed;
  }

  return null;
}

function parseNumber(value) {
  if (typeof value === "number") {
    return value;
  }

  const parsed = Number(String(value ?? "").replace("%", ""));
  return Number.isNaN(parsed) ? null : parsed;
}

function pickPosition(player) {
  const position = firstPresent(player, ["position", "positionName", "elementType", "element_type", "type", "positionId"]);
  return stringifyValue(position);
}

function pickTeam(player) {
  return firstPresent(player, ["teamName", "squadName", "clubName", "team", "country", "nationality"]) || "";
}

function pickId(player, index) {
  return firstPresent(player, ["id", "playerId", "element", "code", "uuid"]) || index + 1;
}

function extractPlayers(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  for (const key of ["players", "data", "elements", "items", "results"]) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }

  return [];
}

function normalizePlayer(player, index) {
  const position = pickPosition(player);

  return {
    id: pickId(player, index),
    name: pickName(player) || `Player ${index + 1}`,
    position,
    positionGroup: canonicalPosition(position),
    team: pickTeam(player),
    price: pickPrice(player),
    status: firstPresent(player, ["status", "availability", "chanceOfPlaying", "injuryStatus"]) || "",
    totalPoints: parseNumber(firstPresent(player, ["totalPoints", "points", "total_points"])),
    selectedBy: parseNumber(firstPresent(player, ["selectedBy", "selected_by_percent", "percentSelected", "ownership"])),
    raw: player
  };
}

function canonicalPosition(value) {
  const text = normalizeText(value);

  if (["1", "gk", "goalkeeper", "keeper", "goalkeepers"].includes(text)) {
    return "GK";
  }

  if (["2", "def", "defender", "defenders", "centre-back", "center-back", "left-back", "right-back"].includes(text)) {
    return "DEF";
  }

  if (["3", "mid", "midfielder", "midfielders"].includes(text)) {
    return "MID";
  }

  if (["4", "fwd", "forward", "forwards", "striker", "attack", "attacker"].includes(text)) {
    return "FWD";
  }

  if (text.includes("goal")) {
    return "GK";
  }

  if (text.includes("def")) {
    return "DEF";
  }

  if (text.includes("mid")) {
    return "MID";
  }

  if (text.includes("forward") || text.includes("striker") || text.includes("attack")) {
    return "FWD";
  }

  return String(value || "");
}

function isKnownPosition(value) {
  return ["GK", "DEF", "MID", "FWD"].includes(canonicalPosition(value));
}

function derivePositionFromText(text) {
  const normalized = normalizeText(text);
  if (isKnownPosition(normalized)) {
    return normalized;
  }

  if (/\b(gk|goalkeeper|keeper)\b/.test(normalized)) {
    return "GK";
  }

  if (/\b(def|defender|defenders|defence|defense)\b/.test(normalized)) {
    return "DEF";
  }

  if (/\b(mid|midfielder|midfielders)\b/.test(normalized)) {
    return "MID";
  }

  if (/\b(fwd|forward|forwards|striker|attack|attacker)\b/.test(normalized)) {
    return "FWD";
  }

  return "";
}

function stripQueryHints(text) {
  return normalizeText(text)
    .replace(/\b(best|pick|player|players|under|below|less than|million|m)\b/g, " ")
    .replace(/\b(gk|goalkeeper|keeper|def|defender|defenders|defence|defense|mid|midfielder|midfielders|fwd|forward|forwards|striker|attack|attacker)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveMaxPriceFromText(text) {
  const match = normalizeText(text).match(/\b(?:under|below|less than|max)\s+(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function positionMatches(player, requestedPosition) {
  if (!requestedPosition) {
    return true;
  }

  const requested = canonicalPosition(requestedPosition);
  const rawRequested = normalizeText(requestedPosition);
  const playerPosition = normalizeText(player.position);
  const playerGroup = normalizeText(player.positionGroup);

  return playerGroup === normalizeText(requested)
    || playerPosition === rawRequested
    || playerPosition.includes(rawRequested);
}

function comparePlayers(sortBy) {
  return (left, right) => {
    if (sortBy === "price_asc") {
      return (left.price ?? Number.POSITIVE_INFINITY) - (right.price ?? Number.POSITIVE_INFINITY);
    }

    if (sortBy === "price_desc") {
      return (right.price ?? Number.NEGATIVE_INFINITY) - (left.price ?? Number.NEGATIVE_INFINITY);
    }

    if (sortBy === "points_desc") {
      return Number(right.totalPoints ?? -1) - Number(left.totalPoints ?? -1);
    }

    if (sortBy === "selected_desc") {
      return Number(right.selectedBy ?? -1) - Number(left.selectedBy ?? -1);
    }

    return Number(right.totalPoints ?? -1) - Number(left.totalPoints ?? -1)
      || Number(right.selectedBy ?? -1) - Number(left.selectedBy ?? -1)
      || (right.price ?? 0) - (left.price ?? 0);
  };
}

function normalizeCache(payload) {
  const rawPlayers = extractPlayers(payload);
  const players = rawPlayers.map(normalizePlayer);

  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    url: PLAYERS_URL,
    fetchedAt: new Date().toISOString(),
    count: players.length,
    players
  };
}

export async function refreshFifaPlayersCache() {
  const response = await fetch(PLAYERS_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`FIFA players fetch failed with status ${response.status}`);
  }

  const payload = await response.json();
  const cache = normalizeCache(payload);
  await chrome.storage.local.set({ [STORAGE_KEY]: cache });
  return cache;
}

export async function getFifaPlayersCache({ refresh = false } = {}) {
  if (refresh) {
    return refreshFifaPlayersCache();
  }

  const stored = await chrome.storage.local.get([STORAGE_KEY]);
  const cache = stored[STORAGE_KEY];
  const fetchedAtMs = cache?.fetchedAt ? Date.parse(cache.fetchedAt) : 0;
  const isFresh = fetchedAtMs && Date.now() - fetchedAtMs < CACHE_TTL_MS;
  const isCurrentSchema = cache?.schemaVersion === CACHE_SCHEMA_VERSION;

  if (cache?.players?.length && isFresh && isCurrentSchema) {
    return cache;
  }

  return refreshFifaPlayersCache();
}

export async function searchFifaPlayers(input) {
  const cache = await getFifaPlayersCache({ refresh: Boolean(input.refresh) });
  const rawQuery = normalizeText(input.query);
  const positionFromQuery = !input.position ? derivePositionFromText(rawQuery) : "";
  const query = positionFromQuery ? stripQueryHints(rawQuery) : rawQuery;
  const position = normalizeText(input.position || positionFromQuery);
  const team = normalizeText(input.team);
  const derivedMaxPrice = deriveMaxPriceFromText(rawQuery);
  const maxPrice = typeof input.maxPrice === "number" ? input.maxPrice : derivedMaxPrice ?? Number.POSITIVE_INFINITY;
  const minPrice = typeof input.minPrice === "number" ? input.minPrice : Number.NEGATIVE_INFINITY;
  const hasPriceFilter = typeof input.maxPrice === "number" || typeof input.minPrice === "number" || typeof derivedMaxPrice === "number";
  const limit = Math.max(1, Math.min(30, Math.floor(Number(input.limit) || 10)));
  const sortBy = typeof input.sortBy === "string" ? input.sortBy : "best";

  const players = cache.players
    .filter((player) => {
      const haystack = normalizeText(`${player.name} ${player.team} ${player.position} ${player.positionGroup}`);
      if (query && !haystack.includes(query)) {
        return false;
      }

      if (!positionMatches(player, position)) {
        return false;
      }

      if (team && !normalizeText(player.team).includes(team)) {
        return false;
      }

      if (hasPriceFilter && typeof player.price !== "number") {
        return false;
      }

      if (typeof player.price === "number" && (player.price > maxPrice || player.price < minPrice)) {
        return false;
      }

      return true;
    })
    .sort(comparePlayers(sortBy))
    .slice(0, limit);

  return {
    fetchedAt: cache.fetchedAt,
    count: players.length,
    totalCachedPlayers: cache.count,
    players
  };
}

export async function getFifaPlayer(input) {
  const cache = await getFifaPlayersCache({ refresh: Boolean(input.refresh) });
  const playerId = input.playerId;
  const query = normalizeText(input.query);

  const player = cache.players.find((candidate) => String(candidate.id) === String(playerId))
    || (query ? cache.players.find((candidate) => normalizeText(candidate.name).includes(query)) : null);

  return {
    fetchedAt: cache.fetchedAt,
    player: player || null
  };
}
