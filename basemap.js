(function (root) {
  const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

  function quietStyle(style) {
    for (const layer of style.layers) {
      if (layer.id === "background") layer.paint["background-color"] = "#efefef";
      if (layer.id === "water") layer.paint["fill-color"] = "#cfd0d3";
      if (["park", "landcover_wood", "landuse_residential"].includes(layer.id)) {
        layer.paint["fill-color"] = "#e3e8e3";
        layer.paint["fill-opacity"] = ["interpolate", ["linear"], ["zoom"], 7, 0, 11, 0.55];
      }
      if (layer.id.startsWith("label_country")) {
        layer.layout["text-font"] = ["Noto Sans Regular"];
        layer.layout["text-size"] = 12;
        layer.layout["text-letter-spacing"] = 0;
        layer.paint["text-color"] = "#7e8380";
      }
    }
    return style;
  }

  async function addTo(map, fallback) {
    const container = map.getContainer();
    container.dataset.basemap = "raster";
    fallback.addTo(map);
    if (!root.maplibregl || !root.L.maplibreGL) return;
    if (typeof root.maplibregl.supported === "function" && !root.maplibregl.supported()) return;

    const abort = new AbortController();
    let layer;
    let gl;
    let failed = false;
    let timer;
    const restore = () => {
      if (failed) return;
      failed = true;
      root.clearTimeout(timer);
      abort.abort();
      // Keep listings usable even if the vector provider or WebGL fails.
      fallback.addTo(map);
      container.dataset.basemap = "raster";
      if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    };
    timer = root.setTimeout(restore, 10000);

    try {
      const response = await root.fetch(STYLE_URL, { signal: abort.signal });
      if (!response.ok) throw new Error("Map style unavailable");
      const style = quietStyle(await response.json());
      if (failed) return;
      const pane = map.createPane("vectorBasemap");
      pane.style.zIndex = "250";
      pane.style.pointerEvents = "none";
      pane.style.opacity = "0";
      layer = root.L.maplibreGL({
        style,
        pane: "vectorBasemap",
        attribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      gl = layer.getMaplibreMap();
      gl.once("idle", () => {
        if (failed) return;
        root.clearTimeout(timer);
        pane.style.opacity = "1";
        map.removeLayer(fallback);
        container.dataset.basemap = "vector";
      });
      gl.on("webglcontextlost", restore);
      gl.on("error", () => {
        // A single missing tile should not discard an otherwise loaded map.
        if (!gl.isStyleLoaded()) restore();
      });
      map.once("unload", () => {
        failed = true;
        root.clearTimeout(timer);
        abort.abort();
      });
    } catch (_) {
      restore();
    }
  }

  root.GrainListBasemap = { addTo, quietStyle };
})(window);
