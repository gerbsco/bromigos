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

/* the tab strip is rendered, so visibility is read from what it contains */
const dests = byId => [...byId("tabbar").innerHTML.matchAll(/data-d="([a-z]+)"/g)].map(m => m[1]);
const hasDest = (byId, d) => dests(byId).indexOf(d) >= 0;
const empty = (byId, id) => byId(id) && byId(id).innerHTML === "";

/* the bar itself must never show a dead destination */
{
  const { sandbox: S, byId } = boot({ search: "", now: "2026-09-01T12:00:00Z" });
  ok("every destination shown has at least one open panel", () =>
    dests(byId).every(d => S.panelsIn(d).length > 0));
  ok("sub-tabs only appear where there is a choice", () => {
    const sub = byId("subtabs").innerHTML;
    return [S.panelsIn("home").length > 1 || sub.indexOf('data-p="hq"') < 0, sub.slice(0,60)];
  });
}

/* ============ PHASE 1: before the draft, plain link ============ */
{
  const { sandbox: S, byId, warnings } = boot({ search: "", now: "2026-09-01T12:00:00Z" });
  const tag = "phase 1 (Sept 1, public)";

  ok(tag + " no warnings", () => [warnings.length === 0, warnings.join(" | ")]);
  ok(tag + " draft features locked", () => S.liveDraft() === false);
  ok(tag + " packs locked", () => S.livePacks() === false);

  ok(tag + " Team destination hidden", () => [!hasDest(byId,"team"), dests(byId).join(",")]);
  ok(tag + " Cards destination hidden", () => [!hasDest(byId,"cards"), dests(byId).join(",")]);
  ok(tag + " pack test bench is locked", () => !S.panelVisible("demo"));

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

  ok(tag + " Team destination visible", () => [hasDest(byId,"team"), dests(byId).join(",")]);
  ok(tag + " Cards destination still hidden", () => !hasDest(byId,"cards"));
  ok(tag + " pack test bench still locked", () => !S.panelVisible("demo"));

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

  ok(tag + " Team destination visible", () => [hasDest(byId,"team"), dests(byId).join(",")]);
  ok(tag + " Cards destination visible", () => [hasDest(byId,"cards"), dests(byId).join(",")]);
  ok(tag + " pack test bench stays locked", () => !S.panelVisible("demo"));
  ok(tag + " binder renders a prompt, not blank", () =>
    byId("binderBody").innerHTML.indexOf("Pick your name") >= 0);
}

/* ============ draft night: tabs unlocked, ESPN rosters not in yet ============
   The gap between the draft unlocking and league.json refreshing. The app used
   to fall back to invented players here, on the public link. */
{
  const { sandbox: S, byId, setVar, warnings } =
    boot({ search: "", now: "2026-09-07T00:00:00Z" });
  setVar("LIVE", JSON.stringify({ settings:{ draftDetail:{ drafted:false } }, teams:{ teams:[] } }));
  setVar("ME", '"Scotty"');
  S.renderAll();
  const tag = "draft night (public)";

  ok(tag + " tabs are unlocked", () => S.liveDraft() === true);
  ok(tag + " no demo players reach the league", () =>
    ["teamBody","tradeBody","wireBody"].every(id => !/Invented players/.test(byId(id).innerHTML)));
  ok(tag + " every roster tab says rosters are syncing", () =>
    ["teamBody","tradeBody","wireBody"].every(id =>
      byId(id).innerHTML.indexOf("Rosters are syncing") >= 0));
  ok(tag + " nothing throws", () => [warnings.length === 0, warnings.join(" | ")]);
  ok(tag + " packs are still shut", () => S.livePacks() === false);
}

/* ============ preview still gets its fixtures ============ */
{
  const { sandbox: S, byId, setVar } =
    boot({ search: "?pack=1", now: "2026-09-07T00:00:00Z" });
  setVar("LIVE", JSON.stringify({ settings:{ draftDetail:{ drafted:false } }, teams:{ teams:[] } }));
  setVar("ME", '"Scotty"');
  S.renderAll();
  ok("commissioner still sees demo rosters for testing", () =>
    byId("wireBody").innerHTML.indexOf("Demo data") >= 0);
}

/* ============ the morning of, one hour early ============ */
{
  const { sandbox: S } = boot({ search: "", now: "2026-09-15T11:00:00Z" });
  ok("packs still shut before the job has run", () => S.livePacks() === false);
}

/* ============ ESPN can unlock early, independently of the clock ============ */
{
  const { sandbox: S, byId, setVar } = boot({ search: "", now: "2026-09-01T12:00:00Z" });
  ok("locked while ESPN reports undrafted", () => S.liveDraft() === false);
  setVar("LIVE", JSON.stringify({ settings: { draftDetail: { drafted: true } } }));
  ok("ESPN reporting drafted unlocks early", () => S.liveDraft() === true);
  S.renderAll();
  ok("and the Team destination appears without a reload", () =>
    [hasDest(byId,"team"), dests(byId).join(",")]);
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
  ok(tag + " Team destination visible", () => [hasDest(byId,"team"), dests(byId).join(",")]);
  ok(tag + " Cards destination visible", () => [hasDest(byId,"cards"), dests(byId).join(",")]);
  ok(tag + " pack test bench is reachable", () => S.panelVisible("demo"));
  ok(tag + " history subnav visible", () => byId("histNav").style.display === "flex");
}

/* ---------- no offered tab may open onto nothing ----------
   The Records tab shipped ungated while its contents were gated, so before the
   draft it appeared in the League row and led to a blank screen. This walks
   every destination and sub-tab at each phase and opens it. */
{
  const BODY = { team:"teamBody", records:"recordsBody", trade:"tradeBody",
                 wire:"wireBody", binder:"binderBody", history:"dossiers" };

  [["", "2026-09-01T12:00:00Z", "pre-draft"],
   ["", "2026-09-08T12:00:00Z", "post-draft"],
   ["", "2026-09-16T12:00:00Z", "packs live"],
   ["?pack=1", "2026-09-01T12:00:00Z", "preview"]].forEach(([search, now, label]) => {

    const { sandbox: S, byId, setVar, warnings } = boot({ search, now });
    setVar("ME", '"Scotty"');
    setVar("H2H", JSON.stringify({ seasons:[2019], managers:["Scotty","Bo"],
      games:[[2019,1,"Scotty",120.0,"Bo",100.0,0]] }));
    setVar("LIVE", JSON.stringify({ settings:{ draftDetail:{ drafted:true } },
      teams:{ members:[], teams:[] }, rosters:{ teams:[] } }));
    S.renderAll();

    const shownDests = [...byId("tabbar").innerHTML.matchAll(/data-d="([a-z]+)"/g)].map(m => m[1]);

    ok(label + ": every destination holds a panel", () =>
      [shownDests.every(d => S.panelsIn(d).length > 0), shownDests.join(",")]);

    shownDests.forEach(d => S.panelsIn(d).forEach(pid => {
      ok(`${label}: ${d} > ${pid} opens onto content`, () => {
        S.showTab(pid, false);
        const bodyId = BODY[pid];
        if(!bodyId) return true;                    // static markup panel
        const el = byId(bodyId);
        return [!!el && el.innerHTML.trim().length > 0,
                bodyId + " is empty"];
      });
    }));

    ok(label + ": walking every tab logged no warnings", () =>
      [warnings.length === 0, warnings.join(" | ")]);
  });
}

/* ---------- bar order ---------- */
{
  const { byId } = boot({ search: "?pack=1", now: "2026-09-16T12:00:00Z" });
  const order = [...byId("tabbar").innerHTML.matchAll(/data-d="([a-z]+)"/g)].map(m => m[1]);
  ok("Trades sits ahead of League", () =>
    [order.indexOf("trades") < order.indexOf("league"), order.join(",")]);
  ok("full order is home, team, trades, league, cards", () =>
    [order.join(",") === "home,team,trades,league,cards", order.join(",")]);
}

/* ---------- next opponent card ---------- */
{
  const LIVE_JSON = JSON.stringify({
    settings:{ draftDetail:{ drafted:true } },
    teams:{ members:[{id:"{A}",firstName:"Scott"},{id:"{B}",firstName:"Andrew"}],
      teams:[{id:1,owners:["{A}"],name:"Ultimo",logo:""},
             {id:2,owners:["{B}"],name:"Dawg",logo:"https://x/d.png"}]},
    matchups:{ schedule:[
      {matchupPeriodId:1,winner:"HOME",home:{teamId:1},away:{teamId:2}},
      {matchupPeriodId:2,winner:"UNDECIDED",home:{teamId:2},away:{teamId:1}}]}});
  const H2H_JSON = JSON.stringify({ seasons:[2019,2024], managers:["Scotty","Dawson"], games:[
    [2019,1,"Scotty",120.0,"Andrew",100.0,0],
    [2021,4,"Dawson",140.0,"Scotty",99.0,0],
    [2024,7,"Scotty",131.0,"Dawson",128.5,0]]});

  const { sandbox: S, byId, setVar } = boot({ search:"", now:"2026-09-16T12:00:00Z" });
  setVar("ME", '"Scotty"'); setVar("LIVE", LIVE_JSON); setVar("H2H", H2H_JSON);
  S.renderNextUp();
  const h = () => byId("nextup").innerHTML;

  ok("next opponent is the unplayed matchup", () => [/Week 2/.test(h()), h().slice(0,60)]);
  ok("opponent resolves through the alias table", () => /Dawson/.test(h()) && !/Andrew/.test(h()));
  ok("their badge is shown", () => /x\/d\.png/.test(h()));
  ok("lifetime record is right", () => [/<b>2-1<\/b>/.test(h()), h().match(/<b>[^<]*<\/b>/)]);
  ok("the streak reads from the last meeting", () => /Won the last one/.test(h()));
  ok("recent meetings are listed newest first", () => {
    const yrs = [...h().matchAll(/<i>(\d{4})<\/i>/g)].map(m => m[1]);
    return [yrs.join(",") === "2024,2021,2019", yrs.join(",")];
  });
  ok("wins and losses are coloured apart", () =>
    /nxg w/.test(h()) && /nxg l/.test(h()));

  /* a pairing with no history must still render */
  setVar("H2H", JSON.stringify({ seasons:[2019], managers:["Scotty"], games:[
    [2019,1,"Scotty",120.0,"Bo",100.0,0]] }));
  S.renderNextUp();
  ok("a first meeting is handled", () => /never played Dawson/.test(h()));

  /* nothing left to play */
  setVar("LIVE", JSON.stringify({ settings:{ draftDetail:{ drafted:true } },
    teams:{ members:[{id:"{A}",firstName:"Scott"}], teams:[{id:1,owners:["{A}"],name:"U"}]},
    matchups:{ schedule:[{matchupPeriodId:1,winner:"HOME",home:{teamId:1},away:{teamId:2}}]}}));
  S.renderNextUp();
  ok("season over shows nothing rather than a broken card", () => h() === "");
}
{
  const { sandbox: S, byId, setVar } = boot({ search:"", now:"2026-09-01T12:00:00Z" });
  setVar("ME", '"Scotty"');
  S.renderNextUp();
  ok("next opponent stays hidden before the draft", () => byId("nextup").innerHTML === "");
}

console.log(`\n  ${passes} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
