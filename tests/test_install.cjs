const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");

function boot({ ua = "Android Chrome", platform = "Linux", touch = 1, standalone = false, iosStandalone = false } = {}) {
  const nodes = new Map();
  function node() {
    return { hidden: false, disabled: false, textContent: "", open: false, children: [], handlers: {},
      addEventListener(event, handler) { this.handlers[event] = handler; },
      replaceChildren(...children) { this.children = children; },
      showModal() { this.open = true; }, close() { this.open = false; },
      getBoundingClientRect() { return { left: 10, right: 300, top: 10, bottom: 500 }; },
    };
  }
  const document = { querySelector(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node };
  const media = { matches: standalone, addEventListener(event, handler) { this.handler = handler; } };
  const handlers = {};
  const window = { matchMedia: () => media, addEventListener(event, handler) { handlers[event] = handler; } };
  vm.runInNewContext(fs.readFileSync(path.join(root, "install.js"), "utf8"), {
    document, window, navigator: { userAgent: ua, platform, maxTouchPoints: touch, standalone: iosStandalone },
  });
  return { nodes, handlers, media, click(id) { return nodes.get(id).handlers.click({ target: nodes.get(id) }); } };
}

function offer(context, outcome = "accepted", prompt = async () => {}) {
  let prevented = false;
  context.handlers.beforeinstallprompt({ preventDefault() { prevented = true; }, prompt, userChoice: Promise.resolve({ outcome }) });
  assert.equal(prevented, true);
}

test("iPhone has Share instructions without pretending to install", () => {
  const app = boot({ ua: "iPhone Safari" });
  app.click("#install-button");
  assert.equal(app.nodes.get("#install-dialog").open, true);
  assert.equal(app.nodes.get("#native-install").hidden, true);
  assert.match(app.nodes.get("#install-steps").children.map(x => x.textContent).join(" "), /Share.*Add to Home Screen/);
});

test("desktop-mode iPad is recognized", () => {
  const app = boot({ ua: "Macintosh Safari", platform: "MacIntel", touch: 5 });
  assert.equal(app.nodes.get("#install-button").hidden, false);
  assert.match(app.nodes.get("#install-intro").textContent, /iPad/);
});

test("Android falls back to browser-menu instructions", () => {
  const app = boot();
  assert.equal(app.nodes.get("#install-button").hidden, false);
  assert.match(app.nodes.get("#install-steps").children.map(x => x.textContent).join(" "), /browser menu/);
});

test("accepted native prompt runs once and hides install control", async () => {
  const app = boot();
  let calls = 0;
  offer(app, "accepted", async () => { calls++; });
  app.click("#install-button");
  assert.equal(app.nodes.get("#native-install").hidden, false);
  await app.click("#native-install");
  await app.click("#native-install");
  assert.equal(calls, 1);
  assert.equal(app.nodes.get("#install-button").hidden, true);
  assert.equal(app.nodes.get("#install-dialog").open, false);
});

test("dismissal allows manual installation or a fresh native prompt", async () => {
  const app = boot();
  offer(app, "dismissed");
  await app.click("#native-install");
  assert.equal(app.nodes.get("#install-button").hidden, false);
  assert.equal(app.nodes.get("#native-install").hidden, true);
  assert.match(app.nodes.get("#install-status").textContent, /canceled/);
  offer(app);
  assert.equal(app.nodes.get("#native-install").hidden, false);
});

test("failed prompt gives a fallback without crashing", async () => {
  const app = boot();
  offer(app, "accepted", async () => { throw new Error("blocked"); });
  await app.click("#native-install");
  assert.equal(app.nodes.get("#native-install").disabled, false);
  assert.match(app.nodes.get("#install-status").textContent, /browser menu/);
});

test("installed app hides installation UI and responds to display changes", () => {
  const app = boot({ standalone: true });
  assert.equal(app.nodes.get("#install-button").hidden, true);
  const ios = boot({ iosStandalone: true, ua: "iPhone Safari" });
  assert.equal(ios.nodes.get("#install-button").hidden, true);
  const fresh = boot();
  fresh.click("#install-button");
  fresh.media.matches = true;
  fresh.media.handler();
  assert.equal(fresh.nodes.get("#install-dialog").open, false);
});

test("appinstalled closes the dialog", () => {
  const app = boot();
  app.click("#install-button");
  app.handlers.appinstalled();
  assert.equal(app.nodes.get("#install-button").hidden, true);
  assert.equal(app.nodes.get("#install-dialog").open, false);
});

test("desktop control is shown only when native installation is available", () => {
  const app = boot({ ua: "Desktop Chrome", platform: "MacIntel", touch: 0 });
  assert.equal(app.nodes.get("#install-button").hidden, true);
  offer(app);
  assert.equal(app.nodes.get("#install-button").hidden, false);
});

test("manifest and linked PNG icons have required sizes", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(x => x.sizes === `${size}x${size}` && x.purpose === "any");
    assert.ok(icon);
    const png = fs.readFileSync(path.join(root, icon.src));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  assert.ok(manifest.icons.some(x => x.purpose === "maskable"));
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /rel="manifest"/);
  assert.match(html, /src="\.\/install\.js/);
});
