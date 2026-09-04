/* test/picks.test.mjs
 *
 * Week selection, the lock, and scoring.
 *
 * The lock is the part that matters. A pick'em where someone can choose a game
 * that has already kicked off is not a competition, so the deadline is a fixed
 * clock time rather than anything derived from whether ESPN has posted a score.
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

const LIVE = JSON.stringify({
  settings:{ draftDetail:{ drafted:true } },
  teams:{ members:[{id:"{A}",firstName:"Scott"},{id:"{B}",firstName:"bo"},
                   {id:"{C}",firstName:"Andrew"},{id:"{D}",firstName:"Cody"}],
    teams:[{id:1,owners:["{A}"]},{id:2,owners:["{B}"]},
           {id:3,owners:["{C}"]},{id:4,owners:["{D}"]}]},
  matchups:{ schedule:[
    {id:11,matchupPeriodId:1,winner:"HOME",home:{teamId:1,totalPoints:120},away:{teamId:2,totalPoints:100}},
    {id:12,matchupPeriodId:1,winner:"AWAY",home:{teamId:3,totalPoints:90},away:{teamId:4,totalPoints:110}},
    {id:21,matchupPeriodId:2,winner:"UNDECIDED",home:{teamId:1,totalPoints:0},away:{teamId:3,totalPoints:0}},
    {id:22,matchupPeriodId:2,winner:"UNDECIDED",home:{teamId:2,totalPoints:0},away:{teamId:4,totalPoints:0}}]}});

const at = now => {
  const h = boot({ search:"", now });
  h.setVar("ME", '"Scotty"');
  h.setVar("LIVE", LIVE);
  return h;
};

/* ---------- which week is being picked ---------- */
{
  const { sandbox: S } = at("2026-09-16T12:00:00Z");
  ok("picks the first week with games still open", () => [S.pickWeek() === 2, S.pickWeek()]);
  ok("opponents resolve through the alias table", () => {
    const g = S.weekGames(2);
    const names = g.flatMap(x => [x.home, x.away]).sort();
    return [names.join(",") === "Bo,Cody,Dawson,Scotty", names.join(",")];
  });
  ok("a decided week is marked done", () => S.weekGames(1).every(g => g.done));
  ok("an open week is not", () => S.weekGames(2).every(g => !g.done));
  ok("every game carries a stable id", () => {
    const ids = S.weekGames(1).map(g => g.id);
    return [new Set(ids).size === ids.length && ids.every(Boolean), ids.join(",")];
  });
}

/* ---------- the lock ---------- */
{
  const { sandbox: S } = at("2026-09-16T12:00:00Z");   // after week 1 kickoff
  ok("week 1 is locked once its kickoff has passed", () => S.picksLocked(1) === true);
  ok("a future week is still open", () => S.picksLocked(3) === false);
  ok("each week locks seven days after the one before", () => {
    const gap = S.lockAt(4) - S.lockAt(3);
    return [gap === 7 * 86400000, gap / 86400000 + " days"];
  });
}
{
  const { sandbox: S } = at("2026-09-10T23:00:00Z");   // an hour before kickoff
  ok("week 1 is open right up to kickoff", () => S.picksLocked(1) === false);
}
{
  const { sandbox: S } = at("2026-09-11T00:20:00Z");   // five minutes after
  ok("and shut immediately after", () => S.picksLocked(1) === true);
}

/* ---------- confidence scoring ---------- */
{
  const { sandbox: S, setVar } = at("2026-09-16T12:00:00Z");
  /* week 1: game 11 won by Scotty, game 12 won by Cody */
  setVar("PICKS", JSON.stringify({
    "1": {
      Scotty: { "11":{w:"Scotty",c:2}, "12":{w:"Cody",c:1} },   // both right, 3
      Bo:     { "11":{w:"Scotty",c:1}, "12":{w:"Dawson",c:2} }, // big one wrong, 1
      Cody:   { "11":{w:"Bo",c:2},     "12":{w:"Dawson",c:1} }, // both wrong, 0
      Andy:   { "11":{w:"Bo",c:1},     "12":{w:"Cody",c:2} }    // small one wrong, 2
    },
    "2": { Scotty: { "21":{w:"Scotty",c:2}, "22":{w:"Bo",c:1} } }
  }));

  ok("a correct pick scores its confidence", () => {
    const r = S.scoreWeek(1, "Scotty");
    return [r.pts === 3 && r.right === 2, JSON.stringify(r)];
  });
  ok("losing the game you were surest about costs the most", () => {
    const bo = S.scoreWeek(1, "Bo"), andy = S.scoreWeek(1, "Andy");
    return [bo.right === andy.right && bo.pts < andy.pts,
            "same record, " + bo.pts + " vs " + andy.pts];
  });
  ok("nothing right scores nothing", () => S.scoreWeek(1, "Cody").pts === 0);
  ok("unplayed games score neither way", () => {
    const r = S.scoreWeek(2, "Scotty");
    return [r.pts === 0 && r.done === 0, JSON.stringify(r)];
  });
  ok("a manager with no picks scores zero, not NaN", () => {
    const r = S.scoreWeek(1, "Ryan");
    return [r.pts === 0 && r.done === 2, JSON.stringify(r)];
  });

  const board = S.picksTable();
  ok("the board is ranked on points, not on correct picks", () =>
    [board.map(r => r.manager).join(",") === "Scotty,Andy,Bo,Cody",
     board.map(r => r.manager + ":" + r.pts).join(" ")]);
  ok("Andy places above Bo on the same record", () =>
    board.findIndex(r => r.manager === "Andy") < board.findIndex(r => r.manager === "Bo"));
}

/* ---------- the confidence rules ---------- */
{
  const { sandbox: S } = at("2026-09-16T12:00:00Z");
  const full = { a:{w:"X",c:1}, b:{w:"Y",c:2} };

  ok("a complete ranking is valid", () => S.picksValid(full, 2) === true);
  ok("a duplicate rank is not", () =>
    S.picksValid({ a:{w:"X",c:2}, b:{w:"Y",c:2} }, 2) === false);
  ok("a gap in the ranking is not", () =>
    S.picksValid({ a:{w:"X",c:1}, b:{w:"Y",c:3} }, 2) === false);
  ok("a missing winner is not", () =>
    S.picksValid({ a:{c:1}, b:{w:"Y",c:2} }, 2) === false);
  ok("a missing rank is not", () =>
    S.picksValid({ a:{w:"X"}, b:{w:"Y",c:2} }, 2) === false);
  ok("fewer games ranked than played is not", () => S.picksValid(full, 3) === false);
  ok("nothing at all is not", () => S.picksValid({}, 2) === false);

  ok("numbers already used are reported as taken", () => {
    const t = S.confTaken(full, "b");
    return [t[1] === true && !t[2], JSON.stringify(t)];
  });
  ok("a game does not count as blocking its own number", () =>
    !S.confTaken(full, "a")[1]);
}

/* ---------- rendering ---------- */
{
  const { sandbox: S, byId, getVar } = at("2026-09-16T12:00:00Z");

  ok("the backend URL is filled in", () =>
    [/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(getVar("PICKS_URL")),
     getVar("PICKS_URL").slice(0, 46)]);
  ok("it is not the trade block's URL, the two must stay separate", () =>
    getVar("PICKS_URL") !== getVar("BLOCK_URL"));
  ok("the sync is a real function, and boot calls it", () =>
    typeof S.pullPicks === "function");

  S.renderPicks();
  const h = byId("picksBody").innerHTML;
  ok("the week is drawn instead of a setup notice", () =>
    [/Pick&rsquo;em &middot; Week \d/.test(h) && !/Not switched on yet/.test(h), h.slice(0, 60)]);
  ok("a confidence control is offered for every game", () => {
    const sels = (h.match(/data-c="/g) || []).length;
    return [sels === S.weekGames(S.pickWeek()).length, sels + " controls"];
  });
  ok("save is refused until the entry is complete", () =>
    [/id="pkSave"[^>]*disabled/.test(h), "save button is enabled too early"]);
}
{
  const { sandbox: S, byId, setVar } = boot({ search:"", now:"2026-09-01T12:00:00Z" });
  setVar("ME", '"Scotty"');
  S.renderPicks();
  ok("stays locked with everything else before the draft", () =>
    byId("picksBody").innerHTML === "");
}

/* ---------- the button has to name the step that is missing ----------
   Setting all five confidence numbers without tapping a winner left the button
   disabled reading "Rank every game to save", which is the one thing that had
   been done. */
{
  const { sandbox: S, byId, setVar } = at("2026-09-16T12:00:00Z");
  const label = () => (byId("picksBody").innerHTML
    .match(/id="pkSave"[^>]*>([^<]*)</) || [])[1].trim();

  S.renderPicks();
  ok("with nothing picked it asks for winners", () =>
    [/Pick a winner in 2 more games/.test(label()), label()]);

  setVar("myPicks", JSON.stringify({ "21":{w:"Scotty"}, "22":{w:"Bo"} }));
  S.renderPicks();
  ok("with winners but no ranks it asks for ranks", () =>
    [/different rank/.test(label()), label()]);

  setVar("myPicks", JSON.stringify({ "21":{w:"Scotty",c:2}, "22":{w:"Bo",c:2} }));
  S.renderPicks();
  ok("a duplicate rank still blocks the save", () =>
    [/different rank/.test(label()), label()]);

  setVar("myPicks", JSON.stringify({ "21":{w:"Scotty",c:2}, "22":{w:"Bo",c:1} }));
  S.renderPicks();
  ok("only a complete entry offers the save", () => [label() === "Save picks", label()]);
  ok("and the button is no longer disabled", () =>
    !/id="pkSave"[^>]*disabled/.test(byId("picksBody").innerHTML));

  ok("the instruction names both steps, not just ranking", () => {
    const h = byId("picksBody").innerHTML;
    return /Tap the winner of each game, then rank them/.test(h);
  });
}

/* ---------- something to rank on ---------- */
{
  /* demo rosters are preview only, so the public link legitimately has no
     roster to read a projection from until real ones land */
  const pub = at("2026-09-16T12:00:00Z");
  pub.sandbox.loadRosterModel();
  ok("no invented form data reaches the league", () =>
    pub.sandbox.teamForm("Scotty") === null);

  const h = boot({ search:"?pack=1", now:"2026-09-16T12:00:00Z" });
  h.setVar("ME", '"Scotty"');
  const S = h.sandbox;
  S.loadRosterModel();
  const f = S.teamForm("Scotty");
  ok("a manager has a record and a projection", () =>
    [f && typeof f.proj === "number" && f.proj > 0, JSON.stringify(f)]);
  ok("an unknown name returns nothing rather than throwing", () =>
    S.teamForm("Nobody") === null);
}

/* ---------- the prompt on Home ----------
   Pick'em was three taps deep. This only shows while there is something to do. */
{
  const { sandbox: S, byId, setVar } = at("2026-09-16T12:00:00Z");
  S.renderPicksPrompt();
  const h = () => byId("picksPrompt").innerHTML;
  ok("an open week is advertised on Home", () => [/picks are open/.test(h()), h().slice(0,70)]);
  ok("it links straight to the tab", () => /id="pkGo"/.test(h()));
  ok("it says how many games and what the top pick is worth", () =>
    /Rank all 2 games/.test(h()) && /worth 2/.test(h()));

  setVar("PICKS", JSON.stringify({ "2": { Scotty: { "21":{w:"Scotty",c:2}, "22":{w:"Bo",c:1} } } }));
  S.renderPicksPrompt();
  ok("a completed entry says so instead of nagging", () =>
    [/picks are in/.test(h()), h().slice(0,70)]);
  ok("and still offers a way back in", () => /Review picks/.test(h()));
}
{
  /* every lock has long since passed by December */
  const { sandbox: S, byId } = at("2026-12-01T12:00:00Z");
  S.renderPicksPrompt();
  ok("a locked week is not advertised", () =>
    [byId("picksPrompt").innerHTML === "", byId("picksPrompt").innerHTML.slice(0,60)]);
}
{
  const { sandbox: S, byId, setVar } = at("2026-09-16T12:00:00Z");
  setVar("ME", '""');
  S.renderPicksPrompt();
  ok("nobody is nagged before they pick a name", () =>
    byId("picksPrompt").innerHTML === "");
}

console.log(`\n  ${passes} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
