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

function priceToTenths(price) {
  return typeof price === "number" ? Math.round(price * 10) : null;
}

function tenthsToPrice(tenths) {
  return Number((tenths / 10).toFixed(1));
}

function resolveSquadPlayer(cache, entry) {
  const playerId = entry?.playerId;
  const query = normalizeText(entry?.query || entry?.name || entry?.playerName);
  const requestedPosition = normalizeText(entry?.position);

  const player = cache.players.find((candidate) => String(candidate.id) === String(playerId))
    || (query ? cache.players.find((candidate) => {
      if (!textMatches(buildPlayerSearchText(candidate), query)) {
        return false;
      }

      return !requestedPosition || positionMatches(candidate, requestedPosition);
    }) : null);

  return player || null;
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

export async function validateFifaSquad(input) {
  const cache = await getFifaPlayersCache({ refresh: Boolean(input.refresh) });
  const budget = typeof input.budget === "number" ? input.budget : 100;
  const budgetTenths = priceToTenths(budget);
  const stage = normalizeText(input.stage || "group");
  const countryLimit = typeof input.countryLimit === "number"
    ? input.countryLimit
    : stage.includes("quarter") ? 5
      : stage.includes("semi") ? 6
        : stage.includes("final") && !stage.includes("semi") ? 8
          : 3;
  const entries = Array.isArray(input.players) ? input.players : [];
  const resolvedPlayers = [];
  const unresolved = [];
  const violations = [];
  const positionCounts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const countryCounts = {};
  const seenIds = new Set();
  let totalTenths = 0;

  entries.forEach((entry, index) => {
    const player = resolveSquadPlayer(cache, entry);

    if (!player) {
      unresolved.push({
        index,
        query: entry?.query || entry?.name || entry?.playerName || entry?.playerId || ""
      });
      return;
    }

    const priceTenths = priceToTenths(player.price);
    if (priceTenths === null) {
      violations.push(`${player.name} has no official fantasy price.`);
    } else {
      totalTenths += priceTenths;
    }

    if (seenIds.has(String(player.id))) {
      violations.push(`${player.name} is duplicated.`);
    }
    seenIds.add(String(player.id));

    if (isDefaultExcludedStatus(player.status)) {
      violations.push(`${player.name} has status ${player.status || "unavailable"}.`);
    }

    const position = player.positionGroup || canonicalPosition(player.position);
    if (positionCounts[position] !== undefined) {
      positionCounts[position] += 1;
    } else {
      violations.push(`${player.name} has unknown position ${player.position || "unknown"}.`);
    }

    const country = player.team || player.teamAbbr || "Unknown";
    countryCounts[country] = (countryCounts[country] || 0) + 1;

    resolvedPlayers.push({
      inputIndex: index,
      id: player.id,
      name: player.name,
      position,
      team: player.team,
      teamAbbr: player.teamAbbr,
      price: player.price,
      status: player.status,
      selectedBy: player.selectedBy
    });
  });

  if (entries.length !== 15) {
    violations.push(`Squad has ${entries.length} submitted player${entries.length === 1 ? "" : "s"}; expected 15.`);
  }

  const requiredPositions = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
  for (const [position, required] of Object.entries(requiredPositions)) {
    if (positionCounts[position] !== required) {
      violations.push(`${position} count is ${positionCounts[position]}; expected ${required}.`);
    }
  }

  for (const [country, count] of Object.entries(countryCounts)) {
    if (count > countryLimit) {
      violations.push(`${country} has ${count} players; limit is ${countryLimit}.`);
    }
  }

  if (budgetTenths !== null && totalTenths > budgetTenths) {
    violations.push(`Squad costs ${tenthsToPrice(totalTenths)}m; budget is ${budget.toFixed(1)}m.`);
  }

  for (const missing of unresolved) {
    violations.push(`Could not resolve player at slot ${missing.index + 1}: ${missing.query || "empty query"}.`);
  }

  return {
    fetchedAt: cache.fetchedAt,
    budget,
    totalCost: tenthsToPrice(totalTenths),
    remainingBudget: tenthsToPrice((budgetTenths ?? 0) - totalTenths),
    submittedCount: entries.length,
    resolvedCount: resolvedPlayers.length,
    positionCounts,
    countryCounts,
    countryLimit,
    valid: violations.length === 0,
    violations,
    unresolved,
    players: resolvedPlayers
  };
}
