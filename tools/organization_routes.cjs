const slugify = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const organizationPath = organization => `/organizations/${organization.slug || slugify(organization.name) || organization.id}/`;

function assignRoutes(organizations, registry = { version: 1, organizations: {} }) {
  const result = JSON.parse(JSON.stringify(registry));
  result.version = 1;
  result.organizations ||= {};
  const reserved = new Map();
  for (const [id, record] of Object.entries(result.organizations)) {
    for (const slug of [record.slug, ...(record.aliases || [])]) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`Unsafe organization slug: ${slug}`);
      if (reserved.has(slug) && reserved.get(slug) !== id) throw new Error(`Route belongs to two organizations: ${slug}`);
      reserved.set(slug, id);
    }
  }
  const groups = new Map();
  for (const organization of organizations) {
    const base = slugify(organization.name) || `organization-${organization.id.slice(-8)}`;
    groups.set(base, (groups.get(base) || 0) + 1);
  }
  for (const organization of [...organizations].sort((a, b) => a.id.localeCompare(b.id))) {
    const { id } = organization;
    const base = slugify(organization.name) || `organization-${id.slice(-8)}`;
    const place = slugify([organization.city, organization.state].filter(Boolean).join(" "));
    let slug = groups.get(base) > 1 ? `${base}-${place || id.slice(-8)}` : base;
    if (reserved.has(slug) && reserved.get(slug) !== id) slug = `${base}-${place || id.slice(-8)}`;
    if (reserved.has(slug) && reserved.get(slug) !== id) slug = `${slug}-${id.slice(-8)}`;
    if (reserved.has(slug) && reserved.get(slug) !== id) throw new Error(`Cannot allocate route for ${id}`);
    const old = result.organizations[id];
    const aliases = new Set(old?.aliases || []);
    if (old?.slug && old.slug !== slug) aliases.add(old.slug);
    aliases.delete(slug);
    result.organizations[id] = { slug, aliases: [...aliases].sort() };
    reserved.set(slug, id);
  }
  return result;
}

function routeRedirects(organizations, registry) {
  const redirects = [];
  for (const organization of organizations) {
    const record = registry.organizations[organization.id];
    const destination = organizationPath({ ...organization, slug: record.slug });
    for (const alias of [organization.id, ...record.aliases]) {
      const source = `/organizations/${alias}/`;
      if (source !== destination) redirects.push({ source, destination, permanent: true });
    }
  }
  return redirects.sort((a, b) => a.source.localeCompare(b.source));
}
module.exports = { slugify, organizationPath, assignRoutes, routeRedirects };
