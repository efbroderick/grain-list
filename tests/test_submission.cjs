const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "submission.js"), "utf8");
function boot({ valid = true, email = "hello@grain-list.aleeas.com", search = "", fetchResult, copyFails = false } = {}) {
  const nodes = new Map();
  const data = new Map([["organization", "Example Farm"], ["details", "We grow locally milled rye."], ["functions", ["Grain Grower", "Retail Flour"]], ["grains", "Rye"]]);
  function node(id) {
    return { id: id.slice(1), value: id === "#suggestion-type" ? "addition" : "", hidden: true, textContent: "", handlers: {},
      addEventListener(event, handler) { this.handlers[event] = handler; },
      reportValidity() { return valid; }, querySelectorAll() { return [...nodes.values()]; },
      focus() { this.focused = true; }, select() { this.selected = true; },
    };
  }
  for (const id of ["#listing-form", "#suggestion-type", "#contribution-title", "#page-status", "#copy-submission", "#delivery-status", "#delivery-heading", "#delivery-message", "#delivery-email", "#delivery-draft", "#organization-name", "#organization-url", "#organization-state", "#organization-address"]) nodes.set(id, node(id));
  const window = { location: { search, origin: "https://grain-list.vercel.app", href: "https://grain-list.vercel.app/add/" }, GRAIN_LIST_CONFIG: { contactEmail: email } };
  let copied = "";
  class FormData {
    get(key) { return data.get(key) || ""; }
    getAll(key) { return data.get(key) || []; }
  }
  vm.runInNewContext(source, {
    document: { querySelector: id => nodes.get(id) }, window, URLSearchParams, FormData,
    navigator: { clipboard: { async writeText(value) { if (copyFails) throw Error("blocked"); copied = value; } } },
    fetch: () => fetchResult,
  });
  return { nodes, data, window, copied: () => copied, submit: () => nodes.get("#listing-form").handlers.submit({ preventDefault() {} }), copy: () => nodes.get("#copy-submission").handlers.click() };
}
test("valid suggestions open a sourced, structured email draft without claiming delivery", () => {
  const app = boot(); app.submit();
  assert.ok(app.window.location.href.startsWith("mailto:hello@grain-list.aleeas.com?"));
  const url = new URL(app.window.location.href);
  assert.match(url.searchParams.get("body"), /Functions: Grain Grower, Retail Flour/);
  assert.match(url.searchParams.get("body"), /Grains: Rye/);
  assert.match(app.nodes.get("#delivery-message").textContent, /Nothing has been sent/);
});
test("invalid or whitespace-only forms never open an email draft", () => {
  const app = boot({ valid: false }); app.submit(); assert.ok(app.window.location.href.startsWith("https:"));
  const blank = boot(); blank.data.set("organization", "  "); blank.submit(); assert.ok(blank.window.location.href.startsWith("https:"));
});
test("missing configuration prevents draft creation", () => {
  const app = boot({ email: "" }); app.submit(); assert.match(app.nodes.get("#page-status").textContent, /unavailable/);
});
test("oversized suggestions retain the full text without navigating to an unreliable mailto link", () => {
  const app = boot(); app.data.set("details", "x".repeat(5000)); app.submit();
  assert.ok(app.window.location.href.startsWith("https:"));
  assert.ok(app.nodes.get("#delivery-draft").value.includes("x".repeat(5000)));
  assert.match(app.nodes.get("#delivery-message").textContent, /too long/);
});
test("copy fallback works and blocked clipboard access exposes selectable text", async () => {
  const app = boot(); await app.copy(); assert.match(app.copied(), /Example Farm/);
  const blocked = boot({ copyFails: true }); await blocked.copy();
  assert.equal(blocked.nodes.get("#delivery-draft").selected, true);
});
test("correction prefilling never overwrites typing that happens while data is loading", async () => {
  let resolve;
  const loading = new Promise(done => { resolve = done; });
  const app = boot({ search: "?organization=grain-1234567890abcdef&type=correction", fetchResult: loading });
  const name = app.nodes.get("#organization-name");
  name.value = ""; name.handlers.input();
  resolve({ ok: true, json: async () => ({ organizations: [{ id: "grain-1234567890abcdef", name: "Original Farm", state: "CO" }] }) });
  await new Promise(done => setImmediate(done));
  assert.equal(name.value, "");
  assert.equal(app.nodes.get("#organization-state").value, "CO");
  assert.equal(app.nodes.get("#suggestion-type").value, "correction");
});
