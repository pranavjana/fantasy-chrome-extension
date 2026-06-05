const PLAYERS_URL = "https://play.fifa.com/json/fantasy/players.json";
const SQUADS_URL = "https://play.fifa.com/json/fantasy/squads.json";
const STORAGE_KEY = "fifaPlayersCache";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 4;

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[øØ]/g, "o")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .replace(/[ßẞ]/g, "ss")
    .replace(/[łŁ]/g, "l")
    .replace(/[đĐðÐ]/g, "d")
    .replace(/[þÞ]/g, "th")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function foldSearchText(value) {
  return normalizeText(value)
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u");
}

function textMatches(haystack, query) {
  if (!query) {
    return true;
  }

  if (haystack.includes(query)) {
    return true;
  }

  const foldedHaystack = foldSearchText(haystack);
  const foldedQuery = foldSearchText(query);
  if (foldedQuery && foldedHaystack.includes(foldedQuery)) {
    return true;
  }

  const tokens = foldedQuery.split(" ").filter(Boolean);
  return tokens.length > 1 && tokens.every((token) => foldedHaystack.includes(token));
}

function buildPlayerSearchText(player) {
  return normalizeText([
    player.name,
    player.team,
    player.teamAbbr,
    player.squadId,
    player.position,
    player.positionGroup,
    stringifyValue(player.squad),
    stringifyValue(player.raw)
  ].filter(Boolean).join(" "));
}

function buildTeamSearchText(player) {
  return normalizeText([
    player.team,
    player.teamAbbr,
    player.squadId,
    stringifyValue(player.squad)
  ].filter(Boolean).join(" "));
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
  const parsed = typeof value === "number"
    ? value
    : Number(String(value ?? "").match(/\d+(?:\.\d+)?/)?.[0]);

  if (!Number.isNaN(parsed)) {
    let normalized = parsed;
    while (normalized > 20) {
      normalized /= 10;
    }
    return Number(normalized.toFixed(1));
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

function pickSquadId(player) {
  return firstPresent(player, ["squadId", "squad_id", "teamId", "team_id", "countryId", "country_id"]);
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

function extractSquads(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  for (const key of ["squads", "teams", "countries", "data", "items", "results"]) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }

  return [];
}

function buildSquadMap(squadsPayload) {
  const squads = extractSquads(squadsPayload);
  return new Map(squads.map((squad) => [String(squad.id), squad]));
}

function normalizePlayer(player, index, squadMap = new Map()) {
  const position = pickPosition(player);
  const squadId = pickSquadId(player);
  const squad = squadId !== null && squadId !== undefined ? squadMap.get(String(squadId)) : null;
  const team = squad?.name || pickTeam(player);

  return {
    id: pickId(player, index),
    name: pickName(player) || `Player ${index + 1}`,
    position,
    positionGroup: canonicalPosition(position),
    squadId,
    team,
    teamAbbr: squad?.abbr || "",
    price: pickPrice(player),
    status: firstPresent(player, ["status", "availability", "chanceOfPlaying", "injuryStatus"]) || "",
    totalPoints: parseNumber(firstPresent(player, ["totalPoints", "points", "total_points"]) ?? player.stats?.totalPoints),
    selectedBy: parseNumber(firstPresent(player, ["selectedBy", "selected_by_percent", "percentSelected", "ownership"])),
    squad: squad || null,
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
  const playerGroup = normalizeText(player.positionGroup);

  return playerGroup === normalizeText(requested);
}

function isDefaultExcludedStatus(status) {
  const normalized = normalizeText(status);
  return normalized === "transferred" || normalized === "unavailable";
}

function shouldIncludeUnavailable(input, rawQuery) {
  if (input.includeUnavailable === true) {
    return true;
  }

  if (typeof input.status === "string" && input.status.trim()) {
    return true;
  }

  return /\b(transferred|unavailable|not playing|all statuses|include unavailable)\b/.test(rawQuery);
}

function statusMatches(player, requestedStatus, includeUnavailable) {
  const status = normalizeText(player.status);

  if (requestedStatus) {
    return textMatches(status, requestedStatus);
  }

  return includeUnavailable || !isDefaultExcludedStatus(status);
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

function normalizeCache(playersPayload, squadsPayload) {
  const rawPlayers = extractPlayers(playersPayload);
  const squadMap = buildSquadMap(squadsPayload);
  const players = rawPlayers.map((player, index) => normalizePlayer(player, index, squadMap));

  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    url: PLAYERS_URL,
    squadsUrl: SQUADS_URL,
    fetchedAt: new Date().toISOString(),
    count: players.length,
    squadCount: squadMap.size,
    players
  };
}

async function fetchJson(url, label) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${label} fetch failed with status ${response.status}`);
  }

  return response.json();
}

export async function refreshFifaPlayersCache() {
  const [playersPayload, squadsPayload] = await Promise.all([
    fetchJson(PLAYERS_URL, "FIFA players"),
    fetchJson(SQUADS_URL, "FIFA squads")
  ]);
  const cache = normalizeCache(playersPayload, squadsPayload);
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
  const status = normalizeText(input.status);
  const includeUnavailable = shouldIncludeUnavailable(input, rawQuery);
  const derivedMaxPrice = deriveMaxPriceFromText(rawQuery);
  const maxPrice = typeof input.maxPrice === "number" ? input.maxPrice : derivedMaxPrice ?? Number.POSITIVE_INFINITY;
  const minPrice = typeof input.minPrice === "number" ? input.minPrice : Number.NEGATIVE_INFINITY;
  const hasPriceFilter = typeof input.maxPrice === "number" || typeof input.minPrice === "number" || typeof derivedMaxPrice === "number";
  const limit = Math.max(1, Math.min(30, Math.floor(Number(input.limit) || 10)));
  const sortBy = typeof input.sortBy === "string" ? input.sortBy : "best";

  const players = cache.players
    .filter((player) => {
      const haystack = buildPlayerSearchText(player);
      if (!textMatches(haystack, query)) {
        return false;
      }

      if (!positionMatches(player, position)) {
        return false;
      }

      if (team && !textMatches(buildTeamSearchText(player), team)) {
        return false;
      }

      if (!statusMatches(player, status, includeUnavailable)) {
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
    || (query ? cache.players.find((candidate) => textMatches(buildPlayerSearchText(candidate), query)) : null);

  return {
    fetchedAt: cache.fetchedAt,
    player: player || null
  };
}
