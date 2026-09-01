/* test/binder.test.mjs
 *
 * The binder and the pack share matchCardHTML and consCardHTML so they can
 * never drift. These check that they actually do, that a weekly result keeps
 * its stat strip in the grid, and that a superlative is never pushed through
 * the match layout, which puts its stat line in the big-number slot and clips.
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
  ok("superlative keeps its stat line", () => binCons.indexOf("Lost by 42.6") >= 0);
  ok("superlative keeps its rarity tag", () => binCons.indexOf("Dishonour") >= 0);
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
  ok("shame tier maps to Dishonour", () => html.indexOf("Dishonour") >= 0);

  const legacyMatch = { key:"6:match:Scotty", week:6, type:"match", tier:"bronzeC",
    title:"Scotty", rate:"78.4", pos:"LOSS", art:"chair", sub:"lost to Justin", ts:2 };
  const mh = S.miniCard(legacyMatch);
  ok("summary-only result still uses the result layout", () => /class="fut /.test(mh));
  ok("and puts the score in the big-number slot", () => /futL"><b>78\.4<\/b>/.test(mh));
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

console.log(`\n  ${passes} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
