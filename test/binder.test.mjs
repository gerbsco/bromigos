/* test/binder.test.mjs
 *
 * The binder and the pack share matchCardHTML and consCardHTML so they can
 * never drift. These check that they actually do, that a weekly result keeps
 * its stat strip in the grid, and that a superlative is never pushed through
 * the match layout, which puts its stat line in the big-number slot and clips.
 */

import { boot } from "./harness.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));

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

const AFTER_PACKS = "2026-09-15T14:00:00Z";

/* a full week, the shape a real weekly.json pack entry has */
const WEEK = {
  manager: "Scotty", myScore: 96.1, oppScore: 138.7, opponent: "Dawson",
  rank: 9, bench: 22.4, record: "0-1", high: 19.3, projected: 115.2,
  awards: [{ title: "Chair Recipient", stat: "Lost by 42.6", good: false,
             reason: "Biggest losing margin, 42.6",
             desc: "Lost by more than anyone else. It was not competitive." }]
};

/* ---------- the pack and the binder must produce the same markup ---------- */
{
  const { sandbox: S, byId, setVar } =
    boot({ search: "?pack=1", now: AFTER_PACKS, storage: true });
  setVar("ME", '"Scotty"');

  const cards = S.buildWeekCards(WEEK, 1);
  const match = cards.find(c => c.type === "match");
  const cons  = cards.find(c => c.type === "cons");

  ok("a week yields one result card and one superlative", () =>
    [!!match && !!cons, cards.map(c => c.type).join(",")]);
  ok("a week with no superlative is a one card pack", () => {
    const bare = S.buildWeekCards({ ...WEEK, awards: [] }, 1);
    return [bare.length === 1 && bare[0].type === "match",
            bare.map(c => c.type + ":" + (c.title || "")).join(",")];
  });
  ok("and no filler card is invented", () => {
    const bare = S.buildWeekCards({ ...WEEK, awards: [] }, 1);
    return !bare.some(c => c.title === "No Awards");
  });

  S.localStorage.removeItem("bromigos.binder.v2.Scotty");
  S.saveToBinder(cards, 1);
  const stored = S.readBinder();

  ok("both cards are stored", () => [stored.length === 2, stored.length]);
  ok("the full card object is stored, not just a summary", () => stored.every(c => !!c.card));

  const packMatch = S.matchCardHTML(match);
  const packCons  = S.consCardHTML(cons);
  const binMatch  = S.miniCard(stored.find(c => c.type === "match"));
  const binCons   = S.miniCard(stored.find(c => c.type === "cons"));

  ok("binder reuses the pack's result markup", () => binMatch.indexOf(packMatch) >= 0);
  ok("binder reuses the pack's superlative markup", () => binCons.indexOf(packCons) >= 0);

  /* the reported bug: the result card losing its data in the grid */
  ["\u221242.6", "MRG", "#9", "RNK", "22.4", "BEN",
   "0-1", "REC", "19.3", "TOP", "115.2", "PRJ"].forEach(bit => {
    ok("binder result card keeps " + JSON.stringify(bit), () => binMatch.indexOf(bit) >= 0);
  });
  ok("binder result card has all six stat cells", () =>
    [(binMatch.match(/futCell/g) || []).length === 6,
     (binMatch.match(/futCell/g) || []).length]);
  ok("binder result card shows both scores", () =>
    binMatch.indexOf("96.1") >= 0 && binMatch.indexOf("138.7") >= 0);

  /* the reported bug: superlatives rendered as result cards */
  ok("binder superlative uses the consumable layout", () => /class="cons /.test(binCons));
  ok("binder superlative is not a result card", () => !/class="fut /.test(binCons));
  ok("superlative keeps its name", () => binCons.indexOf("Chair Recipient") >= 0);
  ok("superlative keeps its description", () => binCons.indexOf("not competitive") >= 0);
  /* The phrase became a figure and a label: 42.6 over LOST. */
  ok("superlative keeps its stat line", () =>
    [binCons.indexOf("42.6") >= 0 && /consSt/.test(binCons),
     (binCons.match(/consSt[\s\S]{0,80}/) || [""])[0].replace(/<[^>]*>/g, " ")]);
  /* American spelling throughout. British ones shipped twice and were fixed. */
  ok("superlative keeps its rarity tag", () => [binCons.indexOf("Dishonor") >= 0,
    (binCons.match(/rarityTag">([^<]*)</) || [])[1]]);
  ok("and the tag is spelled the American way", () => !/Dishonour/.test(binCons));
  ok("superlative shows why it was given", () =>
    binCons.indexOf("Biggest losing margin, 42.6") >= 0);
  ok("the reason is its own line, not the flavour text", () =>
    /consWhy/.test(binCons) && /consDesc/.test(binCons));
  ok("stat line is not in the big-number slot", () =>
    !/futL"><b>Lost by/.test(binCons));

  ok("full binder renders without warnings", () => { S.renderBinder(); return true; });
  ok("rendered binder contains both layouts", () => {
    const h = byId("binderBody").innerHTML;
    return /class="cons /.test(h) && /class="fut /.test(h) && /futCell/.test(h);
  });
}

/* ---------- an entry with no stored card must still pick the right layout ---------- */
{
  const { sandbox: S, setVar } =
    boot({ search: "?pack=1", now: AFTER_PACKS, storage: true });
  setVar("ME", '"Scotty"');

  const legacy = { key:"6:cons:Walking Disaster", week:6, type:"cons", tier:"bronzeC",
    title:"Walking Disaster", rate:"78.4 points", pos:"AWARD", art:"\u{1FAA6}",
    sub:"Lowest score in the league. Not close either.", ts:1 };
  const html = S.miniCard(legacy);

  ok("summary-only superlative uses the consumable layout", () => /class="cons /.test(html));
  ok("summary-only superlative is not a result card", () => !/class="fut /.test(html));
  ok("its stat is not crammed into the big-number slot", () =>
    !/futL"><b>78\.4 points/.test(html));
  ok("shame tier maps to Dishonor", () => [html.indexOf("Dishonor") >= 0,
    (html.match(/rarityTag">([^<]*)</) || [])[1]]);

  const legacyMatch = { key:"6:match:Scotty", week:6, type:"match", tier:"bronzeC",
    title:"Scotty", rate:"78.4", pos:"LOSS", art:"chair", sub:"lost to Justin", ts:2 };
  const mh = S.miniCard(legacyMatch);
  ok("summary-only result still uses the result layout", () => /class="fut /.test(mh));
  ok("and puts the score in the big-number slot", () => /futL"><b>78\.4<\/b>/.test(mh));
}

/* ---------- fixtures from ANY earlier build get swept ---------- */
{
  const { sandbox: S, byId, setVar } =
    boot({ search: "?pack=1", now: AFTER_PACKS, storage: true });
  setVar("ME", '"Scotty"');

  const untagged = [{
    key:"6:match:Scotty", week:6, type:"match", tier:"bronzeC", title:"Scotty",
    rate:"78.4", pos:"LOSS", art:"chair", sub:"lost to Justin", ts:1,
    card:{ type:"match", tier:"bronzeC", mine:"78.4", pos:"LOSS", title:"Scotty",
           vs:"lost to Justin", wk:"W6", club:"Scotty", art:"chair",
           theirs:"139.1", oppName:"Justin",
           stats:[["\u221260.7","MRG"],["\u2014","RNK"],["\u2014","BEN"],
                  ["\u2014","REC"],["\u2014","TOP"],["\u2014","PRJ"]] }
  }];
  S.localStorage.setItem("bromigos.binder.v2.Scotty", JSON.stringify(untagged));
  ok("the stored entry really has no demo flag", () =>
    S.readBinder()[0].demo === undefined);

  S.renderBinder();
  const after = S.readBinder();
  ok("untagged fixtures are swept and reseeded", () => [after.length === 12, after.length]);
  ok("reseeded cards carry a full stat line", () => {
    const html = S.miniCard(after.find(c => c.type === "match"));
    const stats = html.split("futStats")[1] || "";
    return [!/\u2014/.test(stats) && /RNK/.test(stats) && /PRJ/.test(stats),
            (html.match(/futCell/g) || []).length];
  });
  ok("the seed marker is written so the sweep runs once", () =>
    [S.localStorage.getItem("bromigos.binderSeed.Scotty") === String(S.SEED_VERSION || 3),
     S.localStorage.getItem("bromigos.binderSeed.Scotty")]);

  const count = S.readBinder().length;
  S.renderBinder();
  ok("a second render does not re-sweep", () => [S.readBinder().length === count,
    S.readBinder().length]);
}

/* ---------- a real collection survives the sweep ---------- */
{
  const { sandbox: S, setVar } =
    boot({ search: "?pack=1", now: AFTER_PACKS, storage: true });
  setVar("ME", '"Scotty"');

  S.saveToBinder(S.buildWeekCards(WEEK, 4), 4);          // real pull, demo false
  const real = S.readBinder();
  ok("a real pull is stored with demo false, not undefined", () =>
    [real.every(c => c.demo === false), JSON.stringify(real.map(c => c.demo))]);

  S.localStorage.setItem("bromigos.binder.v2.Scotty", JSON.stringify(
    real.concat([{ key:"9:match:old", week:9, type:"match", tier:"bronze",
                   title:"Scotty", rate:"1.0", ts:1 }])));

  S.renderBinder();
  const after = S.readBinder();
  ok("the untagged fixture is gone", () => !after.some(c => c.key === "9:match:old"));
  ok("every real card survived", () =>
    [real.every(r => after.some(a => a.key === r.key)), after.map(c => c.key).join(",")]);
  ok("nothing was reseeded over the top of them", () =>
    [!after.some(c => c.demo), after.filter(c => c.demo).length]);
}

/* ---------- the rebuild control is commissioner only ---------- */
{
  const { sandbox: S, byId, setVar } =
    boot({ search: "?pack=1", now: AFTER_PACKS, storage: true });
  setVar("ME", '"Scotty"');
  S.renderBinder();
  ok("rebuild control shows under ?pack=1", () =>
    /data-bs="reset"/.test(byId("binderBody").innerHTML));
}
{
  const { sandbox: S, byId, setVar } =
    boot({ search: "", now: AFTER_PACKS, storage: true });
  setVar("ME", '"Scotty"');
  S.renderBinder();
  ok("rebuild control is hidden on the public link", () =>
    !/data-bs="reset"/.test(byId("binderBody").innerHTML));
  ok("and no fixtures are seeded there either", () => [S.readBinder().length === 0,
    S.readBinder().length]);
}

/* ---------- the storage key is versioned ---------- */
{
  const { sandbox: S, setVar } =
    boot({ search: "?pack=1", now: AFTER_PACKS, storage: true });
  setVar("ME", '"Scotty"');
  S.saveToBinder(S.buildWeekCards(WEEK, 1), 1);
  const keys = [...S.localStorage._map.keys()];
  ok("binder writes to a versioned key", () =>
    [keys.some(k => k.indexOf("bromigos.binder.v2.") === 0), keys.join(",")]);
  ok("nothing is written to the old key", () =>
    !keys.includes("bromigos.binder.Scotty"));
}


/* ---------- the pick'em card ----------
   One a week, to whoever topped the confidence board, on the FUT Birthday
   palette. It is not an ESPN result so it cannot come from the pack payload;
   it is computed from the picks and the frozen results. Fixed art, so a binder
   rebuilt in December reproduces it exactly. */
{
  const { sandbox: S, setVar } =
    boot({ search: "?pack=1", now: AFTER_PACKS, storage: true });
  setVar("ME", '"Scotty"');
  setVar("LIVE", JSON.stringify({
    settings:{ draftDetail:{ drafted:true } },
    teams:{ members:[{id:"{A}",firstName:"Scott"},{id:"{B}",firstName:"bo"},
                     {id:"{C}",firstName:"Andrew"},{id:"{D}",firstName:"Cody"}],
      teams:[{id:1,owners:["{A}"]},{id:2,owners:["{B}"]},
             {id:3,owners:["{C}"]},{id:4,owners:["{D}"]}]},
    matchups:{ schedule:[
      {id:11,matchupPeriodId:1,winner:"HOME",home:{teamId:1,totalPoints:151},away:{teamId:2,totalPoints:100}},
      {id:12,matchupPeriodId:1,winner:"AWAY",home:{teamId:3,totalPoints:90},away:{teamId:4,totalPoints:110}}]}}));
  setVar("PICKS", JSON.stringify({ "1": {
    Scotty: { "11":{w:"Scotty",c:2}, "12":{w:"Cody",c:1} },
    Bo:     { "11":{w:"Scotty",c:1}, "12":{w:"Dawson",c:2} },
    Cody:   { "11":{w:"Bo",c:2},     "12":{w:"Dawson",c:1} } } }));
  const pack = m => ({ manager:m, myScore:151, oppScore:100, opponent:"Bo",
    leagueHigh:true, rank:1, bench:12, record:"1-0", high:30, projected:120,
    awards:[{title:"Scoring Machine",stat:"151.0 points",rare:true,
             reason:"Highest score in the league",desc:"Most points."}] });

  ok("the winner is read off the picks and the results", () => {
    const w = S.pickemWinners(1);
    return [w.length === 1 && w[0].manager === "Scotty" && w[0].pts === 3,
      JSON.stringify(w)];
  });
  ok("the winner's pack carries the card", () => {
    const c = S.buildWeekCards(pack("Scotty"), 1);
    return [c.some(x => x.rarity === "pickem"), c.map(x => x.title).join(",")];
  });
  ok("nobody else's does", () =>
    !S.buildWeekCards(pack("Cody"), 1).some(x => x.rarity === "pickem"));
  ok("it uses its own skin, not a superlative's", () => {
    const card = S.buildWeekCards(pack("Scotty"), 1).find(x => x.rarity === "pickem");
    return [/class="cons pickem/.test(S.consCardHTML(card)), "pickem class"];
  });
  ok("its art is fixed and the deduper leaves it alone", () => {
    const a = S.buildWeekCards(pack("Scotty"), 1).find(x => x.rarity === "pickem").art;
    const b = S.buildWeekCards(pack("Scotty"), 1).find(x => x.rarity === "pickem").art;
    return [a === b && a === "\u{1F52E}", a];
  });
  ok("the reason states the score that won it", () => {
    const card = S.buildWeekCards(pack("Scotty"), 1).find(x => x.rarity === "pickem");
    return [/3 points, 2 of 2 right/.test(card.reason), card.reason];
  });
  ok("a tie gives both of them one", () => {
    setVar("PICKS", JSON.stringify({ "1": {
      Scotty: { "11":{w:"Scotty",c:2}, "12":{w:"Cody",c:1} },
      Bo:     { "11":{w:"Scotty",c:2}, "12":{w:"Cody",c:1} } } }));
    const w = S.pickemWinners(1);
    const card = S.buildWeekCards(pack("Bo"), 1).find(x => x.rarity === "pickem");
    return [w.length === 2 && !!card && /Tied/.test(card.reason),
      JSON.stringify(w.map(x => x.manager))];
  });
  ok("no picks on file means no card rather than a wrong one", () => {
    setVar("PICKS", "{}");
    return !S.buildWeekCards(pack("Scotty"), 1).some(x => x.rarity === "pickem");
  });

  /* The test bench builds through pickemCard, the same function the real pack
     uses, so what the commissioner previews cannot drift from what ships. */
  ok("the bench card and the shipped card are the same object", () => {
    setVar("PICKS", JSON.stringify({ "1": {
      Scotty: { "11":{w:"Scotty",c:2}, "12":{w:"Cody",c:1} } } }));
    const real = S.buildWeekCards(pack("Scotty"), 1).find(x => x.rarity === "pickem");
    const bench = S.pickemCard({ pts:real.value ? parseInt(real.value) : 3,
      right:2, done:2 }, false);
    return [real.title === bench.title && real.art === bench.art
      && real.rarity === bench.rarity && real.kind === bench.kind,
      real.title + " / " + bench.title];
  });
  /* The back used to flip over to gold, which is a different card to the one
     you are about to see. */
  ok("the back of the card matches the front", () => {
    const html = readFileSync(join(HERE, "..", "index.html"), "utf8");
    const card = S.pickemCard({ pts:3, right:2, done:2 }, false);
    return [card.flare === "pickem" && /pickem:\s*\{/.test(html)
      && /pickemback/.test(html), "flare " + card.flare];
  });
  ok("the corner badge is not a second copy of the art", () => {
    const card = S.pickemCard({ pts:3, right:2, done:2 }, false);
    return [card.icon !== card.art, card.icon + " vs " + card.art];
  });
  /* .side has no stacking context, so a z-index inside the back face competes
     with the front face rather than its own siblings, and the mirrored crest
     painted straight through the card. */
  ok("the back face cannot paint through the front", () => {
    const css = readFileSync(join(HERE, "..", "index.html"), "utf8")
      .replace(/\s+/g, " ");
    return [/\.pickemback\{isolation:isolate\}/.test(css)
      && /\.cons\.pickem\{isolation:isolate\}/.test(css), "both isolated"];
  });
  /* There is no art well any more. The portrait sits on the card, so the rule
     that has to hold is that nothing paints a box behind it. */
  ok("no card paints a box behind the portrait", () => {
    const css = readFileSync(join(HERE, "..", "index.html"), "utf8")
      .replace(/\s+/g, " ");
    const art = (css.match(/\.consArt\{[^}]*\}/) || [""])[0];
    return [art.indexOf("background") < 0, art.slice(0, 80)];
  });
  ok("and the front of the pick'em card stays opaque", () => {
    const css = readFileSync(join(HERE, "..", "index.html"), "utf8")
      .replace(/\s+/g, " ");
    const skin = (css.match(/\.cons\.pickem\{[^}]*\}/) || [""])[0];
    return [skin.indexOf("rgba") < 0, skin.slice(0, 80)];
  });

  ok("the bench offers it under ?pack=1", () => {
    const html = readFileSync(join(HERE, "..", "index.html"), "utf8");
    const demo = html.slice(html.indexOf('id="demo"'), html.indexOf('id="tabbar"'));
    return [demo.indexOf('id="demoPick"') >= 0, "bench slot present"];
  });
  ok("with a tie and a full pull to look at", () => {
    const html = readFileSync(join(HERE, "..", "index.html"), "utf8");
    return [/tied for the week/.test(html) && /a full week's pull/.test(html),
      "both variants"];
  });
}

/* ---------- somebody who has never opened the app ----------
   A manager who first picks their name in week 5 must still receive every
   week that has been archived, not start from empty. */
{
  const LIVE = JSON.stringify({
    settings:{ draftDetail:{ drafted:true } },
    teams:{ members:[{id:"{A}",firstName:"Scott"},{id:"{B}",firstName:"bo"}],
      teams:[{id:1,owners:["{A}"]},{id:2,owners:["{B}"]}]},
    matchups:{ schedule:[1,2,3,4].map(w => ({ id:10+w, matchupPeriodId:w, winner:"HOME",
      home:{teamId:1,totalPoints:120+w}, away:{teamId:2,totalPoints:110+w} })) }});
  const pk = (m,w) => ({ manager:m, myScore:120+w, oppScore:110+w, opponent:"Bo",
    rank:2, bench:10+w, record:w+"-0", high:22, projected:118, crest:"img/x.png",
    awards:[{title:"Blowout King",stat:"Won by 10",rare:true,reason:"Biggest margin",
             desc:"Over by noon."}] });
  const hist = {}; [1,2,3,4].forEach(w => {
    hist[String(w)] = { Scotty:pk("Scotty",w), Bo:pk("Bo",w) }; });

  const { sandbox: S, byId, setVar } =
    boot({ search:"", now:"2026-10-06T15:00:00Z", storage: true });
  setVar("LIVE", LIVE);
  setVar("WEEKLY", JSON.stringify({ week:4, posted:"2026-10-06", headline:"W4",
    body:["x"], changed:[], packs: hist["4"], history: hist }));
  S.renderBinder();
  ok("nothing is invented before a name is chosen", () =>
    [S.readBinder().length === 0 &&
      byId("binderBody").innerHTML.indexOf("Pick your name") >= 0, "clean"]);

  setVar("ME", '"Scotty"');
  S.renderBinder();
  ok("choosing a name in week 5 recovers every archived week", () => {
    const wks = [...new Set(S.readBinder().map(c => c.week))].sort().join(",");
    return [wks === "1,2,3,4", wks];
  });
  ok("and says how many were recovered", () =>
    [/rebuilt from the league archive/.test(byId("binderBody").innerHTML), "said"]);
  /* Bo appears legitimately as the opponent on Scotty's cards. What must not
     appear is a card belonging to Bo. */
  ok("nobody else's cards come with them", () => {
    const owners = [...new Set(S.readBinder()
      .filter(c => c.type === "match").map(c => c.title))];
    return [owners.length === 1 && owners[0] === "Scotty", owners.join(",")];
  });

  setVar("ME", '"Bo"');
  S.renderBinder();
  ok("a second manager on the same phone gets his own", () => {
    const wks = [...new Set(S.readBinder().map(c => c.week))].sort().join(",");
    return [wks === "1,2,3,4" && S.readBinder().length === 8, wks];
  });
}


/* ---------- new card designs land later ----------
   Holiday cards are coming. A binder built on a device that has never heard of
   the tier must still render the card rather than blanking it out. */
{
  const ctx = boot({ search:"?pack=1", now:AFTER_PACKS, storage:true });
  ctx.setVar("ME", '"Scotty"');
  const S = ctx.sandbox;
  const alien = { type:"cons", rarity:"halloween", rarityLabel:"Spooky",
    kind:"Holiday", icon:"\u2605", art:"\u{1F383}", title:"Trick or Treat",
    reason:"Something happened, 13.0", desc:"A card from the future.",
    value:"13.0 points" };
  ok("a tier this build has never heard of still renders", () => {
    const h = S.consCardHTML(alien);
    return [h.indexOf("Trick or Treat") >= 0 && /class="cons halloween/.test(h),
      h.slice(0, 60)];
  });
  ok("and it falls back to a readable skin rather than nothing", () => {
    const css = readFileSync(join(HERE, "..", "index.html"), "utf8")
      .replace(/\s+/g, " ");
    return [/\.cons\{background:linear-gradient/.test(css), "base skin present"];
  });
  /* Built inside the sandbox rather than handed in from out here: an object
     created in this realm and passed into the vm is not the same shape to the
     code under test. */
  const put = `localStorage.removeItem("bromigos.binder.v2.Scotty");
    saveToBinder([${JSON.stringify(alien)}], 9);`;
  ok("the binder stores and reads it back unchanged", () => {
    const back = ctx.run(put + " readBinder().map(c => c.card && c.card.rarity)");
    return [back.length === 1 && back[0] === "halloween", JSON.stringify(back)];
  });
  ok("and draws it in the binder without a layout of its own", () => {
    const h = ctx.run("miniCard(readBinder()[0])");
    return [/class="cons /.test(h) && !/class="fut /.test(h), h.slice(0, 50)];
  });

  /* the three milestones, on the palettes the league asked for */
  ok("the milestone mapping is the one that was asked for", () => {
    const m = k => S.milestoneCard(k, { seed:"1st", record:"10-1" });
    return [m("blue").title === "Top Seed" && m("orange").title === "Week Off"
      && m("purple").title === "In the Bracket",
      [m("blue").title, m("orange").title, m("purple").title].join(", ")];
  });
  ok("each milestone carries its own skin and card back", () => {
    const css = readFileSync(join(HERE, "..", "index.html"), "utf8")
      .replace(/\s+/g, " ");
    return [["blue","orange","purple"].every(k =>
      css.indexOf(".cons." + k + "{background") >= 0
      && new RegExp(k + ": ?\\{ ?n:").test(css)), "all three"];
  });
  ok("a milestone is a consumable, not a result card", () => {
    const h = S.consCardHTML(S.milestoneCard("blue", { seed:"1st", record:"10-1" }));
    return [/class="cons blue/.test(h), h.slice(0, 44)];
  });
}

console.log(`\n  ${passes} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
