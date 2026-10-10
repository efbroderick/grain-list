const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function boot() {
  const nodes = new Map();
  function node() {
    return {
      value: "", hidden: false, disabled: false, handlers: {}, options: {},
      addEventListener(event, handler) { this.handlers[event] = handler; },
      querySelector() { return node(); },
      focus() {},
    };
  }
  const timers = new Map();
  let nextTimer = 0;
  const window = {
    location: { search: "", pathname: "/" },
    history: { replaceState(_state, _title, url) { window.location.search = url.slice(1); } },
    clearTimeout(id) { timers.delete(id); },
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
  };
  const document = {
    querySelector(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const context = vm.createContext({ window, document, URLSearchParams });
  // Bind the real search handler without starting Leaflet or fetching the directory.
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/start\(\);\s*$/, "");
  vm.runInContext(`${source}\nrender = () => { syncControls(); updateUrl(); }; bindEvents();`, context);
  return {
    input(value) {
      const input = nodes.get("#search-input");
      input.value = value;
      input.handlers.input({ target: input });
    },
    flush() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach(callback => callback());
    },
    value() { return nodes.get("#search-input").value; },
    matches(text) {
      context.candidate = { searchText: text };
      return vm.runInContext("matchesQuery(candidate)", context);
    },
    clear() { nodes.get("#clear-search").handlers.click(); },
    clearHidden() { return nodes.get("#clear-search").hidden; },
    restoredQuery() {
      vm.runInContext("state.query = ''; parseUrlState(); syncControls();", context);
      return this.value();
    },
  };
}

test("a pause after a space does not join the next word to the previous one", () => {
  const app = boot();
  app.input("40 ");
  app.flush();
  assert.equal(app.value(), "40 ");
  app.input(`${app.value()}Century `);
  app.flush();
  assert.equal(app.value(), "40 Century ");
  app.input(`${app.value()}Grain`);
  app.flush();
  assert.equal(app.value(), "40 Century Grain");
  assert.equal(app.matches("40 century grain minnesota"), true);
  assert.equal(app.matches("century grain"), false);
});

test("leading and repeated spaces are preserved while matching stays normalized", () => {
  const app = boot();
  app.input("  Hard   Red Winter Wheat  ");
  app.flush();
  assert.equal(app.value(), "  Hard   Red Winter Wheat  ");
  assert.equal(app.matches("hard red winter wheat"), true);
  assert.equal(app.matches("hard white wheat"), false);
  assert.equal(app.restoredQuery(), "  Hard   Red Winter Wheat  ");
});

test("clear search also cancels the effect of pending search rendering", () => {
  const app = boot();
  app.input("40 ");
  app.clear();
  app.flush();
  assert.equal(app.value(), "");
  assert.equal(app.clearHidden(), true);
  assert.equal(app.matches("any organization"), true);
});
