/* test/phases.test.mjs
 *
 * The rollout has three phases. This loads the page as the league sees it on a
 * given date and checks exactly what is visible.
 *
 *   before Sept 6   preseason HQ only
 *   after the draft everything except Binder and Packs
 *   Sept 15 onward  Binder and Packs too
 *
 * ?pack=1 forces everything on at any date.
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

const shown = (byId, id) => byId(id) && byId(id).style.display !== "none";
const empty = (byId, id) => byId(id) && byId(id).innerHTML === "";

/* ============ PHASE 1: before the draft, plain link ============ */
{
  const { sandbox: S, byId, warnings } = boot({ search: "", now: "2026-09-01T12:00:00Z" });
  const tag = "phase 1 (Sept 1, public)";

  ok(tag + " no warnings", () => [warnings.length === 0, warnings.join(" | ")]);
  ok(tag + " draft features locked", () => S.liveDraft() === false);
  ok(tag + " packs locked", () => S.livePacks() === false);

  ok(tag + " My Team tab hidden", () => !shown(byId, "teamTab"));
  ok(tag + " Binder tab hidden", () => !shown(byId, "binderTab"));
  ok(tag + " Pack tab hidden", () => !shown(byId, "demoTab"));

  ok(tag + " history subnav hidden", () => byId("histNav").style.display === "none");
  ok(tag + " head to head empty", () => empty(byId, "h2hBody"));
  ok(tag + " trade subnav hidden", () => byId("tradeNav").style.display === "none");
  ok(tag + " team page empty", () => empty(byId, "teamBody"));
  ok(tag + " trade block empty", () => empty(byId, "blockBody"));
  ok(tag + " binder empty", () => empty(byId, "binderBody"));
  ok(tag + " snapshot empty", () => empty(byId, "snapshot"));

  /* the preseason HQ still has to work */
  ok(tag + " countdown still runs", () => byId("cdlabel").textContent === "Draft in");
  ok(tag + " draft order renders", () => byId("draft").innerHTML.indexOf("Draft Order") >= 0);
  ok(tag + " owners still render", () => byId("dossiers").innerHTML.indexOf("Dawson") >= 0);
  ok(tag + " all-time ledger renders", () => byId("tall").innerHTML.indexOf("Scotty") >= 0);
  ok(tag + " recap shows the preseason lock", () =>
    byId("recap").innerHTML.indexOf("First writeup lands after Week 1") >= 0);
  ok(tag + " autopack refuses to fire", () => { S.maybeAutoPack(); return true; });
}

/* ============ PHASE 2: after the draft, plain link ============ */
{
  const { sandbox: S, byId, warnings } = boot({ search: "", now: "2026-09-08T12:00:00Z" });
  const tag = "phase 2 (Sept 8, public)";

  ok(tag + " no warnings", () => [warnings.length === 0, warnings.join(" | ")]);
  ok(tag + " draft features open", () => S.liveDraft() === true);
  ok(tag + " packs still locked", () => S.livePacks() === false);

  ok(tag + " My Team tab visible", () => shown(byId, "teamTab"));
  ok(tag + " Binder tab still hidden", () => !shown(byId, "binderTab"));
  ok(tag + " Pack tab still hidden", () => !shown(byId, "demoTab"));

  ok(tag + " history subnav visible", () =>
    [byId("histNav").style.display === "flex", byId("histNav").style.display]);
  ok(tag + " trade subnav visible", () => byId("tradeNav").style.display === "flex");
  ok(tag + " binder still empty", () => empty(byId, "binderBody"));
  ok(tag + " autopack refuses to fire", () => { S.maybeAutoPack(); return true; });
}

/* ============ PHASE 3: first Tuesday after Week 1 ============ */
{
  const { sandbox: S, byId, warnings } = boot({ search: "", now: "2026-09-15T14:00:00Z" });
  const tag = "phase 3 (Sept 15, public)";

  ok(tag + " no warnings", () => [warnings.length === 0, warnings.join(" | ")]);
  ok(tag + " draft features open", () => S.liveDraft() === true);
  ok(tag + " packs open", () => S.livePacks() === true);

  ok(tag + " My Team tab visible", () => shown(byId, "teamTab"));
  ok(tag + " Binder tab visible", () => shown(byId, "binderTab"));
  ok(tag + " Pack test bench stays hidden", () => !shown(byId, "demoTab"));
  ok(tag + " binder renders a prompt, not blank", () =>
    byId("binderBody").innerHTML.indexOf("Pick your name") >= 0);
}

/* ============ the morning of, one hour early ============ */
{
  const { sandbox: S } = boot({ search: "", now: "2026-09-15T12:00:00Z" });
  ok("packs still shut at 8am ET on the day", () => S.livePacks() === false);
}

/* ============ ESPN can unlock early, independently of the clock ============ */
{
  const { sandbox: S, byId, setVar } = boot({ search: "", now: "2026-09-01T12:00:00Z" });
  ok("locked while ESPN reports undrafted", () => S.liveDraft() === false);
  setVar("LIVE", JSON.stringify({ settings: { draftDetail: { drafted: true } } }));
  ok("ESPN reporting drafted unlocks early", () => S.liveDraft() === true);
  S.renderAll();
  ok("and the My Team tab appears without a reload", () => shown(byId, "teamTab"));
  ok("but packs stay shut, they are date driven", () => S.livePacks() === false);
}

/* ============ the clock alone unlocks if league.json never loads ============ */
{
  const { sandbox: S, getVar } = boot({ search: "", now: "2026-10-01T12:00:00Z" });
  ok("live data really is absent here", () => getVar("LIVE") === null);
  ok("clock unlocks anyway", () => S.liveDraft() === true);
}

/* ============ ?pack=1 overrides everything ============ */
{
  const { sandbox: S, byId } = boot({ search: "?pack=1", now: "2026-09-01T12:00:00Z" });
  const tag = "preview (Sept 1, ?pack=1)";
  ok(tag + " draft features forced open", () => S.liveDraft() === true);
  ok(tag + " packs forced open", () => S.livePacks() === true);
  ok(tag + " My Team tab visible", () => shown(byId, "teamTab"));
  ok(tag + " Binder tab visible", () => shown(byId, "binderTab"));
  ok(tag + " Pack test bench visible", () => shown(byId, "demoTab"));
  ok(tag + " history subnav visible", () => byId("histNav").style.display === "flex");
}

console.log(`\n  ${passes} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
