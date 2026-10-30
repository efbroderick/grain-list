const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function boot() {
  const nodes = new Map();
  function node() {
    return {
      value: "", hidden: false, disabled: false, handlers: {}, options: {}, children: [], queries: new Map(),
      addEventListener(event, handler) { this.handlers[event] = handler; },
      querySelector(selector) { if (!this.queries.has(selector)) this.queries.set(selector, node()); return this.queries.get(selector); },
      querySelectorAll() { return []; },
      setAttribute(name, value) { this[name] = value; },
      removeAttribute(name) { delete this[name]; },
      replaceChildren() { this.children = []; },
      append(child) { this.children.push(child); },
      scrollIntoView() {},
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
    body: {classList: {remove(){}}},
    querySelector(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
    querySelectorAll() { return []; },
    createElement: node,
    createDocumentFragment: node,
    addEventListener() {},
  };
  const context = vm.createContext({ window, document, URLSearchParams, URL });
  // Bind the real search handler without starting Leaflet or fetching the directory.
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/start\(\);\s*$/, "");
  vm.runInContext(`${source}\nglobalThis.fitCalls=0; render = () => { syncControls(); updateUrl(); }; fitResults = () => {fitCalls++}; bindEvents(); initializeSearch();`, context);
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
    key(key) { nodes.get('#search-input').handlers.keydown({key,preventDefault(){}}); },
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

test("named profile URLs resolve to the same organization overlay", () => {
  const app = boot();
  app.window.location.pathname = "/organizations/aspen-moon-farm/";
  app.run("state.organizations=[{id:'grain-1234567890abcdef',slug:'aspen-moon-farm',name:'Aspen Moon Farm',category:'Farm',state:'CO',functions:[],grains:[],sources:[],address:'',phone:'',email:'',url:''}]");
  app.window.handlers.popstate();
  assert.equal(app.nodes.get("#detail-name").textContent, "Aspen Moon Farm");
  assert.equal(app.window.location.pathname, "/organizations/aspen-moon-farm/");
  app.run("closeDetails()");
  assert.equal(app.window.location.pathname, "/");
});

test('typing and clearing search never move the map; Enter moves it once', () => {
  const app = boot();
  app.input('Bakeries'); app.flush();
  assert.equal(app.run('fitCalls'), 0);
  app.key('Enter'); app.flush();
  assert.equal(app.run('fitCalls'), 1);
  app.clear(); app.flush();
  assert.equal(app.run('fitCalls'), 1);
});

test('full state names and codes restrict geography rather than matching Company or address fragments', () => {
  const app = boot();
  app.run("state.organizations=[{name:'Mountain Mill',state:'CO',functions:[],grains:[],searchText:'mountain mill co wheat'}, {name:'Corn Company',state:'NC',functions:[],grains:[],searchText:'corn company nc wheat'}, {name:'Colorado Bread Co',state:'CA',functions:[],grains:[],searchText:'colorado bread co ca wheat'}]; initializeSearch();");
  for (const query of ['Colorado', 'CO']) {
    app.input(query); app.flush();
    assert.equal(app.run('filteredOrganizations(true).map(o=>o.state).join()'), 'CO');
  }
  for (const query of ['North Carolina', 'NC']) {
    app.input(query); app.flush();
    assert.equal(app.run('filteredOrganizations(true).map(o=>o.state).join()'), 'NC');
  }
  app.input('Colorado Bread Co'); app.flush();
  assert.equal(app.run('filteredOrganizations(true)[0].name'), 'Colorado Bread Co');
});

test('bakery plurals, punctuation, and accents match without arbitrary middle-of-word substrings', () => {
  const app = boot();
  for (const query of ['bakery', 'bakeries', 'bakers']) {
    app.input(query); app.flush();
    assert.equal(app.matches('retail baked goods baker wheat'), true);
  }
  app.input("Babettes"); app.flush();
  assert.equal(app.matches("babettes bakery"), true);
  app.input('cafe'); app.flush();
  assert.equal(app.matches('café rye'), true);
  app.input('nc'); app.flush();
  assert.equal(app.matches('san francisco'), false);
});

test('city suggestions are disambiguated by state and near-place terms keep grain filters', () => {
  const app = boot();
  app.run("state.organizations=[{name:'Denver Mill',city:'Denver',state:'CO',location:{lat:39.7,lng:-104.9,precision:'address'},functions:['Wholesale Flour'],grains:['Wheat'],searchText:'denver mill wheat co'}, {name:'Portland Mill',city:'Portland',state:'OR',location:{lat:45,lng:-122,precision:'address'},functions:[],grains:['Rye'],searchText:'portland rye or'}, {name:'Portland Bread',city:'Portland',state:'ME',location:{lat:43,lng:-70,precision:'address'},functions:[],grains:['Wheat'],searchText:'portland wheat me'}]; initializeSearch(); state.grains.add('Wheat');");
  app.input('wheat near Denver'); app.flush();
  assert.equal(app.run('searchIntent().place.label'), 'Denver, CO');
  assert.equal(app.run('searchIntent().terms.join()'), 'wheat');
  assert.equal(app.run('state.grains.has("Wheat")'), true);
  app.input('Portland'); app.flush();
  assert.equal(app.run('searchIntent().place'), null);
  app.input('Portland ME'); app.flush();
  assert.equal(app.run('searchIntent().place.label'), 'Portland, ME');
});

test('suggestions support keyboard selection, dismissal, and safe text escaping', () => {
  const app = boot();
  app.run("state.organizations=[{name:'Farm <script>',state:'CO',city:'Boulder',functions:[],grains:[],searchText:'farm script',location:{lat:40,lng:-105,precision:'address'}}]; initializeSearch();");
  app.input('Farm'); app.flush();
  const suggestions = app.nodes.get('#search-suggestions');
  assert.equal(suggestions.hidden, false);
  assert.match(suggestions.children[0].innerHTML, /&lt;script&gt;/);
  app.key('ArrowDown');
  assert.equal(app.nodes.get('#search-input')['aria-activedescendant'], 'search-option-0');
  app.key('Escape');
  assert.equal(suggestions.hidden, true);
  assert.equal(app.nodes.get('#search-input')['aria-activedescendant'], undefined);
});

test('name relevance outranks alphabetical incidental matches', () => {
  const app = boot();
  app.run("state.organizations=[{name:'A Farm',state:'CO',functions:[],grains:[],searchText:'a farm grain'}, {name:'Grain Mill',state:'CO',functions:[],grains:[],searchText:'grain mill'}, {name:'Grain',state:'CO',functions:[],grains:[],searchText:'grain'}]");
  app.input('Grain'); app.flush();
  assert.equal(app.run('filteredOrganizations(true).map(o=>o.name).join("|")'), 'Grain|Grain Mill|A Farm');
});

test('function and grain selection and chip removal preserve the map position', () => {
  const app = boot();
  app.run("renderCheckboxOptions(elements.functions,[['Grain Grower',2]],state.functions,'functions');");
  app.nodes.get('#function-options').children[0].querySelector('input').handlers.change({target:{checked:true}});
  assert.equal(app.run('state.functions.has("Grain Grower")'), true);
  assert.equal(app.run('fitCalls'), 0);
  app.run('renderActiveFilters()');
  app.nodes.get('#active-filters').children[0].handlers.click();
  assert.equal(app.run('state.functions.size'), 0);
  assert.equal(app.run('fitCalls'), 0);
});

test('blur cancels delayed suggestion reopening and clear cancels pending input', () => {
  const app = boot();
  app.input('Boulder');
  app.nodes.get('#search-input').handlers.blur();
  app.flush();
  assert.equal(app.nodes.get('#search-suggestions').hidden, true);
  assert.equal(app.run('fitCalls'), 0);
});

test('empty area offers matching records elsewhere without discarding selected filters', () => {
  const app = boot();
  app.run("state.organizations=[{name:'Farm',state:'CO',functions:['Grain Grower'],grains:['Wheat'],searchText:'farm wheat',location:{lat:40,lng:-105}}]; state.functions.add('Grain Grower'); map={getBounds:()=>({contains:()=>false})}; renderViewportResults();");
  const empty = app.nodes.get('#results-list').children[0];
  assert.match(empty.innerHTML, /No matches in this area/);
  const elsewhere = empty.children.find(b => b.textContent === 'Show matches elsewhere');
  assert.ok(elsewhere);
  elsewhere.handlers.click();
  assert.equal(app.run('fitCalls'), 1);
  assert.equal(app.run('state.functions.has("Grain Grower")'), true);
});

test('exact grain names are not mistaken for cities, and apostrophes do not prevent name matches', () => {
  const app = boot();
  app.run("state.organizations=[{name:'Farm',city:'Rye',state:'NY',functions:[],grains:['Rye'],searchText:'farm rye',location:{lat:41,lng:-73,precision:'address'}}]; initializeSearch();");
  app.input('Rye'); app.flush();
  assert.equal(app.run('searchIntent().place'), null);
  app.input('Babettes'); app.flush();
  assert.equal(app.matches("Babette's Bakery"), true);
});

test('shared map views retain valid coordinates and reject malformed coordinates', () => {
  const app = boot();
  app.run('map={getCenter:()=>({lat:39.75,lng:-104.98}), getZoom:()=>10}; updateUrl(); parseUrlState();');
  assert.equal(app.run('state.initialView.join()'), '39.75,-104.98,10');
  for (const view of ['999,0,4', '0,0,99', 'bad,0,4', '0,0']) {
    app.setSearch(`?view=${view}`); app.run('parseUrlState()');
    assert.equal(app.run('state.initialView'), null);
  }
});

test('mobile results exclude map content concealed by the bottom sheet', () => {
  const app = boot();
  app.run("globalThis.L={latLngBounds:(a,b)=>({a,b})}; mobileSheet={inset:()=>300}; map={getSize:()=>({x:390,y:720}),containerPointToLatLng:p=>p,getBounds:()=>null};");
  assert.equal(app.run('visibleMapBounds().b.join()'), '390,420');
});

test('history restores search and filters rather than keeping the last overlay state', () => {
  const app = boot();
  app.input('bakery'); app.flush();
  app.setSearch('?q=rye&state=CO&functions=Grain%20Grower');
  app.window.handlers.popstate();
  assert.equal(app.value(), 'rye');
  assert.equal(app.run('state.stateCode'), 'CO');
  assert.equal(app.run('state.functions.has("Grain Grower")'), true);
});

test('explicit organization selection clears only conflicting filters and opens its profile', () => {
  const app = boot();
  app.run("showToast=message=>globalThis.notice=message; showDetails=o=>globalThis.openedName=o.name; state.stateCode='WA'; state.functions.add('Grain Grower'); state.grains.add('Wheat'); submitSearch({organization:{name:'Canyon Bakery',state:'CA',functions:['Retail Baked Goods'],grains:['Wheat']}});");
  assert.equal(app.run('state.stateCode'), '');
  assert.equal(app.run('state.functions.size'), 0);
  assert.equal(app.run('state.grains.has("Wheat")'), true);
  assert.equal(app.run('openedName'), 'Canyon Bakery');
  assert.match(app.run('notice'), /Conflicting filters cleared/);
});

test('a submitted place replaces old geographic restrictions but keeps functions and grains', () => {
  const app = boot();
  app.run("state.organizations=[{name:'Mill',state:'CO',city:'Denver',functions:['Wholesale Flour'],grains:['Wheat'],searchText:'mill wheat',location:{lat:39.7,lng:-105,precision:'address'}}]; initializeSearch(); fitPlace=p=>globalThis.framed=p.label; state.stateCode='WA'; state.radius='50'; state.functions.add('Wholesale Flour'); state.grains.add('Wheat');");
  app.input('wheat near Denver'); app.key('Enter');
  assert.equal(app.run('framed'), 'Denver, CO');
  assert.equal(app.run('state.stateCode'), '');
  assert.equal(app.run('state.radius'), '');
  assert.equal(app.run('state.functions.has("Wholesale Flour")'), true);
  assert.equal(app.run('state.grains.has("Wheat")'), true);
});
