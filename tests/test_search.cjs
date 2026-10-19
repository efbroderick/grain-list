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
      setAttribute(name, value) { this[name] = value; },
      showModal() { this.open = true; },
      close() { this.open = false; },
      focus() {},
    };
  }
  const timers = new Map();
  let nextTimer = 0;
  const window = {
    location: { search: "", pathname: "/", origin: "https://grain-list.vercel.app" },
    handlers: {},
    addEventListener(name, handler) { this.handlers[name] = handler; },
    history: {
      state: null, previous: null,
      replaceState(state, _title, url) { this.state = state; const parsed = new URL(url, window.location.origin); window.location.search = parsed.search; window.location.pathname = parsed.pathname; },
      pushState(state, title, url) { this.previous = { state: this.state, url: window.location.pathname + window.location.search }; this.replaceState(state, title, url); },
      back() { const previous = this.previous; this.replaceState(previous.state, "", previous.url); window.handlers.popstate(); },
    },
    clearTimeout(id) { timers.delete(id); },
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
  };
  const document = {
    querySelector(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
    querySelectorAll() { return []; },
    createElement: node,
    addEventListener() {},
  };
  const context = vm.createContext({ window, document, URLSearchParams, URL });
  // Bind the real search handler without starting Leaflet or fetching the directory.
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/start\(\);\s*$/, "");
  vm.runInContext(`${source}\nrender = () => { syncControls(); updateUrl(); }; fitResults = () => {}; bindEvents();`, context);
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
    run(code) { return vm.runInContext(code, context); },
    setSearch(search) { window.location.search = search; },
    window, nodes,
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

test("map deep links retain the stable ID without hiding surrounding organizations", () => {
  const app = boot();
  app.setSearch("?organization=grain-1234567890abcdef");
  app.run("parseUrlState(); state.organizations = [{id:'grain-1234567890abcdef',name:'Same Farm',functions:[],grains:[],searchText:'same farm'}, {id:'grain-abcdef1234567890',name:'Same Farm',functions:[],grains:[],searchText:'same farm'}]");
  assert.equal(app.run("state.focusedOrganizationId"), "grain-1234567890abcdef");
  assert.equal(app.run("filteredOrganizations().length"), 2);
  app.input("farm"); app.flush();
  assert.equal(app.run("state.focusedOrganizationId"), "");
  assert.equal(app.run("filteredOrganizations().length"), 2);
});

test("result cards have real organization links and enhance normal clicks into overlays", () => {
  const app = boot();
  const result = app.run("resultItem({id:'grain-1234567890abcdef',name:'Farm',state:'CO',address:'',functions:['Grain Grower'],grains:['Rye']})");
  assert.equal(result.href, "/organizations/grain-1234567890abcdef/");
  assert.equal(typeof result.handlers.click, "function");
  let prevented = false;
  result.handlers.click({ ctrlKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
});

test("sidebar follows map bounds while marker candidates include offscreen matches", () => {
  const app = boot();
  app.run("state.organizations = [{id:'a',name:'Near',functions:[],grains:[],searchText:'',location:{lat:40,lng:-105}}, {id:'b',name:'Far',functions:[],grains:[],searchText:'',location:{lat:45,lng:-80}}]; map = {getBounds:()=>({contains:point=>point[0]===40})}");
  assert.equal(app.run("filteredOrganizations().length"), 1);
  assert.equal(app.run("filteredOrganizations()[0].name"), "Near");
  assert.equal(app.run("filteredOrganizations(true).length"), 2);
  app.run("map = {getBounds:()=>({contains:point=>point[0]===45})}");
  assert.equal(app.run("filteredOrganizations()[0].name"), "Far");
});

test("distance is hidden until a location is available; obsolete verified flags are ignored", () => {
  const app = boot();
  app.setSearch("?verified=1"); app.run("parseUrlState(); syncControls();");
  assert.equal(app.nodes.get("#distance-field").hidden, true);
  app.run("state.userLocation={lat:40,lng:-105}; syncControls();");
  assert.equal(app.nodes.get("#distance-field").hidden, false);
  assert.equal(app.nodes.get("#radius-filter").disabled, false);
  assert.equal(app.run("state.verifiedOnly"), undefined);
});

test("profile overlays update the URL, close back to the map, and can reopen from history", () => {
  const app = boot();
  app.run("state.organizations=[{id:'grain-1234567890abcdef',name:'Farm',category:'Farm',state:'CO',functions:['Grain Grower'],grains:['Rye'],sources:[],address:'',phone:'',email:'',url:''}]; showDetails(state.organizations[0]);");
  assert.equal(app.window.location.pathname, "/organizations/grain-1234567890abcdef/");
  assert.equal(app.nodes.get("#detail-dialog").open, true);
  app.run("closeDetails()");
  assert.equal(app.window.location.pathname, "/");
  assert.equal(app.nodes.get("#detail-dialog").open, false);
  app.window.location.pathname = "/organizations/grain-1234567890abcdef/";
  app.window.handlers.popstate();
  assert.equal(app.nodes.get("#detail-dialog").open, true);
  app.run("closeDetails()");
  assert.equal(app.window.location.pathname, "/");
});
