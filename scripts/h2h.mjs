// scripts/h2h.mjs
// Builds data/h2h.json: every head-to-head result in league history.
//
//   node scripts/h2h.mjs
//
// No API keys. No dependencies. Requires Node 20+ for built-in fetch.
//
// Team IDs get recycled between seasons and everyone renames their team every
// August, so neither is safe to join on. ESPN keeps a member GUID that survives
// all of it. That is the key we use.
//
// The .mjs extension is deliberate: it is unambiguously ESM no matter what any
// package.json says, so this cannot break if the module setup shifts.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ownerMap, rosterReport } from "./managers.mjs";

const LEAGUE_ID = "24869044";
const FIRST_SEASON = 2019;
const OUT = "data/h2h.json";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; BromigosBot/1.0)", "Accept": "*/*" };
const pause = ms => new Promise(r => setTimeout(r, ms));

/* ESPN serves current seasons and old ones from two different shapes. Try the
   direct one, fall back to leagueHistory, which wraps the season in an array. */
async function grab(season, view) {
  const urls = [
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/` +
      `${season}/segments/0/leagues/${LEAGUE_ID}?view=${view}`,
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/` +
      `leagueHistory/${LEAGUE_ID}?seasonId=${season}&view=${view}`
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) continue;
      const j = await res.json();
      return Array.isArray(j) ? j[0] : j;
    } catch (err) {
      /* try the next shape */
    }
  }
  return null;
}

/* ownerMap and name resolution live in managers.mjs, shared with weekly.mjs
   so the two can never drift apart. */
export { ownerMap };

export function tierCode(t) {
  if (!t || t === "NONE") return 0;          // regular season
  if (t === "WINNERS_BRACKET") return 1;     // playoffs
  return 2;                                  // consolation ladder
}

/* one season of ESPN documents -> game rows */
export function collect(season, teamDoc, matchDoc) {
  const owners = ownerMap(teamDoc);
  const rows = [];

  ((matchDoc && matchDoc.schedule) || []).forEach(m => {
    if (!m.home || !m.away) return;                      // bye week
    if (!m.winner || m.winner === "UNDECIDED") return;   // not played yet

    const h = owners[m.home.teamId];
    const a = owners[m.away.teamId];
    if (!h || !a) return;

    const hp = Math.round((m.home.totalPoints || 0) * 100) / 100;
    const ap = Math.round((m.away.totalPoints || 0) * 100) / 100;
    if (!hp && !ap) return;                              // scoreless placeholder

    rows.push([season, m.matchupPeriodId, h.name, hp, a.name, ap, tierCode(m.playoffTierType)]);
  });

  return rows;
}

async function main() {
  const thisYear = new Date().getFullYear();
  const games = [];
  const seasons = [];
  const seen = new Map();

  for (let season = FIRST_SEASON; season <= thisYear; season++) {
    const teamDoc = await grab(season, "mTeam");
    if (!teamDoc || !teamDoc.teams) {
      console.log(`     ${season} no team data, skipped`);
      continue;
    }
    await pause(400);
    const matchDoc = await grab(season, "mMatchup");
    const rows = collect(season, teamDoc, matchDoc);

    rows.forEach(r => {
      games.push(r);
      seen.set(r[2], (seen.get(r[2]) || 0) + 1);
      seen.set(r[4], (seen.get(r[4]) || 0) + 1);
    });

    if (rows.length) seasons.push(season);
    console.log(`ok   ${season} ${String(rows.length).padStart(3)} games`);
    await pause(400);
  }

  /* Never overwrite a good file with an empty one. If ESPN is down or the
     league flipped back to private, leave what is already there. */
  if (!games.length) {
    throw new Error("No games resolved - aborting so the last good file survives.");
  }

  const managers = [...seen.keys()].sort();
  const core = JSON.stringify({ seasons, managers, games });

  let prev = null;
  try {
    const old = JSON.parse(readFileSync(OUT, "utf8"));
    prev = JSON.stringify({ seasons: old.seasons, managers: old.managers, games: old.games });
  } catch (err) {
    /* no existing file, or it is unreadable */
  }

  if (prev === core) {
    console.log(`\nno change, left ${OUT} alone`);
  } else {
    mkdirSync("data", { recursive: true });
    writeFileSync(OUT, JSON.stringify({
      generatedAt: new Date().toISOString(),
      leagueId: LEAGUE_ID,
      seasons, managers, games
    }));
    console.log(`\nwrote ${OUT} (${games.length} games, ${managers.length} managers)`);
  }

  rosterReport(seen);
}

/* only run when invoked directly, so the tests can import the parsers */
const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch(err => { console.error(err); process.exit(1); });
}
