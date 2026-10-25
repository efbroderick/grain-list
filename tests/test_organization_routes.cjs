const test = require("node:test");
const assert = require("node:assert/strict");
const { slugify, assignRoutes, routeRedirects } = require("../tools/organization_routes.cjs");
const farm = { id: "grain-1234567890abcdef", name: "Aspen Moon Farm", city: "Longmont", state: "CO" };

test("names become readable, ASCII-safe slugs", () => {
  assert.equal(slugify("Babette's Bakery"), "babettes-bakery");
  assert.equal(slugify("A&J King Bakery"), "a-and-j-king-bakery");
  assert.equal(slugify("Café / Mill"), "cafe-mill");
});
test("renames keep prior named URLs and opaque ID links as redirects", () => {
  const first = assignRoutes([farm]);
  const renamed = { ...farm, name: "Aspen Moon Farm & Mill" };
  const second = assignRoutes([renamed], first);
  assert.equal(second.organizations[farm.id].slug, "aspen-moon-farm-and-mill");
  assert.deepEqual(second.organizations[farm.id].aliases, ["aspen-moon-farm"]);
  const redirects = routeRedirects([renamed], second);
  assert.ok(redirects.some(r => r.source === `/organizations/${farm.id}/` && r.permanent));
  assert.ok(redirects.some(r => r.source === "/organizations/aspen-moon-farm/" && r.destination === "/organizations/aspen-moon-farm-and-mill/"));
  assert.deepEqual(assignRoutes([renamed], second), second);
});
test("duplicate names get location suffixes and remain deterministic", () => {
  const other = { ...farm, id: "grain-abcdef1234567890", city: "Madison", state: "WI" };
  const registry = assignRoutes([farm, other]);
  assert.equal(registry.organizations[farm.id].slug, "aspen-moon-farm-longmont-co");
  assert.equal(registry.organizations[other.id].slug, "aspen-moon-farm-madison-wi");
  assert.deepEqual(assignRoutes([other, farm]), registry);
});
test("retired organization paths are never assigned to another organization", () => {
  const first = assignRoutes([farm]);
  const replacement = { ...farm, id: "grain-fedcba0987654321" };
  const next = assignRoutes([replacement], first);
  assert.notEqual(next.organizations[replacement.id].slug, "aspen-moon-farm");
  assert.equal(routeRedirects([], next).length, 0);
});
