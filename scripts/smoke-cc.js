// Dependency-free runtime smoke test: run the CC inline scripts under a proxy-mock DOM.
// Catches reference/runtime errors in the render path (e.g. calling a removed function).
const fs = require('fs'), vm = require('vm'), path = require('path');
const target = process.argv[2] || path.join(__dirname, '..', 'Data-Private', 'Data-Created', 'ODSP-AW-CC.html');
const html = fs.readFileSync(target, 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

function mockEl() {
  const fn = function () { return mockEl(); };
  return new Proxy(fn, {
    get(t, p) {
      if (p === Symbol.iterator) return function* () {};
      if (p === 'length') return 0;
      if (['innerHTML','outerHTML','textContent','value','id','className','nodeName','tagName'].includes(p))
        return t['_' + String(p)] !== undefined ? t['_' + String(p)] : '';
      if (['parentNode','nextSibling','previousSibling','firstChild'].includes(p)) return null;
      if (['checked','disabled'].includes(p)) return false;
      return mockEl();
    },
    set(t, p, v) { t['_' + String(p)] = v; return true; },
    has() { return true; },
    apply() { return mockEl(); }
  });
}
const domReady = [];
const document = {
  getElementById: () => mockEl(), querySelector: () => mockEl(), querySelectorAll: () => [],
  getElementsByClassName: () => [], getElementsByTagName: () => [],
  createElement: () => mockEl(), createTextNode: () => mockEl(), createDocumentFragment: () => mockEl(),
  addEventListener: (t, f) => { if (t === 'DOMContentLoaded' || t === 'load') domReady.push(f); },
  removeEventListener: () => {}, head: mockEl(), body: mockEl(), documentElement: mockEl(), readyState: 'complete'
};
const localStorage = { _d: {}, getItem(k){return Object.prototype.hasOwnProperty.call(this._d,k)?this._d[k]:null;}, setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];}, clear(){this._d={};}, key(){return null;} };
const window = { addEventListener: (t,f) => { if (t==='DOMContentLoaded'||t==='load') domReady.push(f); }, removeEventListener(){}, matchMedia: () => ({matches:false, addEventListener(){}, removeEventListener(){}}), location:{href:'file://cc',hash:'',search:'',pathname:''}, localStorage, scrollTo(){}, getComputedStyle:()=>mockEl(), innerWidth:1200, innerHeight:800 };
const navigator = { userAgent:'node-smoke', clipboard:{ writeText: () => Promise.resolve() } };
const setTimeout = (f) => { if (typeof f==='function') f(); return 0; };
const requestAnimationFrame = (f) => { if (typeof f==='function') f(0); return 0; };
const sandbox = { document, window, localStorage, navigator, console, setTimeout, setInterval:()=>0, clearInterval:()=>{}, clearTimeout:()=>{}, requestAnimationFrame, alert:()=>{}, confirm:()=>true, prompt:()=>null };
sandbox.window = window; sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);

let ok = true;
scripts.forEach((src, i) => {
  try { vm.runInContext(src, sandbox, { timeout: 8000, filename: 'inline-' + (i+1) + '.js' }); }
  catch (e) { ok = false; console.error('Script #' + (i+1) + ' RUNTIME ERROR: ' + (e && e.message)); }
});
domReady.forEach((f, i) => { try { f(); } catch (e) { ok = false; console.error('DOMReady #' + (i+1) + ' ERROR: ' + (e && e.message)); } });
['renderStatic','renderDynamic'].forEach(n => { try { if (typeof sandbox[n] === 'function') sandbox[n](); } catch (e) { ok = false; console.error(n + '() ERROR: ' + (e && e.message)); } });
console.log(ok ? 'SMOKE OK \u2014 cockpit scripts + render path ran with no runtime errors' : 'SMOKE FAILED');
process.exit(ok ? 0 : 1);
