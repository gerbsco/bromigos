/* test/managers.test.mjs
 *
 * Name resolution, shared by h2h.mjs and weekly.mjs. This is not cosmetic:
 * weekly packs are keyed by manager name, so a name that resolves wrong means
 * that manager silently receives no pack on Tuesday. Both real cases below
 * shipped broken once, so they are pinned here.
 */

import { resolveName, titleCase, ownerMap, KNOWN, ALIAS } from "../scripts/managers.mjs";

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

const mem = (first, display, id = "{guid}") =>
  ({ id, firstName: first, displayName: display });

/* ---------- the two that were actually wrong ---------- */
ok("lowercase bo becomes Bo", () => {
  const n = resolveName(mem("bo", "bo"));
  return [n === "Bo", n];
});
ok("Andrew becomes Dawson, the name he goes by", () => {
  const n = resolveName(mem("Andrew", "andrewd"));
  return [n === "Dawson", n];
});
ok("Dawson does not collide with Andy", () => {
  const a = resolveName(mem("Andy", "andy"));
  const d = resolveName(mem("Andrew", "andrewd"));
  return [a === "Andy" && d === "Dawson" && a !== d, a + " / " + d];
});

/* ---------- casing ---------- */
ok("Scott still becomes Scotty", () => resolveName(mem("Scott", "scottyg")) === "Scotty");
ok("shouted names are normalised", () => {
  const n = resolveName(mem("ANDY", "andy"));
  return [n === "Andy", n];
});
ok("alias lookup ignores case", () => {
  const n = resolveName(mem("ANDREW", "x"));
  return [n === "Dawson", n];
});
ok("titleCase handles hyphens and apostrophes", () =>
  [titleCase("o'brien-smith") === "O'Brien-Smith", titleCase("o'brien-smith")]);

/* ---------- fallbacks ---------- */
ok("display name is used when there is no first name", () => {
  const n = resolveName(mem("", "justin"));
  return [n === "Justin", n];
});
ok("an unknown name still comes back capitalised", () => {
  const n = resolveName(mem("terrence", "t"));
  return [n === "Terrence", n];
});
ok("a missing member does not throw", () => resolveName(null) === "");

/* ---------- every active manager is reachable ---------- */
ok("all ten current managers are in KNOWN", () =>
  ["Scotty","Bo","Dawson","Anthony","Cody","Ryan","Austin","Andy","James","Justin"]
    .every(m => KNOWN.includes(m)));
ok("every alias target is a known manager", () => {
  const bad = Object.values(ALIAS).filter(v => !KNOWN.includes(v));
  return [bad.length === 0, bad.join(",")];
});
ok("no alias key is stored with uppercase, lookup is lowercased", () => {
  const bad = Object.keys(ALIAS).filter(k => k !== k.toLowerCase() && !k.startsWith("{"));
  return [bad.length === 0, bad.join(",")];
});

/* ---------- ownerMap ---------- */
const teamDoc = {
  members: [
    mem("bo", "bo", "{A}"),
    mem("Andrew", "andrewd", "{B}"),
    mem("Scott", "scottyg", "{C}")
  ],
  teams: [
    { id: 1, owners: ["{A}"] },
    { id: 2, owners: ["{B}"] },
    { id: 3, owners: ["{C}"] },
    { id: 4, owners: [] }
  ]
};
ok("ownerMap resolves through the alias table", () => {
  const m = ownerMap(teamDoc);
  return [m[1].name === "Bo" && m[2].name === "Dawson" && m[3].name === "Scotty",
    [1,2,3].map(i => m[i].name).join(",")];
});
ok("ownerMap keeps the guid alongside", () => ownerMap(teamDoc)[2].guid === "{B}");
ok("ownerless teams are skipped", () => !ownerMap(teamDoc)[4]);
ok("an unknown guid is flagged rather than dropped", () => {
  const m = ownerMap({ members: [], teams: [{ id: 9, owners: ["{ZZZ}"] }] });
  return [/^unknown:/.test(m[9].name), m[9].name];
});
ok("empty documents do not throw", () => {
  ownerMap({}); ownerMap(null); return true;
});

/* ---------- the packs-are-keyed-by-name hazard ---------- */
ok("resolved names match what the app looks packs up by", () => {
  /* index.html CURRENT drives ME, and maybeAutoPack does packs[ME] */
  const CURRENT = ["Scotty","Bo","Dawson","Anthony","Cody","Ryan","Austin","Andy","James","Justin"];
  const resolved = [
    resolveName(mem("Scott","s")), resolveName(mem("bo","b")),
    resolveName(mem("Andrew","a")), resolveName(mem("Andy","an"))
  ];
  const missing = resolved.filter(r => !CURRENT.includes(r));
  return [missing.length === 0, "unmatched: " + missing.join(",")];
});

console.log(`\n  ${passes} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
