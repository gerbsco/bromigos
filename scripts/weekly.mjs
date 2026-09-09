// scripts/weekly.mjs
// Builds data/weekly.json: every manager's pack for the most recently
// completed week, with superlatives assigned by fixed rules.
//
//   node scripts/weekly.mjs
//
// No API keys. No dependencies. Requires Node 20+ for built-in fetch.
//
// A week is only published once every matchup in it has a winner, which in
// practice means Tuesday morning after Monday night settles. That is the whole
// trigger: the file appears, and the app drops everyone's pack on next login.
//
// Prose is not generated here. If data/weekly.json already holds a headline and
// body for this same week, they are preserved and only the packs refresh.
//
// The file also carries an archive of every completed week's packs, under
// `history`. Cards live in localStorage on whichever phone opened the pack, so
// a new device, a cleared Safari or a name change would otherwise lose a
// season's collection. A card is a pure function of its pack payload and the
// week number, so the archive is enough for the app to rebuild a binder
// exactly, picture for picture.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ownerMap as ownersFor, rosterReport } from "./managers.mjs";

const LEAGUE_ID = "24869044";
const SEASON = "2026";
const OUT = "data/weekly.json";
const ESPN = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}` +
             `/segments/0/leagues/${LEAGUE_ID}`;
const UA = { "User-Agent": "Mozilla/5.0 (compatible; BromigosBot/1.0)", "Accept": "*/*" };

const BENCH_SLOTS = new Set([20, 21]);   // 20 bench, 21 IR

/* ---------- flavour pools, rotated by week so week 8 never reads like week 2 ---------- */
const FLAVOUR = {
  "Scoring Machine": [
    "Most points in the league. Everyone else played for second.",
    "Put up a number nobody came close to touching.",
    "The kind of week that makes people check your roster for cheating.",
    "Scored like the waiver wire owed them money."
  ],
  "Walking Disaster": [
    "Lowest score in the league. Not close either.",
    "Ten teams played. This was the tenth.",
    "A full week of football happened and almost none of it helped.",
    "Somewhere in there, a kicker outscored a first rounder."
  ],
  "Blowout King": [
    "Biggest margin of the week. Over by noon.",
    "Won so early the Sunday games were a formality.",
    "Not a matchup so much as a scheduled beating.",
    "Their opponent was mathematically finished before the late window."
  ],
  "Chair Recipient": [
    "Lost by more than anyone else. It was not competitive.",
    "Beaten by a margin normally reserved for preseason.",
    "Took the worst loss in the league and it was not particularly close.",
    "The scoreboard stopped being a competition and became a receipt."
  ],
  "Heartbreaker": [
    "Beaten by less than a garbage time score.",
    "Closest loss of the week. Every lineup decision haunts this one.",
    "Lost by an amount you could have found on your bench.",
    "One flag, one snap, one anything, and this is a win."
  ],
  "Sunday Scaries": [
    "Thin enough to ruin your evening anyway.",
    "Won the closest game of the week and aged four years doing it.",
    "A win that felt like a loss right up until it did not.",
    "Survived. Nobody would call it comfortable."
  ],
  "Bench Champion": [
    "Your bench would have won it. You did not play them.",
    "The points were on the roster. They were just in the wrong half.",
    "Out-managed by the version of you that sets no lineup at all.",
    "Left more on the bench than most teams scored in total."
  ],
  "Paper Champion": [
    "Beat the projection by more than anyone. The model owes an apology.",
    "Wildly outran what anyone expected, including them.",
    "Projections said one thing. The scoreboard disagreed loudly.",
    "Overachieved by a margin that will not repeat."
  ],
  "Fraud Watch": [
    "Won while scoring near the bottom. The schedule did the work.",
    "A win, technically. The tape is not flattering.",
    "Beat somebody while putting up a losing number everywhere else.",
    "The record improved. Nothing else did."
  ],
  "Schedule Victim": [
    "Scored enough to beat most of the league. Drew the one team it would not.",
    "A top-three score and a loss. That is the whole story.",
    "Would have won against seven other opponents this week.",
    "Punished for nothing except who they were scheduled against."
  ],
};

/* title -> [reason template, art, rare, good] where good false means Dishonour.
   The reason is factual and shows on the card under the name, so a pull always
   explains itself. The flavour above stays a joke. */
const AWARDS = {
  "Scoring Machine": { art:"img:firepit", rare:true,  good:true,  why:s => `Highest score in the league, ${s.pts}` },
  "Walking Disaster": { art:"\u{1FAA6}",   rare:false, good:false, why:s => `Lowest score in the league, ${s.pts}` },
  "Blowout King":     { art:"img:point",   rare:true,  good:true,  why:s => `Biggest winning margin, ${s.mrg}` },
  "Chair Recipient":  { art:"img:chair",   rare:false, good:false, why:s => `Biggest losing margin, ${s.mrg}` },
  "Heartbreaker":     { art:"img:sob",     rare:false, good:true,
    why:s => s.tightest ? `Closest loss of the week, ${s.mrg}` : `Lost by ${s.mrg}, inside five points` },
  "Sunday Scaries":   { art:"img:pout",    rare:false, good:true,
    why:s => s.tightest ? `Closest win of the week, ${s.mrg}` : `Won by ${s.mrg}, inside five points` },
  "Bench Champion":   { art:"\u{1F648}",   rare:false, good:false, why:s => `Bench outscored the starters by ${s.gap}` },
  "Paper Champion":   { art:"img:copium",  rare:false, good:true,
    why:s => s.best ? `Beat projection by ${s.gap}, most in the league`
                    : `Beat projection by ${s.gap}` },
  "Fraud Watch":      { art:"img:copium",  rare:false, good:true,  why:s => `Won while scoring ${s.rank} of 10` },
  "Schedule Victim":  { art:"img:pout",    rare:false, good:true,  why:s => `Lost while scoring ${s.rank} of 10` }
};

/* Every award is issued once a week if anyone qualifies. Where several managers
   qualify for the same one it goes to whoever has nothing yet, so cards spread
   across the league. Where only one manager qualifies it goes to him even if he
   already has a card, because an award going unclaimed is worse than a double.
   Order below is the order they are handed out. */

const pick = (list, wk) => list[Math.abs(wk || 0) % list.length];
const one = n => n.toFixed(1);
const ord = n => ["1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th"][n - 1] || (n + "th");
const pause = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, extra = {}) {
  const res = await fetch(url, { headers: { ...UA, ...extra } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* Name resolution is shared with h2h.mjs. Packs are keyed by manager name, so
   if these two ever disagreed a manager would quietly get no pack. */
function ownerMap(teamDoc) {
  const full = ownersFor(teamDoc);
  const flat = {};
  Object.keys(full).forEach(id => { flat[id] = full[id].name; });
  return flat;
}

/* manager name -> team logo, so a card can keep the badge from its own week */
export function crestMap(teamDoc, owners) {
  const out = {};
  ((teamDoc && teamDoc.teams) || []).forEach(t => {
    const name = owners[t.id];
    if (name && t.logo) out[name] = t.logo;
  });
  return out;
}

/* actual and projected points for one side of a matchup */
export function sideTotals(side, week) {
  const entries = (side && ((side.rosterForCurrentScoringPeriod || {}).entries
    || (side.rosterForMatchupPeriod || {}).entries)) || [];
  let bench = 0, projected = 0, high = 0, counted = 0;

  entries.forEach(e => {
    const p = (e.playerPoolEntry || {}).player || {};
    const stats = p.stats || [];
    const at = s => (s && typeof s.appliedTotal === "number") ? s.appliedTotal : 0;
    const real = at(stats.find(s => s.statSourceId === 0 && s.scoringPeriodId === week));
    const proj = at(stats.find(s => s.statSourceId === 1 && s.scoringPeriodId === week));

    if (BENCH_SLOTS.has(e.lineupSlotId)) { bench += real; }
    else { projected += proj; counted++; if (real > high) high = real; }
  });

  return { bench, projected, high, starters: counted };
}

/* every matchup period where every game has a winner, oldest first */
export function completeWeeks(schedule) {
  const byWeek = new Map();
  (schedule || []).forEach(m => {
    const w = m.matchupPeriodId;
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(m);
  });
  const out = [];
  for (const [w, games] of byWeek) {
    const real = games.filter(g => g.home && g.away);
    if (!real.length) continue;
    if (real.every(g => g.winner && g.winner !== "UNDECIDED")) out.push(w);
  }
  return out.sort((a, b) => a - b);
}

/* the most recent matchup period where every game has a winner */
export function latestCompleteWeek(schedule) {
  const weeks = completeWeeks(schedule);
  return weeks.length ? weeks[weeks.length - 1] : 0;
}

/* one row per manager for the given week, before awards are assigned */
export function weekRows(schedule, owners, week) {
  const rows = [];
  (schedule || []).forEach(m => {
    if (m.matchupPeriodId !== week || !m.home || !m.away) return;
    const push = (me, them) => {
      const name = owners[me.teamId];
      if (!name) return;
      const t = sideTotals(me, week);
      rows.push({
        manager: name,
        myScore: Math.round((me.totalPoints || 0) * 100) / 100,
        oppScore: Math.round((them.totalPoints || 0) * 100) / 100,
        opponent: owners[them.teamId] || "Opponent",
        bench: t.bench, projected: t.projected, high: t.high
      });
    };
    push(m.home, m.away);
    push(m.away, m.home);
  });
  return rows;
}

/* ---------- settled results, frozen ----------
   The pick'em leaderboard and the power rankings both recompute from ESPN's
   schedule every time the page paints. Nothing is stored, so if that view ever
   stops reporting completed weeks, or a pull writes a schedule missing them,
   every past score silently becomes zero with nothing to fall back on.

   These are the outcomes, written once the week is final and never rewritten.
   The game id has to match the one the app keys picks by, which is ESPN's
   matchup id with a home-away fallback, or a frozen result would not line up
   with the pick it is meant to score. */
export function weekResults(schedule, owners, week) {
  const out = [];
  (schedule || []).forEach(m => {
    if (m.matchupPeriodId !== week || !m.home || !m.away) return;
    if (!m.winner || m.winner === "UNDECIDED") return;
    const home = owners[m.home.teamId], away = owners[m.away.teamId];
    if (!home || !away) return;
    out.push({
      id: String(m.id != null ? m.id : m.home.teamId + "-" + m.away.teamId),
      home, away,
      homePts: Math.round((m.home.totalPoints || 0) * 100) / 100,
      awayPts: Math.round((m.away.totalPoints || 0) * 100) / 100
    });
  });
  return out;
}

/* running record through the given week */
export function records(schedule, owners, week) {
  const rec = {};
  (schedule || []).forEach(m => {
    if (m.matchupPeriodId > week || !m.home || !m.away) return;
    if (!m.winner || m.winner === "UNDECIDED") return;
    const h = owners[m.home.teamId], a = owners[m.away.teamId];
    if (!h || !a) return;
    rec[h] ||= [0, 0]; rec[a] ||= [0, 0];
    const hp = m.home.totalPoints || 0, ap = m.away.totalPoints || 0;
    if (hp > ap) { rec[h][0]++; rec[a][1]++; }
    else if (ap > hp) { rec[a][0]++; rec[h][1]++; }
  });
  return rec;
}

/* the rules */
export function assignAwards(rows, week) {
  if (!rows.length) return rows;

  const sorted = [...rows].sort((a, b) => b.myScore - a.myScore);
  sorted.forEach((r, i) => { r.rank = i + 1; });

  const margin = r => r.myScore - r.oppScore;
  const wins = rows.filter(r => margin(r) > 0);
  const losses = rows.filter(r => margin(r) < 0);
  const top = sorted[0].myScore;
  const bot = sorted[sorted.length - 1].myScore;

  /* Hand one award to the strongest candidate who has nothing yet. If they all
     already have something, it still goes out, to the strongest of them. */
  const claim = (candidates, title, factsFor) => {
    const list = (candidates || []).filter(Boolean);
    if (!list.length) return;
    const target = list.find(r => !r.awards || !r.awards.length) || list[0];
    const def = AWARDS[title];
    const f = factsFor(target);
    (target.awards ||= []).push({
      title,
      stat: f.stat,
      reason: def.why(f),
      desc: pick(FLAVOUR[title], week),
      art: def.art,
      rare: def.rare,
      good: def.good
    });
  };

  const bigWin  = wins.length   ? Math.max(...wins.map(margin))   : null;
  const bigLoss = losses.length ? Math.min(...losses.map(margin)) : null;

  /* Heartbreaker and Sunday Scaries take anything inside five points, and if no
     game was that close the tightest game of the week still gets them. These
     should never silently vanish on a blowout week. */
  const tight = Math.min(...rows.map(r => Math.abs(margin(r))));
  const cut = Math.max(5, tight);
  const isTightest = r => Math.abs(margin(r)) === tight;

  const benchers = rows.filter(r => r.bench > r.myScore)
    .sort((a, b) => (b.bench - b.myScore) - (a.bench - a.myScore));
  const overs = rows.filter(r => r.projected > 0 && r.myScore > r.projected)
    .sort((a, b) => (b.myScore - b.projected) - (a.myScore - a.projected));
  const bestOver = overs.length ? overs[0].myScore - overs[0].projected : null;

  const bottomThree = new Set(sorted.slice(-3).map(r => r.manager));
  const topThree = new Set(sorted.slice(0, 3).map(r => r.manager));

  /* Candidate lists are ordered strongest first. The first four name a single
     extreme, so only the true holder is ever eligible and the reason line cannot
     become a lie. The rest are shared, and their reason text adapts: it only
     claims "most in the league" or "closest of the week" when that is true of
     the manager who actually received it. */
  const plan = [
    ["Scoring Machine", sorted.filter(r => r.myScore === top),
      r => ({ stat: one(r.myScore) + " points", pts: one(r.myScore) })],

    ["Walking Disaster", sorted.filter(r => r.myScore === bot),
      r => ({ stat: one(r.myScore) + " points", pts: one(r.myScore) })],

    ["Blowout King", wins.filter(r => margin(r) === bigWin),
      r => ({ stat: "Won by " + one(margin(r)), mrg: one(margin(r)) })],

    ["Chair Recipient", losses.filter(r => margin(r) === bigLoss),
      r => ({ stat: "Lost by " + one(-margin(r)), mrg: one(-margin(r)) })],

    ["Paper Champion", overs,
      r => ({ stat: "+" + one(r.myScore - r.projected) + " over",
              gap: one(r.myScore - r.projected),
              best: (r.myScore - r.projected) === bestOver })],

    ["Heartbreaker", losses.filter(r => Math.abs(margin(r)) <= cut)
      .sort((a, b) => Math.abs(margin(a)) - Math.abs(margin(b))),
      r => ({ stat: "Lost by " + one(-margin(r)), mrg: one(-margin(r)),
              tightest: isTightest(r) })],

    ["Sunday Scaries", wins.filter(r => margin(r) <= cut)
      .sort((a, b) => margin(a) - margin(b)),
      r => ({ stat: "Won by " + one(margin(r)), mrg: one(margin(r)),
              tightest: isTightest(r) })],

    ["Bench Champion", benchers,
      r => ({ stat: one(r.bench - r.myScore) + " wasted",
              gap: one(r.bench - r.myScore) })],

    ["Fraud Watch", wins.filter(r => bottomThree.has(r.manager))
      .sort((a, b) => a.myScore - b.myScore),
      r => ({ stat: one(r.myScore) + " points", rank: ord(r.rank) })],

    ["Schedule Victim", losses.filter(r => topThree.has(r.manager))
      .sort((a, b) => b.myScore - a.myScore),
      r => ({ stat: one(r.myScore) + " points", rank: ord(r.rank) })]
  ];

  plan.forEach(([title, candidates, factsFor]) => claim(candidates, title, factsFor));

  /* No filler. A manager the week passed by gets a result card and nothing
     else, which keeps every superlative in circulation worth having. */
  rows.forEach(r => { r.awards ||= []; });

  return rows;
}

export function buildPacks(schedule, owners, week, crests) {
  const rows = weekRows(schedule, owners, week);
  if (!rows.length) return {};
  const rec = records(schedule, owners, week);
  const scores = rows.map(r => r.myScore);
  const top = Math.max(...scores), bot = Math.min(...scores);

  assignAwards(rows, week);

  const packs = {};
  rows.forEach(r => {
    packs[r.manager] = {
      manager: r.manager,
      myScore: r.myScore, oppScore: r.oppScore, opponent: r.opponent,
      rank: r.rank,
      record: rec[r.manager] ? rec[r.manager][0] + "-" + rec[r.manager][1] : null,
      bench: Math.round(r.bench * 10) / 10,
      high: Math.round(r.high * 10) / 10,
      projected: Math.round(r.projected * 10) / 10,
      leagueHigh: r.myScore === top,
      leagueLow: r.myScore === bot,
      awards: r.awards
    };
    /* Stored rather than resolved by the app, so a card rebuilt in December
       carries the badge that team was flying in week 3 rather than whatever
       they have renamed themselves to since. Left off entirely when there is
       no logo, so nothing downstream has to handle a null. */
    const crest = crests && crests[r.manager];
    if (crest) packs[r.manager].crest = crest;
  });
  return packs;
}

/* Plain, factual, no jokes. This is a placeholder, not a writeup. */
export function autoProse(packs, week) {
  const rows = Object.values(packs);
  if (!rows.length) return {};
  const by = t => rows.find(r => r.awards.some(a => a.title === t));
  const high = by("Scoring Machine"), low = by("Walking Disaster");
  const blow = by("Blowout King"), tightW = by("Sunday Scaries");

  const body = [];
  if (high) body.push(`${high.manager} led the week with ${high.myScore.toFixed(1)}, `
    + `beating ${high.opponent}'s ${high.oppScore.toFixed(1)}.`);
  if (blow && (!high || blow.manager !== high.manager)) {
    body.push(`${blow.manager} took the widest win of the week over ${blow.opponent}, `
      + `${blow.myScore.toFixed(1)} to ${blow.oppScore.toFixed(1)}.`);
  }
  if (tightW) body.push(`The closest game went to ${tightW.manager} over ${tightW.opponent}, `
    + `${tightW.myScore.toFixed(1)} to ${tightW.oppScore.toFixed(1)}.`);
  if (low) body.push(`${low.manager} finished last in scoring with ${low.myScore.toFixed(1)}.`);

  const cards = rows.reduce((n, r) => n + r.awards.length, 0);
  body.push(`${cards} superlative${cards === 1 ? "" : "s"} went out across `
    + `${rows.filter(r => r.awards.length).length} of ${rows.length} teams.`);

  return {
    auto: true,
    headline: `Week ${week} results`,
    body
  };
}

/* ---------- the archive ----------
   Everything the app needs to rebuild a binder it has lost. Weeks already in
   the file are kept exactly as they were written: those are the packs people
   actually pulled, and a rule change later must not quietly rewrite somebody's
   week 3. Missing weeks are fetched and built, so the archive repairs itself
   if the file is ever truncated or a run fails partway. */
export function mergeHistory(existing, additions) {
  const out = {};
  Object.keys(existing || {}).forEach(k => { out[k] = existing[k]; });
  Object.keys(additions || {}).forEach(k => { if (!out[k]) out[k] = additions[k]; });
  return out;
}

async function main() {
  const teamDoc = await getJSON(`${ESPN}?view=mTeam`);
  const owners = ownerMap(teamDoc);
  const crests = crestMap(teamDoc, owners);
  const matchDoc = await getJSON(`${ESPN}?view=mMatchup`);
  const schedule = matchDoc.schedule || [];

  const weeks = completeWeeks(schedule);
  const week = weeks.length ? weeks[weeks.length - 1] : 0;
  if (!week) {
    console.log("No completed week yet. Nothing to publish.");
    return;
  }
  console.log(`ok   latest completed week: ${week}`);
  console.log(`ok   completed weeks on file: ${weeks.join(", ")}`);

  /* Read the previous file once: it carries the written prose and the archive
     of weeks already published. */
  let old = null;
  try { old = JSON.parse(readFileSync(OUT, "utf8")); } catch (e) { /* no file yet */ }
  const oldHistory = (old && old.history) || {};
  /* A file written before the archive existed still holds its own week's packs,
     which would otherwise be the one week nobody could recover. */
  if (old && old.week && old.packs && !oldHistory[String(old.week)]) {
    oldHistory[String(old.week)] = old.packs;
    console.log(`ok   adopted week ${old.week} from the previous file`);
  }

  const detailFor = async w => {
    const d = await getJSON(`${ESPN}?view=mMatchup&view=mRoster&scoringPeriodId=${w}`);
    return d.schedule || schedule;
  };

  /* rosters carry the bench and projection numbers, and only the per-week
     request includes them */
  const packs = buildPacks(await detailFor(week), owners, week, crests);

  if (!Object.keys(packs).length) {
    throw new Error("Week resolved but no packs built - aborting so the last good file survives.");
  }

  const built = {};
  let fetched = 0;
  for (const w of weeks) {
    if (oldHistory[String(w)]) continue;
    if (w === week) { built[String(w)] = packs; continue; }
    try {
      await pause(400);
      const p = buildPacks(await detailFor(w), owners, w, crests);
      if (Object.keys(p).length) { built[String(w)] = p; fetched++; }
      else console.log(`     week ${w} built nothing, left out of the archive`);
    } catch (err) {
      console.log(`     week ${w} unavailable for the archive (${err.message})`);
    }
  }
  const history = mergeHistory(oldHistory, built);

  /* Same policy as the packs: a week already frozen is left exactly as it was,
     so a stat correction in November cannot rewrite October's leaderboard. */
  const oldResults = (old && old.results) || {};
  const newResults = {};
  weeks.forEach(w => {
    if (oldResults[String(w)]) return;
    const r = weekResults(schedule, owners, w);
    if (r.length) newResults[String(w)] = r;
  });
  const results = mergeHistory(oldResults, newResults);
  const frozen = Object.values(results).reduce((n, g) => n + g.length, 0);
  console.log(`ok   results frozen: ${frozen} games over`
    + ` ${Object.keys(results).length} weeks`
    + (Object.keys(newResults).length ? `, ${Object.keys(newResults).length} new` : ""));
  console.log(`ok   archive: ${Object.keys(history).length} of ${weeks.length} weeks`
    + (fetched ? `, ${fetched} rebuilt this run` : "")
    + ` (${Object.keys(history).sort((a,b)=>a-b).join(", ")})`);

  /* A written headline and body always win and are never touched again. If none
     exists, fall back to a plain factual recap marked auto:true, so the page is
     never blank on a Tuesday and a real writeup can still replace it later. */
  let prose = autoProse(packs, week);
  if (old && old.week === week && old.headline && !old.auto) {
    prose = { headline: old.headline, body: old.body, changed: old.changed };
    console.log("     kept the written writeup for this week");
  }

  /* The preseason power ranking, frozen the first time this runs and never
     touched again. The app can recompute it from today's rosters, but by
     November those are not the preseason rosters, and a retrospective that
     quietly rewrites what it predicted is worth nothing. */
  const preseason = (old && Array.isArray(old.preseason) && old.preseason.length)
    ? old.preseason : null;
  if (preseason) console.log(`ok   preseason ranking held (${preseason.length} teams)`);
  else console.log("     no preseason ranking on file, the app will post one");

  mkdirSync("data", { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    week,
    posted: new Date().toISOString().slice(0, 10),
    ...prose,
    ...(preseason ? { preseason } : {}),
    packs,
    history,
    results
  }, null, 2));
  console.log(prose.auto ? "     wrote a placeholder recap, replace it with a real one"
                         : "     kept the written recap");

  console.log(`\nwrote ${OUT} (week ${week}, ${Object.keys(packs).length} managers,`
    + ` ${Object.keys(history).length} weeks archived)`);
  rosterReport(new Map(Object.keys(packs).map(m => [m, packs[m].awards.length])));
  Object.values(packs).forEach(p => {
    console.log(`  ${p.manager.padEnd(10)} ${one(p.myScore).padStart(6)} vs ${
      one(p.oppScore).padStart(6)} ${p.opponent.padEnd(10)} ${
      p.awards.length ? p.awards[0].title : "no card"}`);
  });
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch(err => { console.error(err); process.exit(1); });
}
