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
import { readFileSync } from "node:fs";

const LEAGUE_ID = "24869044";
const SEASON = "2026";
const HOST = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
const ESPN = `${HOST}/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}`;

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

/* ---------- bye weeks ----------
   The roster view does not carry them. Every player object in mRoster has a
   proTeamId and no byeWeek, so the app was running its whole bye-aware model
   with nothing to be aware of: the lineup builder never sat anybody, the trade
   rating never saw a thin week, and the season table printed the same number
   fourteen times.

   Byes belong to the pro team, not the player, so one small lookup covers
   every roster and every free agent. ESPN publishes it under
   proTeamSchedules_wl, at the season level and again on the league. Sleeper's
   player dump carries the same thing and is already being downloaded for
   trending, so it stands in if ESPN's view moves.

   The map is written into the file as well as stamped onto the players, so a
   miss is visible rather than silent. */
function byesFromProTeams(doc) {
  const teams = (doc && doc.settings && doc.settings.proTeams) || [];
  const out = {};
  teams.forEach(t => {
    if (!t || t.id == null) return;
    const bye = Number(t.byeWeek);
    if (bye > 0) out[t.id] = bye;
  });
  return out;
}

/* Sleeper keys byes to the team abbreviation, ESPN to a numeric id. */
const ESPN_PRO_TEAM = { 1:"ATL", 2:"BUF", 3:"CHI", 4:"CIN", 5:"CLE", 6:"DAL",
  7:"DEN", 8:"DET", 9:"GB", 10:"TEN", 11:"IND", 12:"KC", 13:"LV", 14:"LAR",
  15:"MIA", 16:"MIN", 17:"NE", 18:"NO", 19:"NYG", 20:"NYJ", 21:"PHI", 22:"ARI",
  23:"PIT", 24:"LAC", 25:"SF", 26:"SEA", 27:"TB", 28:"WSH", 29:"CAR", 30:"JAX",
  33:"BAL", 34:"HOU" };

function byesFromSleeper(all) {
  const byAbbrev = {};
  Object.values(all || {}).forEach(p => {
    if (!p || !p.team) return;
    const bye = Number(p.bye_week);
    if (bye > 0) byAbbrev[p.team] = bye;
  });
  const out = {};
  Object.entries(ESPN_PRO_TEAM).forEach(([id, abbrev]) => {
    if (byAbbrev[abbrev]) out[id] = byAbbrev[abbrev];
  });
  return out;
}

/* Write the bye onto every player the app will read, so index.html keeps
   reading p.byeWeek and does not need to know where it came from. */
function stampByes(snap, byes) {
  const n = { filled: 0, missing: 0 };
  if (!byes || !Object.keys(byes).length) return n;
  const put = p => {
    if (!p) return;
    if (Number(p.byeWeek) > 0) { n.filled++; return; }
    const bye = byes[p.proTeamId];
    if (bye) { p.byeWeek = bye; n.filled++; } else { n.missing++; }
  };
  ((snap.rosters && snap.rosters.teams) || []).forEach(t =>
    (((t.roster && t.roster.entries) || [])).forEach(e =>
      put(e && e.playerPoolEntry && e.playerPoolEntry.player)));
  (snap.freeAgents || []).forEach(e => put(e && e.player));
  return n;
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

  /* ---------- 1b. the schedule, which the whole season table hangs off ----------
     mMatchup is the documented view and usually carries it, but it has come
     back without a schedule on this league while ESPN's own app was happily
     showing the Week 1 matchup, so one view is not enough to depend on. Try
     the others, take the first that actually has games in it, and if none do,
     keep whatever the last good pull had rather than publishing a file that
     says the season does not exist. */
  const scheduleOf = d => (d && Array.isArray(d.schedule)) ? d.schedule : [];
  /* Every attempt is recorded, with what ESPN actually sent back, and the
     record goes into league.json. Guessing at this from a phone has cost two
     evenings; the next run says out loud which views answered, what keys were
     in the reply and how many games each carried. */
  snap.scheduleTried = [];
  if (!scheduleOf(snap.matchups).length) {
    const wk = snap.scoringPeriodId || 1;
    for (const url of [
      `${ESPN}?view=mMatchup`,
      `${ESPN}?view=mMatchupScore`,
      `${ESPN}?view=mMatchup&view=mMatchupScore&view=mTeam`,
      `${ESPN}?view=mMatchup&scoringPeriodId=${wk}`,
      `${ESPN}?view=mMatchupScore&scoringPeriodId=${wk}`,
      `${ESPN}?view=mBoxscore&scoringPeriodId=${wk}`,
      `${ESPN}?view=mSchedule`,
      `${ESPN}`
    ]) {
      const label = url.split("?")[1] || "no view";
      try {
        const d = await getJSON(url);
        const games = scheduleOf(d).length;
        snap.scheduleTried.push({ view: label, ok: true, games,
          keys: Object.keys(d || {}).slice(0, 14) });
        if (games) {
          snap.matchups = d;
          console.log(`ok   espn schedule <- ${label} (${games} games)`);
          break;
        }
        console.log(`     schedule empty from ${label}, keys: ${Object.keys(d || {}).join(",")}`);
      } catch (err) {
        snap.scheduleTried.push({ view: label, ok: false, error: err.message });
        console.log(`     schedule miss ${label} (${err.message})`);
      }
      await pause(300);
    }
  }

  /* Last resort: the previous file. A view that fails or comes back thin for
     one run must not wipe a schedule the league has been reading all week. */
  if (!scheduleOf(snap.matchups).length) {
    try {
      const prev = JSON.parse(readFileSync("data/league.json", "utf8"));
      if (scheduleOf(prev.matchups).length) {
        snap.matchups = prev.matchups;
        snap.scheduleFrom = prev.fetchedAt || "an earlier pull";
        console.log(`ok   schedule carried forward from ${snap.scheduleFrom}`);
      }
    } catch (err) { /* no previous file, nothing to carry */ }
  }

  const games = scheduleOf(snap.matchups).length;
  console.log(games
    ? `ok   espn schedule (${games} matchups)`
    : "FAIL espn schedule is empty from every view - the season table stays hidden");
  if (!games) snap.errors.push("schedule: no view returned any matchups");

  /* ---------- 2. pro team bye weeks ---------- */
  let byes = {};
  for (const url of [
    `${HOST}/seasons/${SEASON}?view=proTeamSchedules_wl`,
    `${ESPN}?view=proTeamSchedules_wl`,
    `${HOST}/seasons/${SEASON}?view=mProTeamSchedules_wl`
  ]) {
    try {
      byes = byesFromProTeams(await getJSON(url));
      if (Object.keys(byes).length) {
        console.log(`ok   espn byes (${Object.keys(byes).length} teams) <- ${url.split("?").pop()}`);
        break;
      }
      console.log(`     byes empty from ${url.split("?").pop()}`);
    } catch (err) {
      console.log(`     byes miss ${url.split("?").pop()} (${err.message})`);
    }
    await pause(300);
  }

  /* ---------- 3. ESPN free agents (needs the filter header) ---------- */
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

  /* ---------- 4. Sleeper trending (waiver signal) ---------- */
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

    /* Same dump carries bye weeks, so it costs nothing to use as a backstop. */
    if (!Object.keys(byes).length) {
      byes = byesFromSleeper(all);
      if (Object.keys(byes).length)
        console.log(`ok   byes from sleeper (${Object.keys(byes).length} teams)`);
    }
  } catch (err) {
    snap.sources.sleeper = false;
    snap.errors.push(`sleeper: ${err.message}`);
    console.error(`FAIL sleeper: ${err.message}`);
  }

  /* ---------- 5. stamp the byes on ---------- */
  snap.byes = byes;
  const stamped = stampByes(snap, byes);
  snap.sources.byes = Object.keys(byes).length > 0;
  if (!snap.sources.byes) {
    snap.errors.push("byes: no source answered, players carry no bye week");
    console.error("FAIL byes - nothing answered. Lineups will not be bye aware.");
  } else {
    console.log(`ok   byes stamped (${stamped.filled} players, ${stamped.missing} without a pro team)`);
  }

  /* ---------- 6. nflverse usage data ---------- */
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
