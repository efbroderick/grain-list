const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { buildSite, profile, organizationPath } = require("../tools/build_site.cjs");
const root = path.join(__dirname, "..");
const origin = "https://grain-list.vercel.app";
const data = JSON.parse(fs.readFileSync(path.join(root, "data/organizations.json")));
const sample = data.organizations.find(o => o.name === "40 Century Grain");

test("every public organization has an HTML page and a crawlable directory/sitemap link", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "grain-list-build-test-"));
  try {
    const output = path.join(temporary, "dist");
    assert.equal(buildSite({ root, output, origin }), data.organizations.length);
    const directory = fs.readFileSync(path.join(output, "organizations/index.html"), "utf8");
    const sitemap = fs.readFileSync(path.join(output, "sitemap.xml"), "utf8");
    for (const organization of data.organizations) {
      const route = organizationPath(organization);
      const html = fs.readFileSync(path.join(output, route, "index.html"), "utf8");
      assert.ok(html.includes("<h1>"));
      assert.ok(html.includes(`rel="canonical" href="${origin}${route}"`));
      assert.ok(directory.includes(`href="${route}"`));
      assert.ok(sitemap.includes(`<loc>${origin}${route}</loc>`));
    }
    assert.equal(fs.existsSync(path.join(output, "data/publication_list.csv")), false);
    assert.equal(fs.existsSync(path.join(output, ".maintenance")), false);
    assert.equal(fs.existsSync(path.join(output, "tools")), false);
    assert.equal(fs.existsSync(path.join(output, "config")), false);
    assert.ok(fs.readFileSync(path.join(output, "robots.txt"), "utf8").includes(`${origin}/sitemap.xml`));
    assert.ok(fs.readFileSync(path.join(output, "404.html"), "utf8").includes("noindex,follow"));
    const stale = path.join(output, "organizations/grain-0000000000000000");
    fs.mkdirSync(stale);
    fs.writeFileSync(path.join(stale, "index.html"), "stale listing");
    buildSite({ root, output, origin });
    assert.equal(fs.existsSync(stale), false);
    buildSite({ root, output, origin: "https://directory.example.org" });
    assert.ok(fs.readFileSync(path.join(output, "index.html"), "utf8").includes('href="https://directory.example.org/"'));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test("profile content and JSON-LD are escaped; approximate coordinates are not advertised as exact", () => {
  const organization = { ...sample, name: 'A & B </script><script>alert("x")</script>', url: "javascript:alert(1)", sources: ["javascript:alert(1)", "https://example.org/contact?a=1&b=2"] };
  const html = profile(organization, origin);
  assert.equal(html.includes('<script>alert("x")</script>'), false);
  assert.equal(html.includes('href="javascript:'), false);
  assert.ok(html.includes("A &amp; B &lt;/script&gt;"));
  const structured = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(structured.name, organization.name);
  assert.equal(structured.geo, undefined);
  assert.ok(html.includes("Mailing address, not a visitor address."));
  assert.ok(html.includes("Approximate city or region location"));
  assert.ok(html.includes('<details class="profile-section profile-sources">'));
});

test("renaming an organization does not change its permanent URL", () => {
  assert.equal(organizationPath(sample), organizationPath({ ...sample, name: "New name" }));
});

test("builder refuses empty data, private fields, duplicate IDs and unsafe ID paths", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "grain-list-invalid-build-"));
  try {
    fs.mkdirSync(path.join(temporary, "data"));
    for (const organizations of [[], [{ ...sample, notes: "private" }], [sample, sample], [{ ...sample, id: "../../secret" }]]) {
      fs.writeFileSync(path.join(temporary, "data/organizations.json"), JSON.stringify({ organizations }));
      assert.throws(() => buildSite({ root: temporary }));
    }
    assert.throws(() => buildSite({ root, output: root }), /source directory/);
    assert.throws(() => buildSite({ root, origin: "javascript:alert(1)" }));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
