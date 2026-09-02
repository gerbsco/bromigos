/* test/harness.mjs
   boot() runs the index.html script in Node against a deliberately strict DOM
   stub. getElementById returns null for anything not actually in the markup,
   which is what a real browser does and what a permissive stub hides.

   Each boot() is a fresh sandbox, so a test can load the page as the league
   sees it on a given date and check what is visible. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

const REAL_IDS = new Set();
html.replace(/\bid="([^"]+)"/g, (whole, id) => { REAL_IDS.add(id); return whole; });

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if(scripts.length !== 1) throw new Error("expected one inline script, found " + scripts.length);

function mkEl(id, tag){
  return {
    id: id || "", tagName: (tag || "div").toUpperCase(),
    innerHTML: "", textContent: "", value: "", className: "",
    style: {}, dataset: {}, attrs: {}, children: [],
    classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    setAttribute(k, v){ this.attrs[k] = String(v); },
    getAttribute(k){ return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k){ delete this.attrs[k]; },
    appendChild(c){ this.children.push(c); return c; },
    addEventListener(){}, removeEventListener(){}, focus(){}, scrollIntoView(){},
    closest(){ return null; }, remove(){},
    getBoundingClientRect(){ return {width:0,height:0,top:0,left:0,right:0,bottom:0}; },
    querySelector(sel){ return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel){
      const m = /\[([a-zA-Z-]+)(?:=["']?([^\]"']+)["']?)?\]/.exec(sel);
      if(!m) return [];
      const attr = m[1], found = [];
      const re = new RegExp(attr + '="([^"]*)"', "g");
      let hit;
      while((hit = re.exec(this.innerHTML))){
        if(m[2] && hit[1] !== m[2]) continue;
        const e = mkEl("", "button");
        const key = attr.replace(/^data-/, "").replace(/-(\w)/g, (_, c) => c.toUpperCase());
        if(attr.startsWith("data-")) e.dataset[key] = hit[1];
        found.push(e);
      }
      return found;
    }
  };
}

export function boot({ search = "?pack=1", now = null, storage = false } = {}){
  const REG = new Map();
  const byId = id => {
    if(!REAL_IDS.has(id)) return null;          // the important part
    if(!REG.has(id)) REG.set(id, mkEl(id));
    return REG.get(id);
  };

  const doc = {
    getElementById: byId,
    createElement: t => mkEl("", t),
    querySelector(){ return null; },
    querySelectorAll(sel){
      if(sel.indexOf(".panel") === 0){
        return ["hq","trade","wire","history","rules","team","binder","demo"]
          .map(p => byId(p) || mkEl(p));
      }
      if(sel.indexOf(".minscale") === 0) return [];
      return [];
    },
    addEventListener(){}, body: mkEl("", "body"), documentElement: mkEl("", "html")
  };

  /* freeze the clock so phase tests are deterministic forever */
  let DateImpl = Date;
  if(now){
    const fixed = new Date(now).getTime();
    DateImpl = class extends Date {
      constructor(...a){ if(!a.length) super(fixed); else super(...a); }
      static now(){ return fixed; }
    };
  }

  const warnings = [];
  const sandbox = {
    document: doc,
    window: { addEventListener(){}, scrollTo(){},
              matchMedia: () => ({ matches:false, addEventListener(){} }) },
    location: { search, hash: "", href: "https://x/" },
    history: { replaceState(){}, pushState(){} },
    localStorage: storage
      ? (() => { const m = new Map(); return {
          getItem: k => (m.has(k) ? m.get(k) : null),
          setItem: (k, v) => { m.set(k, String(v)); },
          removeItem: k => { m.delete(k); }, _map: m }; })()
      : { getItem: () => null, setItem(){}, removeItem(){} },
    navigator: { userAgent: "node" },
    console: { log(){}, warn: (...a) => warnings.push(a.join(" ")),
               error: (...a) => warnings.push(a.join(" ")) },
    fetch: () => Promise.resolve({ ok:false, json: () => Promise.resolve(null) }),
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    requestAnimationFrame: cb => setTimeout(cb, 0),
    URLSearchParams, Set, Map, Math, Date: DateImpl, JSON, Promise,
    Array, Object, String, Number, isNaN, parseFloat, parseInt
  };
  sandbox.window.document = doc;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(scripts[0], sandbox, { filename: "index.html" });

  /* let/const at the top level of a classic script are lexical bindings, not
     properties of the global object, so they can only be reached from inside. */
  const setVar = (name, literal) => vm.runInContext(name + " = " + literal, sandbox);
  const getVar = name => vm.runInContext(name, sandbox);

  return { sandbox, byId, warnings, setVar, getVar };
}

export { REAL_IDS };
