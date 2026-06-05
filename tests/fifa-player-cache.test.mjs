import assert from "node:assert/strict";

const cache = {
  schemaVersion: 4,
  fetchedAt: new Date().toISOString(),
  count: 9,
  players: [
    {
      id: 1,
      name: "Alexis Mac Allister",
      position: "MID",
      positionGroup: "MID",
      team: "Argentina",
      teamAbbr: "ARG",
      price: 6.6,
      status: "Playing",
      selectedBy: 10,
      raw: {}
    },
    {
      id: 2,
      name: "Kevin Mac Allister",
      position: "DEF",
      positionGroup: "DEF",
      team: "Argentina",
      teamAbbr: "ARG",
      price: 3.8,
      status: "Transferred",
      selectedBy: 0.3,
      raw: {}
    },
    {
      id: 3,
      name: "Nicolas Otamendi",
      position: "DEF",
      positionGroup: "DEF",
      team: "Argentina",
      teamAbbr: "ARG",
      price: 4.4,
      status: "Playing",
      selectedBy: 2,
      raw: {}
    },
    {
      id: 4,
      name: "Eric Garcia",
      position: "DEF",
      positionGroup: "DEF",
      team: "Spain",
      teamAbbr: "ESP",
      price: 4,
      status: "Playing",
      selectedBy: 1,
      raw: {}
    },
    {
      id: 5,
      name: "David Raya",
      position: "GK",
      positionGroup: "GK",
      team: "Spain",
      teamAbbr: "ESP",
      price: 5,
      status: "Playing",
      selectedBy: 15.1,
      raw: {}
    },
    {
      id: 6,
      name: "Rasmus Højlund",
      position: "FWD",
      positionGroup: "FWD",
      team: "Denmark",
      teamAbbr: "DEN",
      price: 7.5,
      status: "Playing",
      selectedBy: 4,
      raw: {}
    },
    {
      id: 7,
      name: "Thomas Müller",
      position: "FWD",
      positionGroup: "FWD",
      team: "Germany",
      teamAbbr: "GER",
      price: 7,
      status: "Playing",
      selectedBy: 5,
      raw: {}
    },
    {
      id: 8,
      name: "Kevin De Bruyne",
      position: "MID",
      positionGroup: "MID",
      team: "Belgium",
      teamAbbr: "BEL",
      price: 9,
      status: "Playing",
      selectedBy: 20,
      raw: {}
    },
    {
      id: 9,
      name: "Encoded Price",
      position: "MID",
      positionGroup: "MID",
      team: "Testland",
      teamAbbr: "TST",
      price: 6.6,
      status: "Playing",
      selectedBy: 1,
      raw: { price: 66 }
    }
  ]
};

let storedCache = cache;

globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({ fifaPlayersCache: storedCache }),
      set: async (values) => {
        storedCache = values.fifaPlayersCache;
      }
    }
  }
};

globalThis.fetch = async (url) => ({
  ok: true,
  json: async () => {
    if (url.includes("squads")) {
      return [{ id: 99, name: "Testland", abbr: "TST" }];
    }

    return [
      { id: 10, displayName: "Raw Price 66", position: "3", squadId: 99, price: 66, status: "Playing" },
      { id: 11, displayName: "Raw Price 500", position: "3", squadId: 99, price: 500, status: "Playing" },
      { id: 12, displayName: "String Price", position: "3", squadId: 99, price: "$7.5m", status: "Playing" }
    ];
  }
});

const { getFifaPlayer, refreshFifaPlayersCache, searchFifaPlayers } = await import("../src/background/fifa-player-cache.js");

async function namesFor(input) {
  const result = await searchFifaPlayers({ limit: 20, ...input });
  return result.players.map((player) => player.name);
}

assert.deepEqual(
  await namesFor({ team: "Argentina", position: "DEF", maxPrice: 4.5 }),
  ["Nicolas Otamendi"],
  "team + DEF + maxPrice should exclude midfielders and transferred players"
);

assert.deepEqual(
  await namesFor({ team: "Argentina", position: "DEF", maxPrice: 4.5, includeUnavailable: true, sortBy: "price_asc" }),
  ["Kevin Mac Allister", "Nicolas Otamendi"],
  "includeUnavailable should opt transferred players back in without admitting wrong positions"
);

assert.deepEqual(
  await namesFor({ team: "Spain", position: "DEF", maxPrice: 4.5 }),
  ["Eric Garcia"],
  "team filter should not leak Argentina players into Spain results"
);

assert.deepEqual(
  await namesFor({ query: "Hojlund" }),
  ["Rasmus Højlund"],
  "ø transliteration should match plain o"
);

assert.deepEqual(
  await namesFor({ query: "Mueller" }),
  ["Thomas Müller"],
  "ü transliteration should match ue"
);

assert.deepEqual(
  await namesFor({ query: "Bruyne De Kevin" }),
  ["Kevin De Bruyne"],
  "multi-token name search should tolerate token order"
);

assert.deepEqual(
  await namesFor({ query: "Raya David" }),
  ["David Raya"],
  "two-part names should tolerate reversed order"
);

const mac = await getFifaPlayer({ query: "Alexis Mac Allister" });
assert.equal(mac.player.price, 6.6, "Mac Allister should remain 6.6m, not a currency value");

const refreshed = await refreshFifaPlayersCache();
assert.equal(refreshed.players.find((player) => player.name === "Raw Price 66")?.price, 6.6);
assert.equal(refreshed.players.find((player) => player.name === "Raw Price 500")?.price, 5);
assert.equal(refreshed.players.find((player) => player.name === "String Price")?.price, 7.5);

console.log("fifa-player-cache edge cases passed");
