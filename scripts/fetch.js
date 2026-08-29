// scripts/fetch.js
// Pulls everything the Bromigos HQ needs and writes data/league.json
//
// Sources:
//   ESPN     - rosters, scoring, projections, % rostered   (already public)
//   Sleeper  - trending adds/drops, i.e. what the wider fantasy world is doing
//   nflverse - weekly box scores and snap counts (usage data ESPN does not expose)
//
// No API keys. No dependencies. Requires Node 20+ for built-in fetch.

import { writeFile, mkdir } from "node:fs/promises";

const LEAGUE_ID = "24869044";
const SEASON = "2026";
const ESPN = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}` +
             `/segments/0/leagues/${LEAGUE_ID}`;

const UA = { "User-Agent": "Mozilla/5.0 (compatible; BromigosBot/1.0)", "Accept": "*/*" };

async function getJSON(url, extra = {}) {
  const res = await fetch(url, { headers: { ...UA, ...extra } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function getText(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
const pause = ms => new Promise(r => setTimeout(r, ms));

/* Minimal CSV parser. nflverse files are well-formed and quoted. */
function parseCSV(text, keep) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const split = line => {
    const out = []; let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]);
  const idx = {};
  head.forEach((h, i) => { idx[h.trim()] = i; });
  return lines.slice(1).map(l => {
    const c = split(l), row = {};
    (keep || head).forEach(k => {
      if (idx[k] !== undefined) {
        const v = c[idx[k]];
        row[k] = v === "" || v === "NA" ? null : (isNaN(Number(v)) ? v : Number(v));
      }
    });
    return row;
  });
}

/* nflverse file names have shifted over the years, so try a few and take
   whichever responds. The script logs which one worked. */
async function firstWorking(label, urls, handler) {
  for (const url of urls) {
    try {
      const out = await handler(url);
      console.log(`ok   ${label} <- ${url.split("/").pop()}`);
      return out;
    } catch (err) {
      console.log(`     ${label} miss ${url.split("/").pop()} (${err.message})`);
    }
  }
  throw new Error("no working url");
}

async function main() {
  const snap = {
    fetchedAt: new Date().toISOString(),
    leagueId: LEAGUE_ID,
    season: SEASON,
    sources: {},
    errors: []
  };

  /* ---------- 1. ESPN league ---------- */
  for (const [key, view] of Object.entries({
    settings: "mSettings", teams: "mTeam", rosters: "mRoster",
    matchups: "mMatchup", standings: "mStandings"
  })) {
    try {
      const d = await getJSON(`${ESPN}?view=${view}`);
      snap[key] = d;
      if (!snap.scoringPeriodId && d.scoringPeriodId) {
        snap.scoringPeriodId = d.scoringPeriodId;
        snap.status = d.status;
      }
      console.log(`ok   espn ${view}`);
    } catch (err) {
      snap.errors.push(`espn ${view}: ${err.message}`);
      console.error(`FAIL espn ${view}: ${err.message}`);
    }
    await pause(400);
  }
  snap.sources.espn = !!snap.teams;

  const drafted = snap.settings?.draftDetail?.drafted;

  /* ---------- 2. ESPN free agents (needs the filter header) ---------- */
  if (drafted) {
    try {
      const filter = { players: {
        filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
        limit: 250,
        sortPercOwned: { sortAsc: false, sortPriority: 1 }
      }};
      const fa = await getJSON(
        `${ESPN}?view=kona_player_info` +
        (snap.scoringPeriodId ? `&scoringPeriodId=${snap.scoringPeriodId}` : ""),
        { "x-fantasy-filter": JSON.stringify(filter) }
      );
      snap.freeAgents = fa.players || [];
      console.log(`ok   espn free agents (${snap.freeAgents.length})`);
    } catch (err) {
      snap.errors.push(`freeAgents: ${err.message}`);
      console.error(`FAIL free agents: ${err.message}`);
    }
  } else {
    console.log("skip free agents - league has not drafted");
  }

  /* ---------- 3. Sleeper trending (waiver signal) ---------- */
  try {
    const [adds, drops] = await Promise.all([
      getJSON("https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=60"),
      getJSON("https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=48&limit=40")
    ]);
    // Resolve ids to names. This file is large, so pull it once and keep only
    // the fantasy positions we care about.
    const all = await getJSON("https://api.sleeper.app/v1/players/nfl");
    const want = new Set(["QB","RB","WR","TE","K","DEF"]);
    const name = id => {
      const p = all[id];
      if (!p || !want.has(p.position)) return null;
      return { name: p.full_name || `${p.first_name||""} ${p.last_name||""}`.trim(),
               pos: p.position, team: p.team, status: p.injury_status || null };
    };
    const shape = list => list.map(t => {
      const n = name(t.player_id);
      return n ? { ...n, count: t.count } : null;
    }).filter(Boolean);
    snap.trending = { adds: shape(adds), drops: shape(drops) };
    snap.sources.sleeper = true;
    console.log(`ok   sleeper trending (${snap.trending.adds.length} adds, ${snap.trending.drops.length} drops)`);
  } catch (err) {
    snap.sources.sleeper = false;
    snap.errors.push(`sleeper: ${err.message}`);
    console.error(`FAIL sleeper: ${err.message}`);
  }

  /* ---------- 4. nflverse usage data ---------- */
  const base = "https://github.com/nflverse/nflverse-data/releases/download";
  try {
    snap.weeklyStats = await firstWorking("nflverse weekly stats", [
      `${base}/player_stats/stats_player_week_${SEASON}.csv`,
      `${base}/player_stats/player_stats_${SEASON}.csv`,
      `${base}/player_stats/player_stats.csv`
    ], async url => parseCSV(await getText(url), [
      "player_id","player_display_name","position","recent_team","season","week",
      "targets","receptions","receiving_yards","receiving_tds",
      "carries","rushing_yards","rushing_tds",
      "attempts","completions","passing_yards","passing_tds","interceptions",
      "target_share","air_yards_share","fantasy_points_ppr"
    ]));
    snap.sources.nflverseStats = true;
  } catch (err) {
    snap.sources.nflverseStats = false;
    snap.errors.push(`nflverse stats: ${err.message}`);
  }

  try {
    snap.snapCounts = await firstWorking("nflverse snap counts", [
      `${base}/snap_counts/snap_counts_${SEASON}.csv`,
      `${base}/snap_counts/snap_counts.csv`
    ], async url => parseCSV(await getText(url), [
      "player","position","team","season","week",
      "offense_snaps","offense_pct"
    ]));
    snap.sources.nflverseSnaps = true;
  } catch (err) {
    snap.sources.nflverseSnaps = false;
    snap.errors.push(`nflverse snaps: ${err.message}`);
  }

  /* Keep the file to a sane size: only the most recent 3 weeks of usage. */
  const trimWeeks = (rows, n = 3) => {
    if (!Array.isArray(rows) || !rows.length) return rows;
    const weeks = [...new Set(rows.map(r => r.week))].sort((a,b) => b-a).slice(0, n);
    return rows.filter(r => weeks.includes(r.week));
  };
  if (snap.weeklyStats) snap.weeklyStats = trimWeeks(snap.weeklyStats);
  if (snap.snapCounts)  snap.snapCounts  = trimWeeks(snap.snapCounts);

  /* ---------- write ---------- */
  if (!snap.teams) {
    throw new Error("No ESPN team data - aborting so the last good file survives.");
  }
  await mkdir("data", { recursive: true });
  await writeFile("data/league.json", JSON.stringify(snap, null, 2));

  console.log("\nsources:", JSON.stringify(snap.sources));
  console.log(`wrote data/league.json (${snap.errors.length} errors)`);
  if (snap.errors.length) snap.errors.forEach(e => console.log("  - " + e));
}

main().catch(err => { console.error(err); process.exit(1); });
