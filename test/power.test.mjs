/* test/power.test.mjs
 *
 * Power rankings.
 *
 * The whole justification for this feature is that the standings lie early, so
 * the tests are built around a fixture where they do: a 3-0 team that wins by a
 * point every week and a 1-2 team that outscores everyone. If the ranking ever
 * agrees with the record here, it has stopped being worth having.
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

const NAMES = ["Scotty", "Bo", "Cody", "Ryan"];
const game = (id, wk, h, hp, a, ap) => ({
  id, matchupPeriodId: wk, winner: hp > ap ? "HOME" : "AWAY",
  home:{ teamId:h, totalPoints:hp }, away:{ teamId:a, totalPoints:ap }
});

function live(schedule){
  return JSON.stringify({
    settings:{ draftDetail:{ drafted:true } },
    teams:{
      members: NAMES.map((n,i) => ({ id:"{"+i+"}", firstName:n })),
      teams:   NAMES.map((_,i) => ({ id:i+1, owners:["{"+i+"}"] }))
    },
    matchups:{ schedule }
  });
}

/* Scotty 3-0 on three one-point wins. Cody 1-2 while scoring heavily. */
const SCHEDULE = [
  game(1,1, 1,101, 2,100), game(2,1, 3,140, 4,150),
  game(3,2, 1,102, 3,101), game(4,2, 2, 90, 4,145),
  game(5,3, 1,100, 4, 99), game(6,3, 2, 88, 3,139)
];

const at = (schedule, now = "2026-10-20T12:00:00Z") => {
  const h = boot({ search:"", now });
  h.setVar("ME", '"Scotty"');
  h.setVar("LIVE", live(schedule));
  return h;
};

/* ---------- results are read off the real schedule ---------- */
{
  const { sandbox: S } = at(SCHEDULE);
  const res = S.weeklyResults();
  ok("every manager who played appears", () =>
    [Object.keys(res).sort().join(",") === "Bo,Cody,Ryan,Scotty", Object.keys(res).join(",")]);
  ok("each has one result per week", () => Object.keys(res).every(m => res[m].length === 3));
  ok("names resolve through the alias table, not team ids", () =>
    Object.keys(res).every(m => NAMES.includes(m)));
  ok("results can be capped to an earlier week", () => {
    const two = S.weeklyResults(2);
    return [Object.keys(two).every(m => two[m].length === 2), "week cap ignored"];
  });
  ok("an unplayed game is never counted", () => {
    const h = at(SCHEDULE.concat([{ id:9, matchupPeriodId:4, winner:"UNDECIDED",
      home:{teamId:1,totalPoints:0}, away:{teamId:2,totalPoints:0} }]));
    const r = h.sandbox.weeklyResults();
    return [r["Scotty"].length === 3, r["Scotty"].length];
  });
}

/* ---------- the record lies, and the ranking should not ---------- */
{
  const { sandbox: S } = at(SCHEDULE);
  const rows = S.powerRanks();
  const rank = m => rows.findIndex(r => r.manager === m) + 1;

  ok("every manager is ranked once", () => [rows.length === 4, rows.length]);
  ok("the unbeaten team does not top the ranking", () => [rank("Scotty") > 1, "Scotty " + rank("Scotty")]);
  ok("a 1-2 team outranks a 3-0 team on merit", () =>
    [rank("Cody") < rank("Scotty"),
     "Cody " + rank("Cody") + ", Scotty " + rank("Scotty")]);
  ok("the highest scorer is first", () => [rows[0].manager === "Ryan", rows[0].manager]);
  ok("the worst team is last", () => [rows[3].manager === "Bo", rows[3].manager]);
  ok("ratings descend", () => rows.every((r,i) => i === 0 || rows[i-1].rating >= r.rating));

  ok("all-play ignores who you were scheduled against", () => {
    const bo = rows.find(r => r.manager === "Bo");
    return [bo.allPlay === 0, bo.allPlay];   // Bo was bottom every single week
  });
  ok("all-play is a share, not a count", () =>
    rows.every(r => r.allPlay >= 0 && r.allPlay <= 1));
  ok("the record is still reported alongside", () => {
    const sc = rows.find(r => r.manager === "Scotty");
    return [sc.w === 3 && sc.l === 0, sc.w + "-" + sc.l];
  });
  ok("recent form only looks at the last three weeks", () => {
    const sc = rows.find(r => r.manager === "Scotty");
    return [Math.abs(sc.recent - 101) < 0.7, sc.recent];
  });
}

/* ---------- movement ---------- */
{
  /* Ryan sinks in week 3, Cody climbs, so the order must change */
  const shift = [
    game(1,1, 1,100, 2, 90), game(2,1, 3,110, 4,160),
    game(3,2, 1,100, 3,105), game(4,2, 2, 95, 4,158),
    game(5,3, 1,100, 4, 60), game(6,3, 2, 92, 3,175)
  ];
  const { sandbox: S } = at(shift);
  const rows = S.powerMovement();

  ok("every row carries a rank", () => rows.every((r,i) => r.rank === i + 1));
  ok("movement is measured, not left blank", () => rows.every(r => r.move !== undefined));
  ok("somebody actually moved", () => {
    const moved = rows.filter(r => r.move);
    return [moved.length > 0, rows.map(r => r.manager + ":" + r.move).join(" ")];
  });
  ok("movement is a rank delta, not a rating delta", () =>
    rows.every(r => r.move === null || Number.isInteger(r.move)));
  ok("the moves cancel out across the league", () => {
    const sum = rows.reduce((a,r) => a + (r.move || 0), 0);
    return [sum === 0, "net " + sum];
  });
}
{
  /* one week played: nothing to compare against yet */
  const { sandbox: S } = at([game(1,1, 1,101, 2,100), game(2,1, 3,140, 4,150)]);
  const rows = S.powerMovement();
  ok("a single week reports no movement rather than a fake zero", () =>
    [rows.every(r => r.move === null), rows.map(r => r.move).join(",")]);
}

/* ---------- rendering and gating ---------- */
{
  const { sandbox: S, byId } = at(SCHEDULE);
  S.renderPower();
  const h = byId("powerBody").innerHTML;
  ok("the table renders", () => /Power rankings/.test(h));
  ok("all-play is shown, since it is doing the work", () => /all-play/.test(h));
  ok("the record is shown too", () => /3-0/.test(h));
  ok("the reader is told what all-play means", () =>
    /how you would have done against every team/.test(h));
}
{
  const { sandbox: S, byId } = at([], "2026-10-20T12:00:00Z");
  S.renderPower();
  ok("no completed weeks shows a lock, not an empty table", () =>
    /Nothing to rank yet/.test(byId("powerBody").innerHTML));
}
{
  const { sandbox: S, byId, setVar } = boot({ search:"", now:"2026-09-01T12:00:00Z" });
  setVar("ME", '"Scotty"');
  S.renderPower();
  ok("stays locked before the draft with everything else", () =>
    byId("powerBody").innerHTML === "");
}

console.log(`\n  ${passes} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
