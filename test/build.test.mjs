/* Tests scripts/h2h.mjs against synthetic ESPN-shaped payloads. No network.
   The risky part is the member-GUID join, because team ids get recycled
   between seasons and land on a different manager. */

import { ownerMap, tierCode, collect } from "../scripts/h2h.mjs";

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

const GUID_SCOTT = "{AAAA-1111}";
const GUID_BO    = "{BBBB-2222}";
const GUID_CODY  = "{CCCC-3333}";

/* 2019: Scott is team 1, Bo is team 2 */
const team2019 = {
  members: [
    { id: GUID_SCOTT, firstName: "Scott", lastName: "G", displayName: "scottyg" },
    { id: GUID_BO,    firstName: "Bo",    lastName: "H", displayName: "bo" },
    { id: GUID_CODY,  firstName: "Cody",  lastName: "L", displayName: "cody" }
  ],
  teams: [
    { id: 1, owners: [GUID_SCOTT] },
    { id: 2, owners: [GUID_BO] },
    { id: 3, owners: [GUID_CODY] }
  ]
};

/* 2020: the same ids now belong to different people. A team-id join breaks
   here; a GUID join does not. */
const team2020 = {
  members: team2019.members,
  teams: [
    { id: 1, owners: [GUID_BO] },
    { id: 2, owners: [GUID_CODY] },
    { id: 3, owners: [GUID_SCOTT] }
  ]
};

/* ---------- ownerMap ---------- */
ok("alias rewrites Scott to Scotty", () => {
  const m = ownerMap(team2019);
  return [m[1].name === "Scotty", m[1].name];
});
ok("unaliased first names pass through", () => ownerMap(team2019)[2].name === "Bo");
ok("guid is carried alongside the name", () => ownerMap(team2019)[1].guid === GUID_SCOTT);
ok("team ids remap between seasons", () => {
  const m = ownerMap(team2020);
  return [m[1].name === "Bo" && m[3].name === "Scotty", m[1].name + "/" + m[3].name];
});
ok("ownerless team is skipped", () => {
  const m = ownerMap({ members: team2019.members, teams: [{ id: 9, owners: [] }] });
  return !m[9];
});
ok("unknown guid is flagged, not dropped", () => {
  const m = ownerMap({ members: [], teams: [{ id: 4, owners: ["{ZZZ}"] }] });
  return [/^unknown:/.test(m[4].name), m[4].name];
});
ok("empty document does not throw", () => { ownerMap({}); ownerMap(null); return true; });

/* ---------- tierCode ---------- */
ok("missing tier is regular season", () => tierCode(undefined) === 0 && tierCode(null) === 0);
ok("NONE is regular season", () => tierCode("NONE") === 0);
ok("winners bracket is playoffs", () => tierCode("WINNERS_BRACKET") === 1);
ok("consolation ladders are tier 2", () =>
  tierCode("LOSERS_CONSOLATION_LADDER") === 2 && tierCode("WINNERS_CONSOLATION_LADDER") === 2);

/* ---------- collect ---------- */
const schedule2019 = {
  schedule: [
    { matchupPeriodId: 1, winner: "HOME",
      home: { teamId: 1, totalPoints: 120.456 }, away: { teamId: 2, totalPoints: 100.1 } },
    { matchupPeriodId: 2, winner: "AWAY", playoffTierType: "NONE",
      home: { teamId: 2, totalPoints: 90.0 },   away: { teamId: 3, totalPoints: 111.0 } },
    { matchupPeriodId: 15, winner: "HOME", playoffTierType: "WINNERS_BRACKET",
      home: { teamId: 1, totalPoints: 160.0 },  away: { teamId: 3, totalPoints: 99.0 } },
    { matchupPeriodId: 15, winner: "HOME", playoffTierType: "LOSERS_CONSOLATION_LADDER",
      home: { teamId: 2, totalPoints: 88.0 },   away: { teamId: 3, totalPoints: 80.0 } },

    /* things that must be dropped */
    { matchupPeriodId: 3, winner: "UNDECIDED",
      home: { teamId: 1, totalPoints: 0 },      away: { teamId: 2, totalPoints: 0 } },
    { matchupPeriodId: 4, winner: "HOME",
      home: { teamId: 1, totalPoints: 0 },      away: { teamId: 2, totalPoints: 0 } },
    { matchupPeriodId: 5, winner: "HOME",
      home: { teamId: 1, totalPoints: 105.0 } },
    { matchupPeriodId: 6, winner: "HOME",
      home: { teamId: 77, totalPoints: 105.0 }, away: { teamId: 1, totalPoints: 90.0 } }
  ]
};

const rows = collect(2019, team2019, schedule2019);

ok("only real games survive", () => [rows.length === 4, rows.length]);
ok("season is stamped on every row", () => rows.every(r => r[0] === 2019));
ok("names resolved, not team ids", () => {
  const r = rows[0];
  return [r[2] === "Scotty" && r[4] === "Bo", r[2] + " vs " + r[4]];
});
ok("points rounded to two places", () => [rows[0][3] === 120.46, rows[0][3]]);
ok("regular season tagged 0", () => rows[0][6] === 0 && rows[1][6] === 0);
ok("playoff game tagged 1", () => [rows[2][6] === 1, rows[2][6]]);
ok("consolation game tagged 2", () => [rows[3][6] === 2, rows[3][6]]);
ok("undecided game dropped", () => !rows.some(r => r[1] === 3));
ok("scoreless game dropped", () => !rows.some(r => r[1] === 4));
ok("bye week dropped", () => !rows.some(r => r[1] === 5));
ok("unknown team id dropped", () => !rows.some(r => r[1] === 6));

const rows2020 = collect(2020, team2020, {
  schedule: [{ matchupPeriodId: 1, winner: "HOME",
    home: { teamId: 1, totalPoints: 120.0 }, away: { teamId: 2, totalPoints: 100.0 } }]
});
ok("recycled team ids resolve to the new owners", () => {
  const r = rows2020[0];
  return [r[2] === "Bo" && r[4] === "Cody", r[2] + " vs " + r[4]];
});

ok("empty schedule returns nothing", () => collect(2021, team2019, {}).length === 0);
ok("null documents do not throw", () => collect(2021, null, null).length === 0);

console.log(`\n  ${passes} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
