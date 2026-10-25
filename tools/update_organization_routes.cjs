const fs = require("node:fs");
const path = require("node:path");
const { assignRoutes, routeRedirects } = require("./organization_routes.cjs");

function updateRoutes(root, previousData) {
  const registryFile = path.join(root, "config/organization-routes.json");
  let registry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile)) : undefined;
  if (previousData) registry = assignRoutes(previousData.organizations, registry);
  const payload = JSON.parse(fs.readFileSync(path.join(root, "data/organizations.json")));
  registry = assignRoutes(payload.organizations, registry);
  const redirects = routeRedirects(payload.organizations, registry);
  const configFile = path.join(root, "vercel.json");
  const config = JSON.parse(fs.readFileSync(configFile));
  const owned = new Set();
  for (const [id, record] of Object.entries(registry.organizations)) {
    for (const slug of [id, record.slug, ...record.aliases]) owned.add(`/organizations/${slug}/`);
  }
  config.redirects = [...(config.redirects || []).filter(item => !owned.has(item.source)), ...redirects];
  fs.writeFileSync(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  return { organizations: payload.organizations.length, redirects: redirects.length };
}
module.exports = { updateRoutes };
if (require.main === module) {
  const previous = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2])) : undefined;
  console.log(JSON.stringify(updateRoutes(path.resolve(__dirname, ".."), previous)));
}
