# FIFA World Cup Fantasy 2026 Rules Summary

Condensed reference copied from the internal Tinyfish fantasy-world-cup skill.

## Registration

- The game is free.
- Saving a team requires a FIFA account login.

## Squad Creation

- Starting budget: `100.0m`.
- Squad size: `15`.
- Composition:
  - `2 GK`
  - `5 DEF`
  - `5 MID`
  - `3 FWD`

## Valid Formations

- `4-4-2`
- `4-3-3`
- `4-5-1`
- `3-4-3`
- `3-5-2`
- `5-4-1`
- `5-3-2`

## Country Limits By Stage

- Group Stage: `3`
- Round of 32: `3`
- Round of 16: `4`
- Quarter-finals: `5`
- Semi-finals: `6`
- Final: `8`

## Budget

- Player prices are fixed for the tournament.
- Budget increases by `5.0m` at the knockout phase once Round 3 locks and Round of 32 transfers open.

## Captains

- Captain gets double points.
- If the captain plays `0` minutes, the vice-captain gets double instead.
- Vice-captain fallback is lost if the user makes manual live-round changes.
- Live-round captain changes are allowed if the old captain has completed their match and the new one has not yet played.

## Substitutions

- Before lockout, starting XI and bench can be rearranged freely if the formation remains valid.
- Bench players score points but those points do not count unless they are subbed in.
- Auto-subs only happen if there were no manual live-round changes.
- Manual live-round subs require:
  - the outgoing starting player is not currently live
  - the incoming bench player has not yet played
  - the resulting formation is valid
- Once a player who has completed their match is manually removed from the XI, they cannot be restored later in that round.

## Boosters

### Wildcard

- Unlimited transfers in one eligible round.
- Not usable for the first group-stage match or the Round of 32.
- Irreversible after confirmation.

### 12th Man

- One extra player scores for the team in a round.
- Cannot already be in the squad.
- Ignores budget and country limits.
- Cannot be captained, substituted, or transferred.

### Maximum Captain

- Doubles the highest scorer in the starting XI automatically.

### Qualification Booster

- Available from the Round of 32 onward.
- Gives `+2` to starting XI players who progress or win the final.
- Player must play at least `1` minute.
- The captain's qualification bonus is not doubled.

### Mystery Booster

- Revealed from the knockout phase onward per game rules.

General booster rules:

- One booster at a time.
- Each booster can be used once.
- All except Wildcard can be deactivated before round lock.

## Transfers

- Pre-tournament: unlimited
- Before Matchday 2: `2`
- Before Matchday 3: `2`
- Before Round of 32: unlimited
- Before Round of 16: `4`
- Before Quarter-finals: `4`
- Before Semi-finals: `5`
- Before Final: `6`

Additional rules:

- One group-stage transfer can roll to the next group-stage round.
- No carry from Round 3 into the Round of 32 because that window is unlimited.
- Extra transfers cost `-3` points each.
- Confirmed transfers cannot be reversed.
- Transfers during a live round apply only to the next round.

## Lockout

- Transfers use a fixed round lockout.
- Live team management uses rolling player lock logic.

## Scoring

### All Players

- Appearance up to 60 minutes: `+1`
- Appearance 60+ minutes: `+1`
- Assist: `+3`
- Yellow card: `-1`
- Red card: `-2`
- Own goal: `-2`
- Winning a penalty: `+2`
- Conceding a penalty: `-1`

### Goalkeepers

- Clean sheet with 60+ minutes: `+5`
- First goal conceded: `0`
- Each additional goal conceded: `-1`
- Goal scored: `+9`
- Penalty save: `+3`
- Every 3 saves: `+1`

### Defenders

- Clean sheet with 60+ minutes: `+5`
- First goal conceded: `0`
- Each additional goal conceded: `-1`
- Goal scored: `+7`

### Midfielders

- Clean sheet with 60+ minutes: `+1`
- Goal scored: `+6`
- Every 3 tackles: `+1`
- Every 2 chances created: `+1`

### Forwards

- Goal scored: `+5`
- Every 2 shots on target: `+1`

## Bonus Points

- Direct free-kick goal: `+1` extra.
- Scouting bonus: `+2` if the player scores more than 4 points and is selected by fewer than 5 percent of teams.
