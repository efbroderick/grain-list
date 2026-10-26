const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function fixture(options = {}) {
  const events = {};
  const timers = new Set();
  const layers = new Set();
  const container = { dataset: {} };
  const pane = { style: {} };
  const fallback = { addTo(map) { layers.add(this); return this; } };
  const gl = { once(name, fn) { events[name] = fn; }, on(name, fn) { events[name] = fn; }, isStyleLoaded() { return options.loaded !== false; } };
  const vector = { addTo() { layers.add(this); return this; }, getMaplibreMap() { return gl; } };
  const map = { getContainer: () => container, createPane: () => pane,
    hasLayer: (layer) => layers.has(layer), removeLayer: (layer) => layers.delete(layer),
    once(name, fn) { events[name] = fn; } };
  const root = {
    maplibregl: { supported: () => options.supported !== false },
    L: { maplibreGL: () => vector },
    fetch: options.fetch || (async () => ({ ok: true, json: async () => ({ layers: [] }) })),
    setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../basemap.js"), "utf8"), { window: root, AbortController });
  return { ...root.GrainListBasemap, root, map, fallback, vector, layers, events, timers, container, pane };
}

test("raster stays visible until the vector map is rendered", async () => {
  const f = fixture();
  await f.addTo(f.map, f.fallback);
  assert.ok(f.layers.has(f.fallback));
  assert.equal(f.pane.style.opacity, "0");
  f.events.idle();
  assert.equal(f.container.dataset.basemap, "vector");
  assert.equal(f.layers.has(f.fallback), false);
  assert.equal(f.pane.style.opacity, "1");
  assert.equal(f.timers.size, 0);
});

test("unsupported WebGL or missing adapter keeps the raster map", async () => {
  for (const missingAdapter of [false, true]) {
    const f = fixture({ supported: missingAdapter });
    if (missingAdapter) delete f.root.L.maplibreGL;
    await f.addTo(f.map, f.fallback);
    assert.ok(f.layers.has(f.fallback));
    assert.equal(f.timers.size, 0);
  }
});

test("the pinned MapLibre build does not need a supported helper export", async () => {
  const f = fixture();
  delete f.root.maplibregl.supported;
  await f.addTo(f.map, f.fallback);
  f.events.idle();
  assert.equal(f.container.dataset.basemap, "vector");
});

test("missing SDK and WebGL initialization errors keep the directory usable", async () => {
  const missing = fixture();
  delete missing.root.maplibregl;
  await missing.addTo(missing.map, missing.fallback);
  assert.ok(missing.layers.has(missing.fallback));
  const failed = fixture();
  failed.root.L.maplibreGL = () => { throw new Error("WebGL unavailable"); };
  await failed.addTo(failed.map, failed.fallback);
  assert.ok(failed.layers.has(failed.fallback));
  assert.equal(failed.timers.size, 0);
});

test("failed style request falls back without rejecting directory startup", async () => {
  const f = fixture({ fetch: async () => { throw new Error("offline"); } });
  await f.addTo(f.map, f.fallback);
  assert.ok(f.layers.has(f.fallback));
  assert.equal(f.timers.size, 0);
});

test("slow vector initialization times out and ignores late rendering", async () => {
  const f = fixture();
  await f.addTo(f.map, f.fallback);
  [...f.timers][0]();
  f.events.idle();
  assert.equal(f.container.dataset.basemap, "raster");
  assert.equal(f.layers.has(f.vector), false);
  assert.ok(f.layers.has(f.fallback));
});

test("context loss restores raster; isolated tile errors do not", async () => {
  const f = fixture();
  await f.addTo(f.map, f.fallback);
  f.events.idle();
  f.events.error();
  assert.equal(f.container.dataset.basemap, "vector");
  f.events.webglcontextlost();
  assert.equal(f.container.dataset.basemap, "raster");
  assert.ok(f.layers.has(f.fallback));
});

test("approved quiet colors retain street detail and use sans-serif labels", () => {
  const f = fixture();
  const style = f.quietStyle({ layers: [
    { id: "background", paint: {} }, { id: "water", paint: {} },
    { id: "park", paint: {} }, { id: "label_country_1", paint: {}, layout: {} },
    { id: "road", paint: { "line-color": "#fff" } },
  ] });
  assert.equal(style.layers[0].paint["background-color"], "#efefef");
  assert.equal(style.layers[1].paint["fill-color"], "#cfd0d3");
  assert.equal(style.layers[3].layout["text-font"][0], "Noto Sans Regular");
  assert.equal(style.layers[4].paint["line-color"], "#fff");
});
