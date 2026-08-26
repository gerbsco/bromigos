// scripts/fetch.js
// Pulls the Ultimo Bromigos league from ESPN and writes data/league.json
// No dependencies. Requires Node 20+ (built-in fetch).

import { writeFile, mkdir } from "node:fs/promises";

const LEAGUE_ID = "24869044";
const SEASON = "2026";
const BASE =
  `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}` +
  `/segments/0/leagues/${LEAGUE_ID}`;

// ESPN rejects requests with no user agent.
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; BromigosBot/1.0)",
  "Accept": "application/json",
};

async function get(url, extraHeaders = {}) {
  const res = await fetch(url, { headers: { ...HEADERS, ...extraHeaders } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Each view is fetched separately — combining them in one URL silently drops some.
async function getView(view) {
  return get(`${BASE}?view=${view}`);
}

// Free agents. The filter header is why this can't run in a browser.
async function getFreeAgents(scoringPeriodId) {
  const filter = {
    players: {
      filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
      limit: 200,
      sortPercOwned: { sortAsc: false, sortPriority: 1 },
    },
  };
  const url = `${BASE}?view=kona_player_info` +
    (scoringPeriodId ? `&scoringPeriodId=${scoringPeriodId}` : "");
  return get(url, { "x-fantasy-filter": JSON.stringify(filter) });
}

async function main() {
  const snapshot = {
    fetchedAt: new Date().toISOString(),
    leagueId: LEAGUE_ID,
    season: SEASON,
    errors: [],
  };

  // Core views. If one fails we record it and keep going rather than
  // publishing nothing.
  const views = {
    settings: "mSettings",
    teams: "mTeam",
    rosters: "mRoster",
    matchups: "mMatchup",
    standings: "mStandings",
  };

  for (const [key, view] of Object.entries(views)) {
    try {
      const data = await getView(view);
      snapshot[key] = data;
      if (!snapshot.scoringPeriodId && data.scoringPeriodId) {
        snapshot.scoringPeriodId = data.scoringPeriodId;
        snapshot.status = data.status;
      }
      console.log(`ok   ${view}`);
    } catch (err) {
      snapshot.errors.push(`${view}: ${err.message}`);
      console.error(`FAIL ${view}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 400)); // be polite
  }

  // Free agents — only meaningful once the draft has happened.
  const drafted = snapshot.settings?.draftDetail?.drafted;
  if (drafted) {
    try {
      const fa = await getFreeAgents(snapshot.scoringPeriodId);
      snapshot.freeAgents = fa.players || [];
      console.log(`ok   free agents (${snapshot.freeAgents.length})`);
    } catch (err) {
      snapshot.errors.push(`freeAgents: ${err.message}`);
      console.error(`FAIL free agents: ${err.message}`);
    }
  } else {
    console.log("skip free agents — league has not drafted yet");
  }

  // Refuse to overwrite good data with a totally failed run.
  if (!snapshot.teams) {
    throw new Error("No team data returned — aborting so the last good file stays put.");
  }

  await mkdir("data", { recursive: true });
  await writeFile("data/league.json", JSON.stringify(snapshot, null, 2));
  console.log(`\nwrote data/league.json (${snapshot.errors.length} errors)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
