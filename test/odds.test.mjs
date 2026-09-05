/* test/odds.test.mjs
 *
 * Playoff odds.
 *
 * The simulation used to generate the remaining schedule by rotating a round
 * robin, so it was simulating games that would never be played. In a ten team
 * league with rematches the invented schedule diverges quickly, and it diverges
 * worst in November when the odds are the only thing anyone reads. These pin it
 * to the real fixtures.
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

const G = (wk, h, a, hp, ap, tier) => ({
  id: wk * 100 + h, matchupPeriodId: wk, playoffTierType: tier || "NONE",
  winner: hp == null ? "UNDECIDED" : (hp > ap ? "HOME" : "AWAY"),
  home:{ teamId:h, totalPoints: hp || 0 }, away:{ teamId:a, totalPoints: ap || 0 }
});

function scene(schedule, opts = {}){
  /* an empty string is a valid search and must not fall through to preview */
  const h = boot({ search: opts.search === undefined ? "?pack=1" : opts.search,
                   now: "2026-11-01T12:00:00Z" });
  h.setVar("LIVE", JSON.stringify({
    settings:{ draftDetail:{ drafted:true }, settings:{
      scheduleSettings:{ playoffTeamCount: opts.spots || 2 }, rosterSettings:{} }},
    teams:{ members:[], teams:[] }, matchups:{ schedule }
  }));
  h.setVar("ROSTERS", JSON.stringify([1,2,3,4].map(id =>
    ({ id, teamName:"T"+id, manager:"M"+id, players:[] }))));
  h.setVar("SEASON", "null");
  h.sandbox.syncLeagueSettings();
  return h;
}

const PLAYED = [G(1,1,2,120,100), G(1,3,4,110,130), G(2,1,3,115,118), G(2,2,4,105,99)];
const TOCOME = [G(3,1,4), G(3,2,3), G(4,1,2), G(4,3,4)];

/* ---------- the fixture list ---------- */
{
  const { sandbox: S } = scene(PLAYED.concat(TOCOME,
    [G(14,1,2,null,null,"WINNERS_BRACKET")]));
  const rem = S.remainingFixtures();

  ok("only unplayed weeks remain", () => [rem.length === 2, rem.length + " weeks"]);
  ok("the fixtures are the real ones", () =>
    [JSON.stringify(rem) === "[[[1,4],[2,3]],[[1,2],[3,4]]]", JSON.stringify(rem)]);
  ok("weeks come back in order", () => {
    const flat = rem.map(w => w.map(p => p.join("v")).join(","));
    return [flat[0] === "1v4,2v3", flat.join(" | ")];
  });
  ok("a playoff week is not simulated as regular season", () =>
    [S.remainingFixtures().length === 2, "playoff tier leaked in"]);
  ok("a bye entry with no opponent is skipped", () => {
    const s2 = scene(PLAYED.concat([{ matchupPeriodId:3, playoffTierType:"NONE",
      winner:"UNDECIDED", home:{teamId:1,totalPoints:0} }]));
    return s2.sandbox.remainingFixtures().every(w => w.every(p => p.length === 2));
  });
  ok("nothing left to play returns nothing", () =>
    [scene(PLAYED).sandbox.remainingFixtures().length === 0, "phantom fixtures"]);
}

/* ---------- the odds themselves ---------- */
{
  const { sandbox: S } = scene(PLAYED.concat(TOCOME), { spots: 2 });
  const odds = S.playoffOdds(1200);

  ok("odds are produced once games have been played", () => !!odds && odds.length === 4);
  ok("every probability is a probability", () =>
    odds.every(o => o.made >= 0 && o.made <= 1 && o.bye >= 0 && o.bye <= 1));
  ok("the number who make it equals the number of spots", () => {
    const total = odds.reduce((a, o) => a + o.made, 0);
    return [Math.abs(total - 2) < 0.05, "expected 2.0, got " + total.toFixed(3)];
  });
  ok("exactly one team wins the one seed", () => {
    const total = odds.reduce((a, o) => a + o.top, 0);
    return [Math.abs(total - 1) < 0.05, "expected 1.0, got " + total.toFixed(3)];
  });
  ok("results are sorted best first", () =>
    odds.every((o, i) => i === 0 || odds[i-1].made >= o.made));
  ok("nobody is certain with two weeks left", () =>
    [odds.every(o => o.made < 1 || o.made > 0), odds.map(o => o.made.toFixed(2)).join(",")]);
}

/* ---------- the schedule actually has to matter ---------- */
{
  /* identical records and scoring, different opponents left. Team 1 draws the
     two weakest, team 2 draws the two strongest. Team 1 must fare better. */
  const played = [
    G(1,1,2,120,110), G(1,3,4,120,110),
    G(2,1,3,120,110), G(2,2,4,120,110)
  ];
  const easy = played.concat([G(3,1,4), G(3,2,3), G(4,1,4), G(4,2,3)]);
  const hard = played.concat([G(3,1,3), G(3,2,4), G(4,1,3), G(4,2,4)]);

  const a = scene(easy, { spots: 2 }).sandbox.playoffOdds(3000);
  const b = scene(hard, { spots: 2 }).sandbox.playoffOdds(3000);
  const of = (list, id) => list.find(o => o.team.id === id).made;

  ok("who you have left changes your odds", () => {
    const d = Math.abs(of(a, 1) - of(b, 1));
    return [d > 0.01, "identical odds on different schedules, delta " + d.toFixed(3)];
  });
}

/* ---------- a season with nothing played ---------- */
{
  const { sandbox: S } = scene(TOCOME, { search: "" });
  ok("no completed games means no odds rather than a guess", () =>
    [S.playoffOdds(200) === null, "odds invented from nothing"]);
}

/* ---------- invented seasons must not reach the league ---------- */
{
  const pub = scene(TOCOME, { search: "" });
  pub.setVar("SEASON", "null");
  const built = pub.sandbox.buildSeason();
  ok("no fake weeks are generated on the public link", () =>
    [Object.keys(built.weeks).length === 0, Object.keys(built.weeks).length + " fabricated weeks"]);
  ok("and no fake records reach a manager's form line", () => {
    pub.setVar("SEASON", "null");
    const f = pub.sandbox.teamForm("M1");
    return [!f || !f.rec, JSON.stringify(f)];
  });
}
{
  const prev = scene(TOCOME, { search: "?pack=1" });
  prev.setVar("SEASON", "null");
  ok("the commissioner still gets a demo season to test against", () =>
    Object.keys(prev.sandbox.buildSeason().weeks).length > 0);
}

console.log(`\n  ${passes} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
