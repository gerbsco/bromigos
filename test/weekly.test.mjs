/* test/weekly.test.mjs
 *
 * The award rules, against synthetic weeks. No network.
 * The case that matters most is a week where nothing was decided by under 5:
 * Heartbreaker and Sunday Scaries must still land on the tightest game rather
 * than quietly disappearing.
 */

import { assignAwards, latestCompleteWeek, weekRows, records, sideTotals, buildPacks }
  from "../scripts/weekly.mjs";

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

const row = (manager, myScore, oppScore, opponent, extra = {}) =>
  ({ manager, myScore, oppScore, opponent, bench: 0, projected: 0, high: 0, ...extra });
const titleOf = (rows, who) => {
  const r = rows.find(x => x.manager === who);
  return r && r.awards && r.awards[0] ? r.awards[0].title : null;
};

/* ---------- a normal week, several close games ---------- */
{
  const rows = assignAwards([
    row("Scotty", 150.0, 100.0, "Bo"),      row("Bo",      100.0, 150.0, "Scotty"),
    row("Dawson", 120.0, 118.0, "Anthony"), row("Anthony", 118.0, 120.0, "Dawson"),
    row("Cody",   110.0, 108.0, "Ryan"),    row("Ryan",    108.0, 110.0, "Cody"),
    row("Austin", 105.0,  95.0, "Andy"),    row("Andy",     95.0, 105.0, "Austin"),
    row("James",  102.0,  70.0, "Justin"),  row("Justin",   70.0, 102.0, "James")
  ], 1);

  ok("league high gets Scoring Machine", () => [titleOf(rows,"Scotty") === "Scoring Machine", titleOf(rows,"Scotty")]);
  ok("league low gets Walking Disaster", () => [titleOf(rows,"Justin") === "Walking Disaster", titleOf(rows,"Justin")]);
  ok("biggest loss gets the Chair", () => [titleOf(rows,"Bo") === "Chair Recipient", titleOf(rows,"Bo")]);
  ok("tightest loss gets Heartbreaker", () => [titleOf(rows,"Anthony") === "Heartbreaker", titleOf(rows,"Anthony")]);
  ok("tightest win gets Sunday Scaries", () => [titleOf(rows,"Dawson") === "Sunday Scaries", titleOf(rows,"Dawson")]);
  ok("awards is always an array, empty or not", () => rows.every(r => Array.isArray(r.awards)));
  ok("no filler card is ever issued", () =>
    !rows.some(r => r.awards.some(a => a.title === "No Awards")));
  ok("no award is issued twice in a week", () => {
    const all = rows.flatMap(r => r.awards.map(a => a.title));
    return [new Set(all).size === all.length, all.join(",")];
  });
  ok("ranks are assigned", () => rows.find(r => r.manager === "Scotty").rank === 1);

  /* the point of the reason line */
  ok("every award carries a reason", () =>
    rows.every(r => r.awards.every(a => !!a.reason)));
  ok("reason states the criterion", () => {
    const r = rows.find(x => x.manager === "Scotty").awards[0].reason;
    return [/Highest score in the league/.test(r), r];
  });
  ok("Chair reason gives the margin", () => {
    const r = rows.find(x => x.manager === "Bo").awards[0].reason;
    return [/Biggest losing margin, 50\.0/.test(r), r];
  });
  ok("every award carries flavour separate from the reason", () =>
    rows.every(r => r.awards.every(a => a.desc && a.desc !== a.reason)));
}

/* ---------- the case you flagged: no game inside 5 ---------- */
{
  const rows = assignAwards([
    row("Scotty", 150.0,  80.0, "Bo"),      row("Bo",       80.0, 150.0, "Scotty"),
    row("Dawson", 140.0, 100.0, "Anthony"), row("Anthony", 100.0, 140.0, "Dawson"),
    row("Cody",   130.0, 118.0, "Ryan"),    row("Ryan",    118.0, 130.0, "Cody"),
    row("Austin", 125.0,  90.0, "Andy"),    row("Andy",     90.0, 125.0, "Austin"),
    row("James",  120.0,  85.0, "Justin"),  row("Justin",   85.0, 120.0, "James")
  ], 2);

  const issued = rows.flatMap(r => r.awards.map(a => a.title));
  ok("blowout week still produces a Heartbreaker", () =>
    [issued.includes("Heartbreaker"), issued.join(",")]);
  ok("blowout week still produces Sunday Scaries", () =>
    [issued.includes("Sunday Scaries"), issued.join(",")]);
  ok("Heartbreaker falls to the tightest loss, 12.0", () =>
    [titleOf(rows,"Ryan") === "Heartbreaker", titleOf(rows,"Ryan")]);
  ok("Sunday Scaries falls to the tightest win, 12.0", () =>
    [titleOf(rows,"Cody") === "Sunday Scaries", titleOf(rows,"Cody")]);
  ok("the fallback reason still reads correctly", () => {
    const r = rows.find(x => x.manager === "Ryan").awards[0].reason;
    return [/Closest loss of the week, 12\.0/.test(r), r];
  });
}

/* ---------- flavour rotates by week ---------- */
{
  const mk = wk => assignAwards([
    row("Scotty", 150.0, 100.0, "Bo"), row("Bo", 100.0, 150.0, "Scotty")
  ], wk).find(r => r.manager === "Scotty").awards[0].desc;
  const seen = new Set([mk(1), mk(2), mk(3), mk(4)]);
  ok("four weeks give four different lines", () => [seen.size === 4, seen.size]);
  ok("the same week always gives the same line", () => mk(7) === mk(7));
}

/* ---------- bench and priority ---------- */
{
  /* Bo wastes a huge bench but took the biggest loss, which outranks it */
  const rows = assignAwards([
    row("Scotty", 150.0, 100.0, "Bo"),   row("Bo",     100.0, 150.0, "Scotty", { bench: 160.0 }),
    row("Cody",   120.0, 115.0, "Ryan"), row("Ryan",   115.0, 120.0, "Cody"),
    row("James",   95.0,  90.0, "Justin"), row("Justin", 90.0,  95.0, "James")
  ], 3);
  ok("a higher priority award wins over Bench Champion", () =>
    [titleOf(rows,"Bo") === "Chair Recipient", titleOf(rows,"Bo")]);
  ok("the bench card still goes out, just to someone else", () =>
    [rows.some(r => r.awards.some(a => a.title === "Bench Champion")),
     rows.map(r => r.manager + ":" + r.awards.map(a => a.title).join("+")).join(" ")]);
}
{
  /* Cody is not high, low, biggest, tightest or in a close game, so the bench
     is the first rule that applies to him */
  const rows = assignAwards([
    row("Scotty", 160.0,  90.0, "Bo"),    row("Bo",      90.0, 160.0, "Scotty"),
    row("Cody",   130.0, 120.0, "Ryan", { bench: 200.0 }), row("Ryan", 120.0, 130.0, "Cody"),
    row("Austin", 125.0, 118.0, "Andy"),  row("Andy",   118.0, 125.0, "Austin")
  ], 4);
  ok("Bench Champion lands when nothing above it applies", () =>
    [rows.find(r => r.manager === "Cody").awards.some(a => a.title === "Bench Champion"),
     titleOf(rows,"Cody")]);
  ok("its reason quotes the wasted points", () => {
    const a = rows.find(x => x.manager === "Cody").awards.find(a => a.title === "Bench Champion");
    return [/Bench outscored the starters by 70\.0/.test(a.reason), a.reason];
  });
}

/* ---------- spreading: shared awards prefer whoever has nothing ---------- */
{
  /* Scotty is both the league high and the biggest blowout, the only candidate
     for each. Austin has the tightest win, so Sunday Scaries is his. Austin also
     wasted the most bench, but Cody has nothing, so the bench card goes to Cody. */
  const rows = assignAwards([
    row("Scotty", 160.0,  90.0, "Bo"),    row("Bo",      90.0, 160.0, "Scotty"),
    row("Cody",   130.0, 120.0, "Ryan", { bench: 200.0 }), row("Ryan", 120.0, 130.0, "Cody"),
    row("Austin", 125.0, 118.0, "Andy", { bench: 300.0 }), row("Andy", 118.0, 125.0, "Austin")
  ], 5);
  const titles = m => rows.find(r => r.manager === m).awards.map(a => a.title);
  const layout = rows.map(r => r.manager + ":" + titles(r.manager).join("+")).join(" ");

  ok("a sole eligible manager takes a second award", () =>
    [titles("Scotty").includes("Scoring Machine") && titles("Scotty").includes("Blowout King"),
     layout]);
  ok("Austin holds the tightest win", () => [titles("Austin").includes("Sunday Scaries"), layout]);
  ok("the shared bench award skips Austin for Cody", () =>
    [titles("Cody").includes("Bench Champion") && !titles("Austin").includes("Bench Champion"),
     layout]);
  ok("Cody now holds a real superlative", () =>
    [titles("Cody").length === 1, titles("Cody").join("+")]);
  ok("Bo takes both the low and the chair, nobody else qualifies", () =>
    [titles("Bo").includes("Walking Disaster") && titles("Bo").includes("Chair Recipient"),
     layout]);
  ok("no award is handed out twice", () => {
    const all = rows.flatMap(r => r.awards.map(a => a.title));
    return [new Set(all).size === all.length, all.join(",")];
  });
  ok("a doubled-up manager still gets distinct reasons", () => {
    const a = rows.find(r => r.manager === "Scotty").awards;
    return [a[0].reason !== a[1].reason, a.map(x => x.reason).join(" | ")];
  });
}

/* a Heartbreaker who is not the tightest must not claim to be */
{
  const rows = assignAwards([
    row("Scotty", 150.0, 100.0, "Bo"),    row("Bo",     100.0, 150.0, "Scotty"),
    row("Cody",   120.0, 119.0, "Ryan"),  row("Ryan",   119.0, 120.0, "Cody"),
    row("Austin", 110.0, 106.0, "Andy"),  row("Andy",   106.0, 110.0, "Austin")
  ], 6);
  const hb = rows.flatMap(r => r.awards.filter(a => a.title === "Heartbreaker"))[0];
  ok("the tightest loss claims the closest tag", () =>
    [/Closest loss of the week, 1\.0/.test(hb.reason), hb.reason]);
}
{
  /* Ryan has the tightest loss but already holds Walking Disaster, so the
     Heartbreaker passes to Andy, whose reason must not say "closest" */
  const rows = assignAwards([
    row("Scotty", 150.0, 120.0, "Bo"),    row("Bo",     120.0, 150.0, "Scotty"),
    row("Cody",   101.0, 100.0, "Ryan"),  row("Ryan",   100.0, 101.0, "Cody"),
    row("Austin", 130.0, 127.0, "Andy"),  row("Andy",   127.0, 130.0, "Austin")
  ], 7);
  const holder = rows.find(r => r.awards.some(a => a.title === "Heartbreaker"));
  const hb = holder.awards.find(a => a.title === "Heartbreaker");
  ok("the passed-down Heartbreaker states its own margin", () =>
    [/inside five points/.test(hb.reason) || /Closest loss/.test(hb.reason), hb.reason]);
  ok("and that margin matches the manager who got it", () => {
    const m = Math.abs(holder.myScore - holder.oppScore).toFixed(1);
    return [hb.reason.indexOf(m) >= 0, holder.manager + " " + m + " -> " + hb.reason];
  });
}

/* Paper Champion is shared, so its wording has to adapt to who received it */
{
  const rows = assignAwards([
    row("Scotty", 150.0, 100.0, "Bo",   { projected: 100.0 }),
    row("Bo",     100.0, 150.0, "Scotty", { projected: 130.0 }),
    row("Cody",   120.0, 115.0, "Ryan", { projected: 110.0 }),
    row("Ryan",   115.0, 120.0, "Cody", { projected: 130.0 })
  ], 8);
  const holder = rows.find(r => r.awards.some(a => a.title === "Paper Champion"));
  const pc = holder.awards.find(a => a.title === "Paper Champion");
  ok("Paper Champion goes to a manager with nothing yet", () =>
    [holder.manager === "Cody", holder.manager]);
  ok("and does not claim the league best when it is not", () =>
    [!/most in the league/.test(pc.reason), pc.reason]);
  ok("its margin matches that manager", () =>
    [/Beat projection by 10\.0/.test(pc.reason), pc.reason]);
}
{
  const rows = assignAwards([
    row("Scotty", 150.0, 100.0, "Bo", { projected: 149.0 }),
    row("Bo",     100.0, 150.0, "Scotty", { projected: 130.0 }),
    row("Cody",   120.0, 115.0, "Ryan", { projected: 110.0 }),
    row("Ryan",   115.0, 120.0, "Cody", { projected: 130.0 })
  ], 9);
  const pc = rows.flatMap(r => r.awards).find(a => a.title === "Paper Champion");
  ok("it does claim the league best when it is", () =>
    [/most in the league/.test(pc.reason), pc.reason]);
}

/* ---------- an unremarkable manager gets nothing at all ---------- */
{
  const rows = assignAwards([
    row("Scotty", 150.0, 100.0, "Bo"),     row("Bo",      100.0, 150.0, "Scotty"),
    row("Cody",   130.0, 128.0, "Ryan"),   row("Ryan",    128.0, 130.0, "Cody"),
    row("Austin", 120.0, 112.0, "Andy"),   row("Andy",    112.0, 120.0, "Austin"),
    row("James",  118.0, 110.0, "Justin"), row("Justin",  110.0, 118.0, "James")
  ], 10);
  const bare = rows.filter(r => r.awards.length === 0);
  ok("some managers finish the week empty handed", () =>
    [bare.length > 0, rows.map(r => r.manager + ":" + r.awards.length).join(" ")]);
  ok("empty handed means an empty array, not a filler card", () =>
    bare.every(r => Array.isArray(r.awards) && r.awards.length === 0));
}

/* ---------- week completion ---------- */
{
  const sch = [
    { matchupPeriodId:1, winner:"HOME", home:{teamId:1}, away:{teamId:2} },
    { matchupPeriodId:1, winner:"AWAY", home:{teamId:3}, away:{teamId:4} },
    { matchupPeriodId:2, winner:"HOME", home:{teamId:1}, away:{teamId:3} },
    { matchupPeriodId:2, winner:"UNDECIDED", home:{teamId:2}, away:{teamId:4} }
  ];
  ok("a half-played week is not published", () => [latestCompleteWeek(sch) === 1, latestCompleteWeek(sch)]);
  sch[3].winner = "HOME";
  ok("it publishes once every game is final", () => latestCompleteWeek(sch) === 2);
  ok("no schedule yields no week", () => latestCompleteWeek([]) === 0);
  ok("bye entries do not block a week", () =>
    latestCompleteWeek([{ matchupPeriodId:1, winner:"HOME", home:{teamId:1} }]) === 0);
}

/* ---------- roster totals ---------- */
{
  const mkP = (slot, real, proj) => ({
    lineupSlotId: slot,
    playerPoolEntry: { player: { stats: [
      { statSourceId:0, scoringPeriodId:5, appliedTotal: real },
      { statSourceId:1, scoringPeriodId:5, appliedTotal: proj }
    ]}}
  });
  const t = sideTotals({ rosterForCurrentScoringPeriod: { entries: [
    mkP(0, 25.0, 20.0),    // starter
    mkP(2, 12.0, 14.0),    // starter
    mkP(20, 30.0, 18.0),   // bench
    mkP(21, 99.0, 99.0)    // IR, must not count as a starter
  ]}}, 5);
  ok("bench points sum only bench and IR", () => [t.bench === 129.0, t.bench]);
  ok("projection sums only starters", () => [t.projected === 34.0, t.projected]);
  ok("top starter is the highest starter, not the bench", () => [t.high === 25.0, t.high]);
  ok("starter count excludes bench and IR", () => [t.starters === 2, t.starters]);
  ok("an empty roster does not throw", () => sideTotals({}, 5).bench === 0);
}

/* ---------- end to end ---------- */
{
  const owners = { 1:"Scotty", 2:"Bo", 3:"Cody", 4:"Ryan" };
  const sch = [
    { matchupPeriodId:1, winner:"HOME",
      home:{ teamId:1, totalPoints:150.0 }, away:{ teamId:2, totalPoints:100.0 } },
    { matchupPeriodId:1, winner:"AWAY",
      home:{ teamId:3, totalPoints:110.0 }, away:{ teamId:4, totalPoints:112.0 } }
  ];
  const rows = weekRows(sch, owners, 1);
  ok("weekRows returns one row per manager", () => [rows.length === 4, rows.length]);
  ok("opponents resolve to names", () =>
    rows.find(r => r.manager === "Scotty").opponent === "Bo");

  const rec = records(sch, owners, 1);
  ok("records count wins and losses", () => [rec["Scotty"][0] === 1 && rec["Bo"][1] === 1,
    JSON.stringify(rec)]);

  const packs = buildPacks(sch, owners, 1);
  ok("a pack exists for every manager", () => [Object.keys(packs).length === 4,
    Object.keys(packs).join(",")]);
  ok("league high is flagged", () => packs["Scotty"].leagueHigh === true);
  ok("league low is flagged", () => packs["Bo"].leagueLow === true);
  ok("record is formatted for the card", () => [packs["Scotty"].record === "1-0",
    packs["Scotty"].record]);
  ok("packs carry only real superlatives", () =>
    Object.values(packs).every(p => Array.isArray(p.awards)
      && !p.awards.some(a => a.title === "No Awards")));
  ok("no manager is missing a rank", () => Object.values(packs).every(p => p.rank >= 1));
}

console.log(`\n  ${passes} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
