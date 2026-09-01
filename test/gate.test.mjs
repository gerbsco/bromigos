/* The plain link, before the draft. This is what the league sees today.
   Nothing from the head-to-head work may appear, and the History tab must
   look exactly as it did before. */

import { boot } from "./harness.mjs";

const { sandbox: S, byId, warnings, setVar, getVar } =
  boot({ search: "", now: "2026-09-01T12:00:00Z" });

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

ok("running without the pack parameter", () => [getVar("PREVIEW") === false, getVar("PREVIEW")]);
ok("no warnings on first paint", () => [warnings.length === 0, warnings.join(" | ")]);

/* even with a fully populated file present, nothing may surface */
setVar("H2H", JSON.stringify({
  seasons: [2019, 2020], managers: ["Scotty", "Bo"],
  games: [[2019, 1, "Scotty", 120.0, "Bo", 100.0, 0],
          [2020, 2, "Bo", 130.0, "Scotty", 90.0, 1]]
}));
setVar("h2hA", '""'); setVar("h2hB", '""');
S.paintHistoryNav();
S.renderH2H();

ok("h2h panel body is empty", () =>
  ["" === byId("h2hBody").innerHTML, JSON.stringify(byId("h2hBody").innerHTML.slice(0, 60))]);
ok("h2h panel is hidden", () => byId("h2hBody").style.display === "none");
ok("history subnav is hidden", () =>
  [byId("histNav").style.display === "none", byId("histNav").style.display]);
ok("owners content stays visible", () =>
  [byId("ownersBody").style.display === "", "'" + byId("ownersBody").style.display + "'"]);

/* the original History tab content still paints */
S.renderLedger();
S.renderDossiers();
ok("all-time ledger still renders", () => byId("tall").innerHTML.indexOf("Scotty") >= 0);
ok("owner dossiers still render", () => byId("dossiers").innerHTML.indexOf("Dawson") >= 0);
ok("champions strip still renders", () => byId("champs").innerHTML.indexOf("2025") >= 0);
ok("season tables still render", () => byId("seasons").innerHTML.indexOf("Final Standings") >= 0);

warnings.length = 0;
ok("renderAll survives", () => { S.renderAll(); return true; });
ok("renderAll logged no warnings", () => [warnings.length === 0, warnings.join(" | ")]);

console.log(`\n  ${passes} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
