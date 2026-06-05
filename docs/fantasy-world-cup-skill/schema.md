# FIFA JSON Schema

Reference copied from the internal Tinyfish fantasy-world-cup skill and adapted for this Chrome extension harness.

The official FIFA fantasy data is fetched from:

- `https://play.fifa.com/json/fantasy/players.json`
- `https://play.fifa.com/json/fantasy/squads.json`

The upstream skill also uses:

- `data/rounds.json`

## players.json

Each player object includes fields such as:

- `id`
- `firstName`
- `lastName`
- `knownName`
- `squadId`
- `position`
- `price`
- `status`
- `matchStatus`
- `percentSelected`
- `roundsSelected`
- `stats.totalPoints`
- `stats.avgPoints`
- `stats.form`
- `stats.lastRoundPoints`
- `stats.roundPoints`
- `stats.nextFixtureFromActiveRound`
- `stats.nextFixtureFromScheduledRound`
- `oneToWatch`
- `oneToWatchText`
- `qualificationRoundIds`
- `fifaId`

## squads.json

Each squad object includes fields such as:

- `id`
- `name`
- `group`
- `abbr`
- `isEliminated`

## rounds.json

Each round object includes fields such as:

- `id`
- `status`
- `startDate`
- `endDate`
- `stage`
- `tournaments`

Each tournament object includes fields such as:

- `id`
- `date`
- `status`
- `homeSquadId`
- `awaySquadId`
- `homeSquadName`
- `awaySquadName`
- `homeSquadAbbr`
- `awaySquadAbbr`
- `homeScore`
- `awayScore`
- `homePenaltyScore`
- `awayPenaltyScore`

## Practical Joins

- `players[].squadId` -> `squads[].id`
- `players[].stats.nextFixtureFromScheduledRound` -> `rounds[].tournaments[].id`
- `players[].stats.nextFixtureFromActiveRound` -> `rounds[].tournaments[].id`

If a player price or fixture is mentioned in an answer, verify it against official FIFA fantasy data first.
