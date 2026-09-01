import { boot } from "./harness.mjs";

/* commissioner view, clock frozen before the draft so this never drifts */
const { sandbox: S, byId, warnings, setVar, getVar } =
  boot({ search: "?pack=1", now: "2026-09-01T12:00:00Z" });

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
const load = obj => setVar("H2H", JSON.stringify(obj));
const reset = () => { setVar("h2hA", '""'); setVar("h2hB", '""'); setVar("h2hTier", '"all"'); };
const h = () => byId("h2hBody").innerHTML;

/* ---------- 1. boot ---------- */
ok("script ran without throwing", () => typeof S.renderH2H === "function");
ok("no console warnings during first paint", () => [warnings.length === 0, warnings.join(" | ")]);
ok("PREVIEW is on for ?pack=1", () => getVar("PREVIEW") === true);
ok("H2H starts null", () => getVar("H2H") === null);

/* ---------- 2. empty state ---------- */
S.renderH2H();
ok("empty state renders a lock, not a crash", () => /No matchup file yet/.test(h()));
ok("empty state names the build script", () => /scripts\/h2h\.mjs/.test(h()));

/* ---------- 3. fixture with known answers ----------
   Scotty vs Bo 3-1, Scotty vs Cody 0-2, Bo vs Cody 1-0.
   Scotty's last two vs Bo are wins. Closest 1.0, best win 61.0. */
load({
  seasons: [2019, 2020],
  managers: ["Bo", "Cody", "Scotty"],
  games: [
    [2019,  1, "Scotty", 120.0, "Bo",     100.0, 0],
    [2019,  5, "Bo",     130.0, "Scotty",  90.0, 0],
    [2019,  9, "Scotty", 111.0, "Cody",   140.0, 0],
    [2020,  3, "Scotty", 105.5, "Bo",     104.5, 0],
    [2020,  7, "Cody",   150.0, "Scotty", 100.0, 0],
    [2020, 15, "Scotty", 160.0, "Bo",      99.0, 1],
    [2020, 11, "Bo",     101.0, "Cody",    88.0, 0]
  ]
});
reset();

ok("managers derived from games", () => {
  const m = JSON.stringify(S.h2hManagers());
  return [m === '["Bo","Cody","Scotty"]', m];
});
ok("Scotty leads Bo 3-1", () => {
  const r = S.h2hSeries("Scotty", "Bo");
  return [r.w === 3 && r.l === 1, r.w + "-" + r.l];
});
ok("series log is complete", () => {
  const r = S.h2hSeries("Scotty", "Bo");
  return [r.games.length === 4, r.games.length];
});
ok("log sorted oldest first", () => {
  const g = S.h2hSeries("Scotty", "Bo").games[0];
  return [g.season === 2019 && g.week === 1, g.season + " wk" + g.week];
});
ok("streak reads from the tail", () => {
  const s = S.h2hStreak(S.h2hSeries("Scotty", "Bo").games);
  return [s === "Won 2 straight", s];
});
ok("series is symmetric", () => {
  const r = S.h2hSeries("Bo", "Scotty");
  return [r.w === 1 && r.l === 3, r.w + "-" + r.l];
});
ok("points mirror across the pairing", () => {
  const a = S.h2hSeries("Scotty", "Bo"), b = S.h2hSeries("Bo", "Scotty");
  return Math.abs(a.pf - b.pa) < 1e-9 && Math.abs(a.pa - b.pf) < 1e-9;
});
ok("Scotty is 0-2 vs Cody", () => {
  const r = S.h2hSeries("Scotty", "Cody");
  return [r.w === 0 && r.l === 2, r.w + "-" + r.l];
});
ok("index matches the series", () => {
  const ix = S.h2hIndex();
  return ix["Scotty|Bo"].w === 3 && ix["Scotty|Bo"].l === 1;
});
ok("index counts each game once per side", () => {
  const ix = S.h2hIndex();
  return [ix["Scotty|Bo"].n === 4, ix["Scotty|Bo"].n];
});
ok("index carries the reverse key", () => {
  const ix = S.h2hIndex();
  return ix["Bo|Scotty"].w === 1 && ix["Bo|Scotty"].l === 3;
});
ok("no self pairing in the index", () => !S.h2hIndex()["Bo|Bo"]);
ok("top rival is the most played", () =>
  S.h2hTopRival("Scotty", ["Bo","Cody"], S.h2hIndex()) === "Bo");

setVar("h2hTier", '"reg"');
ok("filter drops the playoff game", () => {
  const r = S.h2hSeries("Scotty", "Bo");
  return [r.games.length === 3, r.games.length];
});
ok("filter changes the record", () => {
  const r = S.h2hSeries("Scotty", "Bo");
  return [r.w === 2 && r.l === 1, r.w + "-" + r.l];
});
setVar("h2hTier", '"all"');

/* ---------- 4. full render ---------- */
reset();
warnings.length = 0;
S.renderH2H();
ok("render produced markup", () => [h().length > 500, h().length]);
ok("render threw no warnings", () => [warnings.length === 0, warnings.join(" | ")]);
ok("scorebug present", () => /hhbug/.test(h()));
ok("both selects rendered", () => /id="h2hSelA"/.test(h()) && /id="h2hSelB"/.test(h()));
ok("game log present", () => /Every meeting/.test(h()));
ok("full grid present", () => /Full grid/.test(h()));
ok("playoff game tagged in the log", () => /playoffs/.test(h()));
ok("closest game reported as 1.0", () => /1\.0 in 2020/.test(h()));
ok("best win reported as 61.0", () => /61\.0 in 2020/.test(h()));
ok("current managers are not flagged former", () => !/Bo \(former\)/.test(h()));
ok("defaults to a real pairing", () => {
  const a = getVar("h2hA"), b = getVar("h2hB");
  return [a && b && a !== b, a + " / " + b];
});

/* ---------- 5. former manager labelling ---------- */
load({ seasons:[2019], managers:["Scotty","Gavin"],
       games:[[2019, 1, "Scotty", 120.0, "Gavin", 100.0, 0]] });
reset();
S.renderH2H();
ok("former managers are labelled", () => /Gavin \(former\)/.test(h()));

/* ---------- 6. a pairing that never met ---------- */
load({ seasons:[2019], managers:["Scotty","Bo","Cody","Andy"],
       games:[[2019, 1, "Scotty", 120.0, "Bo", 100.0, 0],
              [2019, 2, "Cody",    90.0, "Andy", 80.0, 0]] });
setVar("h2hA", '"Scotty"'); setVar("h2hB", '"Cody"'); setVar("h2hTier", '"all"');
warnings.length = 0;
S.renderH2H();
ok("never-met pairing is handled", () => /Never met/.test(h()));
ok("never-met threw no warnings", () => [warnings.length === 0, warnings.join(" | ")]);

/* ---------- 7. malformed payloads must not brick the panel ---------- */
const junk = ['null', '[]', '{}', '{"games":null}', '{"games":"nope"}', '{"games":[]}',
              '{"games":[[2019]]}', '{"games":[[2019,1,"A",10,"B"]]}'];
junk.forEach((bad, i) => {
  setVar("H2H", bad); reset();
  ok("malformed payload " + i + " survived", () => { S.renderH2H(); return true; });
});

/* ---------- 8. nav gating ---------- */
load({ seasons:[2019], managers:["Scotty","Bo"],
       games:[[2019,1,"Scotty",120.0,"Bo",100.0,0]] });
reset();
setVar("histView", '"owners"');
S.paintHistoryNav();
ok("subnav is shown in preview", () =>
  [byId("histNav").style.display === "flex", byId("histNav").style.display]);
ok("owners view is the default", () =>
  [byId("ownersBody").style.display === "", "'" + byId("ownersBody").style.display + "'"]);
ok("h2h body hidden until selected", () => byId("h2hBody").style.display === "none");
setVar("histView", '"h2h"');
S.paintHistoryNav();
ok("switching hides owners", () => byId("ownersBody").style.display === "none");
ok("switching shows h2h", () =>
  [byId("h2hBody").style.display === "", "'" + byId("h2hBody").style.display + "'"]);

console.log(`\n  ${passes} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
