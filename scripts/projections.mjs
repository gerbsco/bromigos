// scripts/projections.mjs
//
// Writes data/projections.json: a second opinion on every rostered player,
// keyed by ESPN player id so the app can blend it with the ESPN number it
// already has.
//
//   node scripts/projections.mjs
//
// Node 20+ for built-in fetch. No dependencies, no keys.
//
// Why only one extra source: the projections themselves are easy to get, but
// matching a player across providers is not. Every provider has its own ids, so
// a bad match produces a plausible wrong number rather than an error, which is
// the worst possible failure for a start/sit call. One extra source through a
// maintained crosswalk is worth more than three through a guess.
//
// FantasyPros ECR is deliberately absent. Their consensus is the number most
// people mean, and using it would breach their API terms.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SEASON = "2026";
const OUT = "data/projections.json";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; BromigosBot/1.0)", "Accept": "*/*" };

const WANT = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

async function getText(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
async function getJSON(url) { return JSON.parse(await getText(url)); }

/* Candidates are tried in order, but a 200 is not success. nflverse publishes
   several files under similar names and only some carry cross-provider ids, so
   a candidate that parses to nothing useful counts as a miss and the search
   continues. Reporting the size is what makes a silent zero visible. */
async function firstWorking(label, urls, handler, usable = out => !!out) {
  for (const url of urls) {
    const name = url.split("/").pop().split("?")[0];
    try {
      const out = await handler(url);
      if (!usable(out)) {
        console.log(`     ${label} miss ${name} (fetched, nothing usable in it)`);
        continue;
      }
      console.log(`ok   ${label} <- ${name}`);
      return out;
    } catch (err) {
      console.log(`     ${label} miss ${name} (${err.message})`);
    }
  }
  throw new Error(`no working url for ${label}`);
}

export function parseCSV(text) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
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
  const head = split(lines[0]).map(h => h.trim().toLowerCase());
  return lines.slice(1).map(l => {
    const c = split(l), row = {};
    head.forEach((h, i) => { row[h] = c[i] === "" || c[i] === "NA" ? null : c[i]; });
    return row;
  });
}

/* sleeper id -> espn id. Column names differ between the crosswalks, so accept
   any of the spellings each publishes. */
export function crosswalk(rows) {
  const map = {};
  (rows || []).forEach(r => {
    const sleeper = r.sleeper_id || r.sleeper || r.sleeperid;
    const espn = r.espn_id || r.espn || r.espnid;
    if (!sleeper || !espn) return;
    map[String(sleeper)] = String(espn);
  });
  return map;
}

/* Sleeper hands back either a keyed object or a list depending on endpoint. */
export function readSleeper(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Object.keys(payload || {}).map(k => ({ player_id: k, ...(payload[k] || {}) }));

  const out = {};
  rows.forEach(r => {
    const id = r.player_id || r.playerId || (r.player && r.player.player_id);
    if (!id) return;
    const stats = r.stats || r;
    const pts = stats.pts_half_ppr ?? stats.pts_ppr ?? stats.pts_std;
    if (typeof pts !== "number") return;
    const pos = (r.position || (r.player && r.player.position) || "").toUpperCase();
    if (pos && !WANT.has(pos)) return;
    out[String(id)] = Math.round(pts * 10) / 10;
  });
  return out;
}

/* sleeper projections keyed by espn id, which is what the app looks up by */
export function keyByEspn(sleeperPoints, sleeperToEspn) {
  const out = {};
  Object.keys(sleeperPoints).forEach(sid => {
    const espn = sleeperToEspn[sid];
    if (espn) out[espn] = sleeperPoints[sid];
  });
  return out;
}

/* the week ESPN thinks we are in, read off the file the nightly job already
   wrote, so the two never disagree about which week is live */
export function currentWeek(league) {
  const n = league && league.scoringPeriodId;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

async function main() {
  let league = null;
  try { league = JSON.parse(readFileSync("data/league.json", "utf8")); }
  catch (e) { console.log("     no data/league.json yet"); }
  const week = currentWeek(league);
  console.log(`ok   week ${week}`);

  /* DynastyProcess db_playerids is the maintained cross-provider table and goes
     first. nflverse players.csv fetches fine but is a roster file with no ESPN
     or Sleeper columns at all, which is why it used to win and yield nothing. */
  const ids = await firstWorking("player crosswalk", [
    "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv",
    "https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv",
    "https://github.com/nflverse/nflverse-data/releases/download/players_components/ff_playerids.csv",
    "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv"
  ], async url => crosswalk(parseCSV(await getText(url))),
     map => Object.keys(map).length > 500);
  console.log(`ok   crosswalk (${Object.keys(ids).length} players)`);

  const sleeper = await firstWorking("sleeper projections", [
    `https://api.sleeper.app/projections/nfl/${SEASON}/${week}?season_type=regular`,
    `https://api.sleeper.app/v1/projections/nfl/regular/${SEASON}/${week}`
  ], async url => readSleeper(await getJSON(url)),
     pts => Object.keys(pts).length > 50);
  console.log(`ok   sleeper (${Object.keys(sleeper).length} projections)`);

  const players = keyByEspn(sleeper, ids);
  const rate = Object.keys(sleeper).length
    ? Object.keys(players).length / Object.keys(sleeper).length : 0;
  console.log(`ok   matched ${Object.keys(players).length} of ${Object.keys(sleeper).length}`
    + ` sleeper projections to an ESPN id (${Math.round(rate * 100)}%)`);

  if (!Object.keys(players).length) {
    throw new Error("Nothing matched to an ESPN id - aborting so the last good file survives.");
  }
  if (rate < 0.4) {
    console.log("     low match rate, the crosswalk columns may have moved again");
  }

  mkdirSync("data", { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    season: SEASON, week, source: "sleeper", players
  }));
  console.log(`\nwrote ${OUT} (week ${week}, ${Object.keys(players).length} players matched)\n`);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch(err => { console.error(err); process.exit(1); });
}
