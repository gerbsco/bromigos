// scripts/managers.mjs
//
// One source of truth for turning whatever ESPN has stored into the name the
// league actually uses. Both h2h.mjs and weekly.mjs import this, because a
// mismatch is not cosmetic: weekly packs are keyed by manager name, so a name
// that resolves wrong means that manager silently gets no pack at all.

/* The ten active managers plus everyone who has held a team. Anything that
   resolves outside this list gets flagged loudly by the build scripts. */
export const KNOWN = ["Scotty", "Bo", "Dawson", "Anthony", "Cody", "Ryan",
  "Austin", "Andy", "James", "Justin", "Gavin", "Mike"];

/* ESPN's stored name -> the name the league uses. Keys are compared in
   lowercase, so casing in ESPN does not matter. A member GUID can also be used
   as a key when two people share a first name. */
export const ALIAS = {
  "scott":  "Scotty",
  "andrew": "Dawson",   // goes by his last name in this league
  "drew":   "Dawson",
  "michael": "Mike",
  "jim":    "James",
  "jimmy":  "James",
  "rob":    "Bo",
  "robert": "Bo"
};

/* "bo" -> "Bo", "SCOTT" -> "Scott". Applied before the alias lookup so a
   lowercase ESPN name still lands correctly even with no alias entry. */
export function titleCase(name) {
  return String(name || "").trim().toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

/* An ESPN member record -> the league's name for that person. */
export function resolveName(member) {
  if (!member) return "";
  const raw = (member.firstName || "").trim() || (member.displayName || "").trim();
  const byGuid = ALIAS[member.id] || ALIAS[String(member.id || "").toLowerCase()];
  if (byGuid) return byGuid;
  const byName = ALIAS[raw.toLowerCase()];
  if (byName) return byName;
  return titleCase(raw);
}

/* team id -> { name, guid } for one season. Team ids get recycled between
   seasons, so this is only valid for the season it was built from. */
export function ownerMap(teamDoc) {
  const names = {};
  ((teamDoc && teamDoc.members) || []).forEach(m => { names[m.id] = resolveName(m); });

  const byTeam = {};
  ((teamDoc && teamDoc.teams) || []).forEach(t => {
    const guid = (t.owners || [])[0];
    if (!guid) return;
    byTeam[t.id] = { name: names[guid] || "unknown:" + guid, guid };
  });
  return byTeam;
}

/* Print what the run resolved, and shout about anything unexpected. A wrong
   name here is the difference between a manager getting their pack and not. */
export function rosterReport(counts) {
  const names = [...counts.keys()].sort();
  console.log("\nroster resolved from ESPN:");
  names.forEach(n => {
    const flag = KNOWN.includes(n) ? "" : "   <-- NOT IN KNOWN LIST, add an ALIAS";
    console.log(`  ${n.padEnd(12)} ${String(counts.get(n)).padStart(3)}${flag}`);
  });
  const missing = KNOWN.filter(k => !names.includes(k));
  if (missing.length) console.log(`\nexpected but never seen: ${missing.join(", ")}`);
  return names;
}
