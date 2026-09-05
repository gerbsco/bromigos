/* test/settings.test.mjs
 *
 * The lineup shape, the regular season length and the playoff field used to be
 * hardcoded from what the league looked like in 2025. A settings change nobody
 * mentions would then corrupt every projection, start/sit call and playoff
 * number, silently and plausibly. These read from ESPN instead.
 */

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

const live = (slotCounts, spots, schedule) => JSON.stringify({
  settings:{ draftDetail:{ drafted:true }, settings:{
    scheduleSettings:{ playoffTeamCount: spots, matchupPeriodCount: 17 },
    rosterSettings:{ lineupSlotCounts: slotCounts } }},
  teams:{ members:[], teams:[] },
  matchups:{ schedule }
});

const SCHED = [
  { matchupPeriodId:13, playoffTierType:"NONE", home:{teamId:1}, away:{teamId:2}, winner:"HOME" },
  { matchupPeriodId:14, playoffTierType:"WINNERS_BRACKET", home:{teamId:1}, away:{teamId:2}, winner:"HOME" }
];

/* ---------- defaults hold until data arrives ---------- */
{
  const { getVar } = boot({ search:"?pack=1", now:"2026-10-20T12:00:00Z" });
  ok("a lineup exists before league.json loads", () => getVar("SLOTS").length > 0);
  ok("the season length has a sane default", () => getVar("REG_WEEKS") > 0);
  ok("the playoff field has a sane default", () => getVar("PLAYOFF_SPOTS") > 0);
}

/* ---------- and are replaced by the real thing ---------- */
{
  const { sandbox: S, setVar, getVar } = boot({ search:"?pack=1", now:"2026-10-20T12:00:00Z" });
  setVar("LIVE", live({ "0":1,"2":2,"4":3,"6":1,"23":1,"16":1,"17":1,"20":7 }, 6, SCHED));
  S.syncLeagueSettings();

  ok("the lineup matches the slot counts", () => {
    const k = getVar("SLOTS").map(x => x.k).join(",");
    return [k === "QB,RB,RB,WR,WR,WR,TE,FLEX,D/ST,K", k];
  });
  ok("bench and IR are not treated as starting slots", () =>
    getVar("SLOTS").every(x => x.k !== "BE" && x.k !== "IR"));
  ok("narrow slots come before the flex", () => {
    const k = getVar("SLOTS").map(x => x.k);
    return [k.indexOf("TE") < k.indexOf("FLEX"), k.join(",")];
  });
  ok("the playoff field is read, not assumed", () => getVar("PLAYOFF_SPOTS") === 6);
  ok("the regular season stops before the playoff week", () =>
    [getVar("REG_WEEKS") === 13, getVar("REG_WEEKS")]);
}

/* ---------- a different league shape ---------- */
{
  const { sandbox: S, setVar, getVar } = boot({ search:"?pack=1", now:"2026-10-20T12:00:00Z" });
  /* superflex, two flex, four playoff teams */
  setVar("LIVE", live({ "0":1,"7":1,"2":2,"4":2,"6":1,"23":2,"16":1,"17":1 }, 4,
    [{ matchupPeriodId:15, playoffTierType:"NONE", home:{teamId:1}, away:{teamId:2}, winner:"HOME" }]));
  S.syncLeagueSettings();

  ok("a superflex league gets a superflex slot", () =>
    [getVar("SLOTS").some(x => x.k === "SFLX"), getVar("SLOTS").map(x=>x.k).join(",")]);
  ok("the superflex accepts a quarterback", () => {
    const sf = getVar("SLOTS").find(x => x.k === "SFLX");
    return sf.elig.indexOf("QB") >= 0;
  });
  ok("two flex slots produce two flex slots", () =>
    getVar("SLOTS").filter(x => x.k === "FLEX").length === 2);
  ok("a four team playoff is honoured", () => getVar("PLAYOFF_SPOTS") === 4);
  ok("a longer regular season is honoured", () => getVar("REG_WEEKS") === 15);
}

/* ---------- partial or junk settings must not wipe the defaults ---------- */
{
  const { sandbox: S, setVar, getVar } = boot({ search:"?pack=1", now:"2026-10-20T12:00:00Z" });
  const before = getVar("SLOTS").length;
  setVar("LIVE", JSON.stringify({ settings:{ settings:{} }, teams:{teams:[]}, matchups:{schedule:[]} }));
  S.syncLeagueSettings();
  ok("empty settings leave the lineup alone", () => getVar("SLOTS").length === before);
  ok("empty settings leave the playoff field alone", () => getVar("PLAYOFF_SPOTS") === 6);

  setVar("LIVE", "null");
  ok("no data at all does not throw", () => { S.syncLeagueSettings(); return true; });
}
{
  const { sandbox: S, setVar, getVar } = boot({ search:"?pack=1", now:"2026-10-20T12:00:00Z" });
  setVar("LIVE", live({ "20":7, "21":1 }, 6, SCHED));   // bench and IR only
  S.syncLeagueSettings();
  ok("a lineup of nothing but bench is rejected", () =>
    [getVar("SLOTS").length > 0, getVar("SLOTS").map(x=>x.k).join(",")]);
}

console.log(`\n  ${passes} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
