/* test/pwa.test.mjs
 *
 * The manifest, the install hint, and the service worker's caching strategy.
 *
 * The strategy is the part worth testing. A cache-first service worker can
 * serve yesterday's app and yesterday's scores forever, with no way for a
 * manager to force a refresh. These pin it to network-first for anything that
 * changes, and cache-first only for files that never change under the same name.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { boot } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.webmanifest"), "utf8"));
const sw = readFileSync(join(root, "sw.js"), "utf8");
const html = readFileSync(join(root, "index.html"), "utf8");

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

/* ---------- manifest ---------- */
ok("has a name and a short name", () => manifest.name && manifest.short_name);
ok("short name fits under a home screen icon", () =>
  [manifest.short_name.length <= 12, manifest.short_name]);
ok("opens standalone, without browser chrome", () => manifest.display === "standalone");
ok("colours match the app so there is no white flash", () =>
  manifest.background_color === "#0E2438" && manifest.theme_color === "#0E2438");

/* GitHub Pages serves this from /bromigos/, not the domain root */
ok("paths are relative, so the subpath is not hardcoded", () => {
  const abs = [manifest.start_url, manifest.scope]
    .concat(manifest.icons.map(i => i.src)).filter(v => v.startsWith("/"));
  return [abs.length === 0, abs.join(",")];
});
ok("has both icon sizes a launcher asks for", () => {
  const sizes = manifest.icons.map(i => i.sizes);
  return [sizes.includes("192x192") && sizes.includes("512x512"), sizes.join(",")];
});
ok("ships a maskable icon so Android does not crop the badge", () =>
  manifest.icons.some(i => (i.purpose || "").includes("maskable")));

/* ---------- the page ---------- */
ok("links the manifest", () => /rel="manifest"/.test(html));
ok("declares a theme colour", () => /name="theme-color"/.test(html));
ok("carries an apple touch icon, which iOS uses instead of the manifest", () =>
  /rel="apple-touch-icon"/.test(html));
ok("asks iOS for a standalone window", () =>
  /apple-mobile-web-app-capable/.test(html) && /mobile-web-app-capable/.test(html));
ok("names the home screen icon", () => /apple-mobile-web-app-title/.test(html));
ok("registers the worker after load, not during parse", () =>
  /addEventListener\("load"[\s\S]{0,120}serviceWorker\.register/.test(html));
ok("a failed registration is a warning, never a crash", () =>
  /serviceWorker\.register\("sw\.js"\)\.catch/.test(html));

/* ---------- caching strategy ---------- */
ok("the cache name is versioned", () => /const VERSION\s*=\s*"bromigos-v\d+"/.test(sw));
ok("old caches are dropped on activate", () =>
  /caches\.keys\(\)/.test(sw) && /caches\.delete/.test(sw));
ok("a new worker takes over rather than waiting for every tab to close", () =>
  /skipWaiting/.test(sw) && /clients\.claim/.test(sw));
ok("install cannot be aborted by one missing file", () =>
  /* addAll rejects the whole batch if any single file 404s. The word appears in
     a comment explaining that, so only a real call counts. */
  [!/cache\.addAll\(/.test(sw) && /cache\.add\(u\)\.catch/.test(sw),
   "cache.addAll is being used"]);
ok("only GET is intercepted", () => /req\.method !== "GET"/.test(sw));

/* the point of the whole file */
ok("the page and data are fetched from the network first", () => {
  const tail = sw.slice(sw.indexOf("if (!sameOrigin) return;"));
  return [/const res = await fetch\(req\)/.test(tail)
          && tail.indexOf("await fetch(req)") < tail.indexOf("caches.match(req)"),
          "cache is consulted before the network"];
});
ok("cached data is only a fallback for being offline", () => {
  const tail = sw.slice(sw.indexOf("if (!sameOrigin) return;"));
  return /catch \(err\)[\s\S]{0,120}caches\.match\(req\)/.test(tail);
});
ok("a navigation offline falls back to the shell", () =>
  /req\.mode === "navigate"/.test(sw));
ok("images and fonts are allowed to come from cache first", () =>
  /isFont \|\| isAsset/.test(sw));
ok("nothing cross-origin is intercepted except fonts", () =>
  /if \(!sameOrigin\) return;/.test(sw));

/* ---------- install hint ---------- */
{
  const { sandbox: S, byId } = boot({ search:"", now:"2026-09-16T12:00:00Z" });
  S.renderInstallHint();
  ok("nothing is shown on a device that cannot install this way", () =>
    byId("installHint").innerHTML === "");
}
{
  const { sandbox: S, byId } = boot({ search:"", now:"2026-09-16T12:00:00Z", storage:true });
  S.navigator.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
  S.renderInstallHint();
  ok("iOS is told how, because iOS never offers", () =>
    [/Add to Home Screen/.test(byId("installHint").innerHTML),
     byId("installHint").innerHTML.slice(0, 60)]);
  ok("dismissing it sticks", () => {
    const b = { onclick: null };
    S.document.getElementById("installGot");
    S.localStorage.setItem("bromigos.installed", "1");
    S.renderInstallHint();
    return byId("installHint").innerHTML === "";
  });
}
{
  const { sandbox: S, byId } = boot({ search:"", now:"2026-09-16T12:00:00Z" });
  S.navigator.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
  S.window.navigator.standalone = true;      // what iOS sets on an installed app
  S.renderInstallHint();
  ok("an already installed app is not nagged", () => byId("installHint").innerHTML === "");
}

console.log(`\n  ${passes} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
