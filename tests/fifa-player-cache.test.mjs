import assert from "node:assert/strict";

const cache = {
  schemaVersion: 4,
  fetchedAt: new Date().toISOString(),
  count: 20,
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
    },
    {
      id: 13,
      name: "Bench Goalkeeper",
      position: "GK",
      positionGroup: "GK",
      team: "Japan",
      teamAbbr: "JPN",
      price: 4,
      status: "Playing",
      selectedBy: 1,
      raw: {}
    },
    {
      id: 14,
      name: "Budget Defender One",
      position: "DEF",
      positionGroup: "DEF",
      team: "USA",
      teamAbbr: "USA",
      price: 4,
      status: "Playing",
      selectedBy: 1,
      raw: {}
    },
    {
      id: 15,
      name: "Budget Defender Two",
      position: "DEF",
      positionGroup: "DEF",
      team: "Mexico",
      teamAbbr: "MEX",
      price: 4,
      status: "Playing",
      selectedBy: 1,
      raw: {}
    },
    {
      id: 16,
      name: "Budget Defender Three",
      position: "DEF",
      positionGroup: "DEF",
      team: "Canada",
      teamAbbr: "CAN",
      price: 4,
      status: "Playing",
      selectedBy: 1,
      raw: {}
    },
    {
      id: 17,
      name: "Budget Midfielder One",
      position: "MID",
      positionGroup: "MID",
      team: "USA",
      teamAbbr: "USA",
      price: 5,
      status: "Playing",
      selectedBy: 1,
      raw: {}
    },
    {
      id: 18,
      name: "Budget Midfielder Two",
      position: "MID",
      positionGroup: "MID",
      team: "Mexico",
      teamAbbr: "MEX",
      price: 5,
      status: "Playing",
      selectedBy: 1,
      raw: {}
    },
    {
      id: 19,
      name: "Budget Forward One",
      position: "FWD",
      positionGroup: "FWD",
      team: "USA",
      teamAbbr: "USA",
      price: 6,
      status: "Playing",
      selectedBy: 1,
      raw: {}
    },
    {
      id: 20,
      name: "Budget Forward Two",
      position: "FWD",
      positionGroup: "FWD",
      team: "Mexico",
      teamAbbr: "MEX",
      price: 6,
      status: "Playing",
      selectedBy: 1,
      raw: {}
    },
    {
      id: 21,
      name: "Premium Forward",
      position: "FWD",
      positionGroup: "FWD",
      team: "Brazil",
      teamAbbr: "BRA",
      price: 10,
      status: "Playing",
      selectedBy: 30,
      raw: {}
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

const { getFifaPlayer, refreshFifaPlayersCache, searchFifaPlayers, validateFifaSquad } = await import("../src/background/fifa-player-cache.js");

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

storedCache = cache;

const validSquad = await validateFifaSquad({
  budget: 100,
  players: [
    { name: "David Raya", position: "GK" },
    { name: "Bench Goalkeeper", position: "GK" },
    { name: "Nicolas Otamendi", position: "DEF" },
    { name: "Eric Garcia", position: "DEF" },
    { name: "Budget Defender One", position: "DEF" },
    { name: "Budget Defender Two", position: "DEF" },
    { name: "Budget Defender Three", position: "DEF" },
    { name: "Alexis Mac Allister", position: "MID" },
    { name: "Kevin De Bruyne", position: "MID" },
    { name: "Encoded Price", position: "MID" },
    { name: "Budget Midfielder One", position: "MID" },
    { name: "Budget Midfielder Two", position: "MID" },
    { name: "Rasmus Hojlund", position: "FWD" },
    { name: "Thomas Mueller", position: "FWD" },
    { name: "Budget Forward One", position: "FWD" }
  ]
});

assert.equal(validSquad.valid, true, validSquad.violations.join("; "));
assert.equal(validSquad.totalCost, 82.1);
assert.equal(validSquad.remainingBudget, 17.9);
assert.deepEqual(validSquad.positionCounts, { GK: 2, DEF: 5, MID: 5, FWD: 3 });

const invalidSquad = await validateFifaSquad({
  budget: 50,
  players: [
    { name: "David Raya", position: "GK" },
    { name: "Bench Goalkeeper", position: "GK" },
    { name: "Nicolas Otamendi", position: "DEF" },
    { name: "Eric Garcia", position: "DEF" },
    { name: "Budget Defender One", position: "DEF" },
    { name: "Budget Defender Two", position: "DEF" },
    { name: "Kevin Mac Allister", position: "DEF" },
    { name: "Alexis Mac Allister", position: "MID" },
    { name: "Kevin De Bruyne", position: "MID" },
    { name: "Encoded Price", position: "MID" },
    { name: "Budget Midfielder One", position: "MID" },
    { name: "Budget Midfielder Two", position: "MID" },
    { name: "Rasmus Hojlund", position: "FWD" },
    { name: "Thomas Mueller", position: "FWD" },
    { name: "Premium Forward", position: "FWD" }
  ]
});

assert.equal(invalidSquad.valid, false);
assert.equal(invalidSquad.totalCost, 85.9);
assert(invalidSquad.violations.some((violation) => violation.includes("budget is 50.0m")));
assert(invalidSquad.violations.some((violation) => violation.includes("Kevin Mac Allister has status Transferred")));

console.log("fifa-player-cache edge cases passed");
