/* test/projections.test.mjs
 *
 * Two halves. The build script's parsing and crosswalk, offline. Then the
 * blending in the app, because a wrong match produces a plausible wrong number
 * rather than an error, which is the worst failure mode a start/sit tool has.
 */

import { parseCSV, crosswalk, readSleeper, keyByEspn, currentWeek }
  from "../scripts/projections.mjs";
import { boot } from "./harness.mjs";

let fails = 0, passes = 0;
function ok(name, fn){
  let pass = false, extra = "";
  try {
    const r = fn();
    if(Array.isArray(r)){ pass = !!r[0]; extra = r[1] === undefined ? "" : String(r[1]); }
    else pass = !!r;
  } catch(e){ pass = false; extra = "threw: " + e.message; }
  if(pass) passes++;
  else { fails++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
}

/* ---------- CSV ---------- */
ok("parses a header and rows", () => {
  const r = parseCSV("espn_id,sleeper_id,name\n123,4567,Bijan\n");
  return [r.length === 1 && r[0].espn_id === "123" && r[0].sleeper_id === "4567",
          JSON.stringify(r)];
});
ok("headers are case insensitive", () => parseCSV("ESPN_ID,SLEEPER_ID\n1,2\n")[0].espn_id === "1");
ok("quoted commas survive", () => {
  const r = parseCSV('espn_id,name\n9,"Smith, Jr."\n');
  return [r[0].name === "Smith, Jr.", r[0].name];
});
ok("NA becomes null", () => parseCSV("espn_id,sleeper_id\n1,NA\n")[0].sleeper_id === null);
ok("empty input does not throw", () => parseCSV("").length === 0 && parseCSV(null).length === 0);

/* ---------- crosswalk ---------- */
ok("maps sleeper id to espn id", () => {
  const m = crosswalk([{ espn_id:"123", sleeper_id:"4567" }]);
  return [m["4567"] === "123", JSON.stringify(m)];
});
ok("accepts the other column spellings", () => {
  const m = crosswalk([{ espn:"11", sleeper:"22" }, { espnid:"33", sleeperid:"44" }]);
  return [m["22"] === "11" && m["44"] === "33", JSON.stringify(m)];
});
ok("a row missing either id is skipped, never guessed", () => {
  const m = crosswalk([{ espn_id:"1" }, { sleeper_id:"2" }, { espn_id:"3", sleeper_id:"4" }]);
  return [Object.keys(m).length === 1 && m["4"] === "3", JSON.stringify(m)];
});

/* ---------- sleeper payloads ---------- */
ok("reads the keyed-object shape", () => {
  const r = readSleeper({ "4567": { stats:{ pts_half_ppr: 14.62 }, position:"RB" } });
  return [r["4567"] === 14.6, JSON.stringify(r)];
});
ok("reads the list shape", () => {
  const r = readSleeper([{ player_id:"99", position:"WR", stats:{ pts_half_ppr: 9.04 } }]);
  return [r["99"] === 9, JSON.stringify(r)];
});
ok("prefers half PPR, which is this league's scoring", () => {
  const r = readSleeper([{ player_id:"1", position:"RB",
    stats:{ pts_std: 8, pts_ppr: 14, pts_half_ppr: 11 } }]);
  return [r["1"] === 11, r["1"]];
});
ok("falls back when half PPR is absent", () =>
  readSleeper([{ player_id:"1", position:"RB", stats:{ pts_ppr: 14 } }])["1"] === 14);
ok("non fantasy positions are dropped", () =>
  Object.keys(readSleeper([{ player_id:"1", position:"OT", stats:{ pts_half_ppr: 3 } }])).length === 0);
ok("a row with no points is dropped rather than zeroed", () =>
  Object.keys(readSleeper([{ player_id:"1", position:"RB", stats:{} }])).length === 0);
ok("a junk payload does not throw", () =>
  Object.keys(readSleeper(null)).length === 0 && Object.keys(readSleeper({})).length === 0);

/* ---------- keying, the part that can go quietly wrong ---------- */
ok("only matched players are written out", () => {
  const out = keyByEspn({ "4567": 14.6, "9999": 8.1 }, { "4567": "123" });
  return [Object.keys(out).length === 1 && out["123"] === 14.6, JSON.stringify(out)];
});
ok("an unmatched sleeper id is dropped, not carried under its own id", () => {
  const out = keyByEspn({ "9999": 8.1 }, {});
  return [Object.keys(out).length === 0, JSON.stringify(out)];
});

ok("week comes from the file the nightly job already wrote", () =>
  currentWeek({ scoringPeriodId: 7 }) === 7);
ok("a missing week falls back to 1", () =>
  currentWeek(null) === 1 && currentWeek({}) === 1 && currentWeek({ scoringPeriodId: 0 }) === 1);

/* ---------- blending in the app ---------- */
{
  const { sandbox: S, setVar } = boot({ search:"?pack=1", now:"2026-09-16T12:00:00Z" });
  setVar("PROJ", JSON.stringify({ week:2, players:{ "101": 18.4, "102": 9.0, "103": 0 } }));

  ok("two sources average", () => {
    const v = S.projOf({ id:101, proj:17.6 });
    return [v.blend === 18 && v.n === 2, JSON.stringify(v)];
  });
  ok("the spread is kept, not discarded", () => {
    const v = S.projOf({ id:101, proj:17.6 });
    return [v.spread === 0.8, v.spread];
  });
  ok("one source still gives a number", () => {
    const v = S.projOf({ id:999, proj:12.2 });
    return [v.blend === 12.2 && v.n === 1 && v.spread === 0, JSON.stringify(v)];
  });
  ok("no source gives zero rather than NaN", () => {
    const v = S.projOf({ id:998, proj:0 });
    return [v.blend === 0 && v.n === 0, JSON.stringify(v)];
  });
  ok("a zero from the other source is ignored, not averaged in", () => {
    const v = S.projOf({ id:103, proj:12.0 });
    return [v.blend === 12 && v.n === 1, JSON.stringify(v)];
  });

  ok("a wide disagreement is flagged", () =>
    S.projDisagrees(S.projOf({ id:102, proj:15.4 })) === true);
  ok("a close pair is not flagged", () =>
    S.projDisagrees(S.projOf({ id:101, proj:17.6 })) === false);
  ok("the threshold scales with the projection", () => {
    /* 1.0 apart on a kicker matters more than 1.0 apart on a QB */
    setVar("PROJ", JSON.stringify({ week:2, players:{ "201": 5.0, "202": 26.0 } }));
    const kicker = S.projOf({ id:201, proj:8.5 });      // 3.5 apart on a 6.75 blend
    const qb = S.projOf({ id:202, proj:24.0 });         // 2.0 apart on a 25 blend
    return [S.projDisagrees(kicker) === true && S.projDisagrees(qb) === false,
            "kicker " + kicker.spread + ", qb " + qb.spread];
  });

  ok("the chip shows the blend and the spread", () => {
    setVar("PROJ", JSON.stringify({ week:2, players:{ "101": 18.4 } }));
    const h = S.projChip({ id:101, proj:17.6 });
    return [/18\.0/.test(h) && /0\.8/.test(h), h];
  });
  ok("a single source says so instead of faking agreement", () => {
    const h = S.projChip({ id:999, proj:12.2 });
    return [/espn only/.test(h), h];
  });
  ok("nothing projected renders nothing", () => S.projChip({ id:998, proj:0 }) === "");
}

/* ---------- with no projections file at all ---------- */
{
  const { sandbox: S, byId, setVar } = boot({ search:"?pack=1", now:"2026-09-16T12:00:00Z" });
  setVar("ME", '"Scotty"');
  ok("PROJ starts null", () => S.projOf({ id:1, proj:10 }).n === 1);
  ok("the lineup still builds on ESPN alone", () => {
    S.renderTeamPage();
    return /Suggested lineup/.test(byId("teamBody").innerHTML);
  });
  ok("and says so rather than implying a consensus", () =>
    /ESPN only/.test(byId("teamBody").innerHTML));
}

/* ---------- the failure that actually happened ----------
   nflverse players.csv is a roster file. It fetches with a 200 and parses
   cleanly, and contains no espn or sleeper columns, so it produced an empty
   crosswalk and the search stopped there rather than trying the real one. */
ok("a roster file yields an empty crosswalk rather than a wrong one", () => {
  const rosterFile = parseCSV("gsis_id,display_name,position,team_abbr\n00-1,Bijan,RB,ATL\n");
  const m = crosswalk(rosterFile);
  return [Object.keys(m).length === 0, JSON.stringify(m)];
});
ok("the real crosswalk shape still maps", () => {
  const dp = parseCSV("mfl_id,sleeper_id,espn_id,name,position\n1,4567,123,Bijan,RB\n");
  const m = crosswalk(dp);
  return [m["4567"] === "123", JSON.stringify(m)];
});

console.log(`\n  ${passes} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
