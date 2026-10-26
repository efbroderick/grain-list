const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/start\(\);\s*$/, "");

function boot({ mobile = true, height = 844 } = {}) {
  const nodes = new Map();
  const styles = new Map();
  const classes = new Set();
  const media = { matches: mobile, addEventListener(_event, handler) { this.change = handler; } };
  const window = { innerHeight: height, handlers: {}, matchMedia: () => media,
    addEventListener(event, handler) { this.handlers[event] = handler; } };
  const document = {
    body: { style: { setProperty: (key, value) => styles.set(key, value) },
      classList: { toggle(key, enabled) { if (enabled) classes.add(key); else classes.delete(key); } } },
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, {
        handlers: {}, attributes: {},
        addEventListener(event, handler) { this.handlers[event] = handler; },
        setAttribute(key, value) { this.attributes[key] = value; },
        setPointerCapture() {},
        getBoundingClientRect() { return { height: selector === ".topbar" ? 116 : Number.parseFloat(styles.get("--sheet-height")) }; },
      });
      return nodes.get(selector);
    },
  };
  const context = vm.createContext({ document, window, Date });
  vm.runInContext(source, context);
  const controller = vm.runInContext("mobileSheet = initializeMobileSheet()", context);
  const handle = nodes.get("#sheet-handle");
  return { window, media, handle, classes, controller,
    height: () => Number.parseFloat(styles.get("--sheet-height")),
    event(name, event = {}) { handle.handlers[name]({ button: 0, isPrimary: true, pointerId: 1, detail: 1, ...event }); },
    run: code => vm.runInContext(code, context),
  };
}

test("the mobile sheet starts at the approved height and toggles with accessible labels", () => {
  const app = boot();
  assert.equal(app.height(), 338);
  assert.equal(app.handle.attributes["aria-expanded"], "false");
  app.event("click");
  assert.equal(app.height(), 676);
  assert.equal(app.handle.attributes["aria-label"], "Collapse organization list");
  app.event("click");
  assert.equal(app.height(), 338);
});

test("dragging clamps the panel and does not toggle it again on the trailing click", () => {
  const app = boot();
  app.event("pointerdown", { clientY: 500 });
  app.event("pointermove", { clientY: 200 });
  app.event("pointerup");
  app.event("click");
  assert.equal(app.height(), 638);
  app.event("pointerdown", { clientY: 200 });
  app.event("pointermove", { clientY: 1200 });
  assert.equal(app.height(), 144);
});

test("a cancelled gesture restores the previous panel height", () => {
  const app = boot();
  app.event("pointerdown", { clientY: 500 });
  app.event("pointermove", { clientY: 300 });
  app.event("pointercancel");
  assert.equal(app.height(), 338);
});

test("keyboard arrows, Home, End, and activation all work after a drag", () => {
  const app = boot();
  let prevented = false;
  app.event("keydown", { key: "ArrowUp", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(app.height(), 418);
  app.event("keydown", { key: "End", preventDefault() {} });
  assert.equal(app.height(), 676);
  app.event("keydown", { key: "Home", preventDefault() {} });
  assert.equal(app.height(), 144);
  app.event("click", { detail: 0 });
  assert.equal(app.height(), 676);
});

test("orientation and short screens cannot put the sheet over the header", () => {
  const app = boot();
  app.event("click");
  app.window.innerHeight = 390;
  app.window.handlers.resize();
  assert.equal(app.height(), 222);
  assert.equal(app.controller.inset(), 222);
  app.controller.collapse();
  assert.equal(app.height(), 222);
});

test("desktop layouts do not reserve a bottom-sheet map inset", () => {
  const app = boot({ mobile: false });
  assert.equal(app.controller.inset(), 0);
  app.media.matches = true;
  app.media.change();
  assert.equal(app.controller.inset(), 338);
});

test("fitting filtered results leaves positive map space on short screens", () => {
  const app = boot({ height: 390 });
  const options = app.run("globalThis.L={latLngBounds: points=>points}; lastFiltered=[{location:{lat:40,lng:-105}}]; map={getSize:()=>({y:274}),fitBounds:(_bounds,options)=>globalThis.fitOptions=options}; fitResults(); fitOptions");
  assert.ok(274 - options.paddingTopLeft[1] - options.paddingBottomRight[1] > 0);
  assert.equal(options.maxZoom, 12);
});

test("small markers keep 44px targets without changing their visible 24px dots", () => {
  const app = boot();
  const icon = app.run("globalThis.L={divIcon: options=>options}; organizationIcon({functions:['Grain Grower']})");
  assert.equal(icon.iconSize.join(","), "44,44");
  assert.equal(icon.iconAnchor.join(","), "22,22");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(css, /\.grain-marker\s*\{\s*width: 24px;\s*height: 24px;/);
});

test("the original flat grain filter is retained, without grouped-filter UI", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /id="grain-options" class="checkbox-grid"/);
  assert.equal(source.includes("renderGroupedGrains"), false);
  assert.equal(html.includes("Search grain varieties"), false);
});
