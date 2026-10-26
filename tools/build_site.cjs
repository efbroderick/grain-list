const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { organizationPath, assignRoutes, routeRedirects } = require("./organization_routes.cjs");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_ORIGIN = "https://grain-list.vercel.app";
const PUBLIC_FIELDS = new Set(["id", "name", "category", "state", "city", "functions", "grains", "address", "phone", "email", "url", "status", "sources", "location"]);
const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ").sort();
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
function webUrl(value) {
  try { return ["https:", "http:"].includes(new URL(value).protocol) ? value : ""; }
  catch { return ""; }
}
function jsonScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
function page({ title, description, route, content, origin, script = "", structured = null, noindex = false }) {
  const canonical = new URL(route, origin).href;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#173c2a"><title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="canonical" href="${escape(canonical)}">
${noindex ? '<meta name="robots" content="noindex,follow">' : ""}
<meta property="og:type" content="website"><meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(canonical)}">
<meta property="og:image" content="${escape(new URL('/assets/app-icon-512.png', origin).href)}">
<link rel="icon" href="/assets/favicon.png"><link rel="apple-touch-icon" href="/assets/app-icon-180.png">
<link rel="stylesheet" href="/styles.css?v=20261025-outlines"><link rel="stylesheet" href="/pages.css?v=20261016">
${structured ? `<script type="application/ld+json">${jsonScript(structured)}</script>` : ""}
</head><body class="document-page">
<header class="page-topbar"><a class="brand" href="/" aria-label="Grain List home"><span class="brand-mark"><img src="/assets/brand-mark.png" alt=""></span><strong>Grain List</strong></a>
<nav aria-label="Main navigation"><a href="/">${icon("map")}<span>Explore map</span></a><a href="/organizations/">${icon("list")}<span>Directory</span></a><a href="/add/">${icon("plus")}<span>Add an organization</span></a></nav></header>
${content}
<footer class="page-footer"><a href="/">Grain List</a><a href="/add/">Suggest an addition or correction</a></footer>
<script src="https://unpkg.com/lucide@0.468.0/dist/umd/lucide.js"></script>
<script src="/site-config.js?v=20261007"></script><script src="/page.js?v=20261016" defer></script>${script}
</body></html>`;
}
function tags(values, grain = false) {
  return `<ul class="profile-tags${grain ? " profile-grains" : ""}">${values.map(value => `<li>${escape(value)}</li>`).join("")}</ul>`;
}
function profile(organization, origin, mapTemplate = "") {
  const o = organization;
  const route = organizationPath(o);
  const locality = [o.city, o.state].filter(Boolean).join(", ");
  const description = `${o.name}${locality ? ` in ${locality}` : ""}. ${o.functions.join(", ")}.${o.grains.length ? ` Grains: ${o.grains.join(", ")}.` : ""} Find contact details and sources on Grain List.`;
  const sourceLinks = o.sources.filter(webUrl).map((url, index) => `<li><a href="${escape(url)}" target="_blank" rel="noopener">${escape(new URL(url).hostname.replace(/^www\./, ""))}<span class="sr-only">, source ${index + 1}</span>${icon("external-link")}</a></li>`).join("");
  const mailing = /\bP\.?\s*O\.?\s*Box\b/i.test(o.address);
  const precision = o.location?.precision;
  const mapNote = precision === "state" ? "Approximate state location" : precision === "place" ? "Approximate city or region location" : precision === "organization" ? "Approximate organization location" : "";
  const contact = [o.address ? `<p>${escape(o.address)}</p>` : "", o.phone ? `<a href="tel:${escape(o.phone.replace(/[^\d+]/g, ""))}">${escape(o.phone)}</a>` : "", o.email ? `<a href="mailto:${escape(o.email)}">${escape(o.email)}</a>` : ""].join("");
  const content = `<main class="page-main profile-main">
<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/organizations/">Organizations</a><span aria-hidden="true">/</span><a href="/?state=${encodeURIComponent(o.state)}">${escape(o.state)}</a></nav>
<header class="profile-header"><p class="eyebrow">${escape([o.category, locality].filter(Boolean).join(" · "))}</p><h1>${escape(o.name)}</h1>
<div class="profile-actions">${o.url && webUrl(o.url) ? `<a class="button button-primary" href="${escape(o.url)}" target="_blank" rel="noopener">${icon("external-link")}Visit website</a>` : ""}
${o.location ? `<a class="button button-secondary" href="/?organization=${encodeURIComponent(o.id)}">${icon("map-pin")}Show on map</a>` : ""}
<button class="icon-button" id="share-listing" type="button" title="Share listing" aria-label="Share listing">${icon("share-2")}</button></div></header>
<div class="profile-layout"><div class="profile-primary">
<section class="profile-section"><h2>Functions</h2>${o.functions.length ? tags(o.functions) : '<p class="muted">Not yet recorded</p>'}</section>
<section class="profile-section"><h2>Grains</h2>${o.grains.length ? tags(o.grains, true) : '<p class="muted">Not yet recorded</p>'}</section>
${sourceLinks ? `<details class="profile-section profile-sources"><summary>Sources <span>${o.sources.length}</span>${icon("chevron-down")}</summary><ul>${sourceLinks}</ul></details>` : ""}</div>
<aside class="profile-contact"><section class="profile-section"><h2>Contact &amp; location</h2>${contact || '<p class="muted">No contact details recorded</p>'}${mailing ? '<p class="location-note">Mailing address, not a visitor address.</p>' : ""}${mapNote ? `<p class="location-note">${escape(mapNote)}</p>` : ""}</section>
<a class="correction-link" href="/add/?organization=${encodeURIComponent(o.id)}&amp;type=correction">${icon("message-square-plus")}Suggest an update</a></aside></div>
<p class="page-status" id="page-status" role="status"></p></main>`;
  const structured = {
    "@context": "https://schema.org", "@type": "Organization", name: o.name,
    url: webUrl(o.url) || new URL(route, origin).href,
    mainEntityOfPage: new URL(route, origin).href,
    ...(o.address ? { address: o.address } : {}), ...(o.phone ? { telephone: o.phone } : {}),
    ...(o.email ? { email: o.email } : {}),
  };
  const html = page({ title: `${o.name}${locality ? ` | ${locality}` : ""} | Grain List`, description, route, content, origin, structured });
  if (!mapTemplate) return html;
  // The initial HTML remains readable to crawlers and without JavaScript. The
  // same map app enhances it into the original overlay without changing its URL.
  const bodyStart = '<body class="document-page">';
  const [head, body] = html.split(bodyStart);
  const fallback = body.split("</body>")[0].replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  const mapBody = mapTemplate.split('<body data-mobile-view="map">')[1].split("</body>")[0].replaceAll('="./', '="/');
  const mapStyles = [...mapTemplate.matchAll(/<link\s[^>]*rel="stylesheet"[^>]*>/g)].map(match => match[0]).filter(link => !link.includes("styles.css")).join("\n");
  return `${head.replace("</head>", `${mapStyles}</head>`)}${bodyStart}<div id="static-profile-content">${fallback}</div><div id="map-app-shell" hidden>${mapBody}</div></body></html>`;
}
function directory(organizations, origin) {
  const groups = new Map();
  for (const o of organizations) {
    if (!groups.has(o.state)) groups.set(o.state, []);
    groups.get(o.state).push(o);
  }
  const states = [...groups.keys()].sort();
  const content = `<main class="page-main"><header class="profile-header"><p class="eyebrow">Grain List</p><h1>Organizations</h1><p>${organizations.length.toLocaleString()} organizations</p></header>
<nav class="state-index" aria-label="Browse by state">${states.map(state => `<a href="#${state}">${state}</a>`).join("")}</nav>
${states.map(state => `<section class="directory-state" id="${state}"><h2>${state}</h2><ul>${groups.get(state).sort((a, b) => a.name.localeCompare(b.name)).map(o => `<li><a href="${organizationPath(o)}">${escape(o.name)}</a><span>${escape(o.city || o.category)}</span></li>`).join("")}</ul></section>`).join("")}</main>`;
  return page({ title: "Organization Directory | Grain List", description: "Browse grain growers, millers, bakers, breweries, restaurants, and other grain organizations by state.", route: "/organizations/", content, origin });
}
function contribution(functions, origin) {
  const content = `<main class="page-main contribution-main"><header class="profile-header"><p class="eyebrow">Help grow Grain List</p><h1 id="contribution-title">Add an organization</h1><p>Know a farm growing grain or a business using local grain? Send a suggestion for review.</p></header>
<form id="listing-form"><div class="submission-grid">
<label><span>Suggestion type</span><select id="suggestion-type" name="type"><option value="addition">Add an organization</option><option value="correction">Correct a listing</option><option value="closure">Report a closure</option></select></label>
<label><span>Organization name</span><input id="organization-name" name="organization" autocomplete="organization" required maxlength="200"></label>
<label><span>Website or social profile</span><input id="organization-url" name="url" type="url" placeholder="https://" maxlength="1000"></label>
<label><span>State</span><select id="organization-state" name="state"><option value="">Select state</option>${STATES.map(state => `<option>${state}</option>`).join("")}</select></label>
<label class="wide"><span>City or address</span><input id="organization-address" name="address" autocomplete="street-address" maxlength="500"></label>
<fieldset class="wide function-choices"><legend>Functions <small>optional</small></legend><details><summary>Select functions</summary><div>${functions.map(value => `<label><input name="functions" type="checkbox" value="${escape(value)}"><span>${escape(value)}</span></label>`).join("")}</div></details></fieldset>
<label class="wide"><span>Grains used or grown <small>optional</small></span><input id="organization-grains" name="grains" placeholder="For example: Rye, Hard Red Winter Wheat" maxlength="1000"></label>
<label class="wide"><span>Local grain connection or requested changes</span><textarea id="organization-details" name="details" rows="5" required maxlength="5000"></textarea></label>
<label class="wide"><span>Supporting source <small>optional</small></span><input id="organization-source" name="source" type="url" placeholder="Link to a product, menu, farm, or contact page" maxlength="1000"></label>
<label><span>Your name <small>optional</small></span><input name="name" autocomplete="name" maxlength="200"></label><label><span>Your email <small>optional</small></span><input name="email" type="email" autocomplete="email" maxlength="254"></label>
</div><div class="submission-footer"><p>Suggestions are reviewed before publication. This creates a draft in your email app; you must send it to complete your suggestion.</p><div class="submission-actions"><button class="button button-primary" type="submit">${icon("mail")}Create email draft</button><button class="button button-secondary" id="copy-submission" type="button">${icon("copy")}Copy suggestion</button></div></div></form>
<section class="delivery-status" id="delivery-status" hidden aria-live="polite"><h2 id="delivery-heading"></h2><p id="delivery-message"></p><a id="delivery-email"></a><textarea id="delivery-draft" rows="10" readonly aria-label="Suggestion email text"></textarea></section>
<p class="page-status" id="page-status" role="status"></p><noscript><p>JavaScript is needed to prepare the email draft. You can send additions and corrections to <a href="mailto:hello@grain-list.aleeas.com">hello@grain-list.aleeas.com</a>.</p></noscript></main>`;
  return page({ title: "Add an Organization | Grain List", description: "Suggest a farm growing grain, a business using local grain, or a correction to an existing Grain List organization.", route: "/add/", content, origin, script: '<script src="/submission.js?v=20261019-__DATA_VERSION__" defer></script>', noindex: true });
}
function buildSite({ root = ROOT, output = path.join(root, "dist"), origin = DEFAULT_ORIGIN } = {}) {
  root = path.resolve(root);
  output = path.resolve(output);
  if (output === root || root.startsWith(output + path.sep)) throw new Error("Build output cannot replace the source directory");
  const url = new URL(origin);
  if (!["https:", "http:"].includes(url.protocol) || url.pathname !== "/" || url.search || url.hash) throw new Error("Site origin must be an HTTP(S) origin without a path");
  const dataText = fs.readFileSync(path.join(root, "data/organizations.json"), "utf8");
  const payload = JSON.parse(dataText);
  const dataVersion = createHash("sha256").update(dataText).digest("hex").slice(0, 16);
  const seen = new Set();
  for (const o of payload.organizations) {
    if (!/^grain-[a-f0-9]{16}$/.test(o.id) || seen.has(o.id)) throw new Error("Invalid or duplicate public organization ID");
    if (Object.keys(o).some(key => !PUBLIC_FIELDS.has(key))) throw new Error("Non-public organization fields in publication data");
    seen.add(o.id);
  }
  if (!seen.size) throw new Error("Cannot build an empty directory");
  const registry = JSON.parse(fs.readFileSync(path.join(root, "config/organization-routes.json"), "utf8"));
  const expected = assignRoutes(payload.organizations, registry);
  if (JSON.stringify(expected) !== JSON.stringify(registry)) throw new Error("Organization routes are stale. Run node tools/update_organization_routes.cjs before publishing.");
  const organizations = payload.organizations.map(o => ({ ...o, slug: registry.organizations[o.id].slug }));
  const redirects = routeRedirects(payload.organizations, registry);
  const deployment = JSON.parse(fs.readFileSync(path.join(root, "vercel.json")));
  if (redirects.some(redirect => !deployment.redirects?.some(item => item.source === redirect.source && item.destination === redirect.destination && item.permanent))) throw new Error("Organization redirects are stale. Run node tools/update_organization_routes.cjs before publishing.");
  const publicPayload = { ...payload, organizations };
  const functions = JSON.parse(fs.readFileSync(path.join(root, "config/functions.json"), "utf8")).allowed_functions;
  // Build in a fresh sibling directory so removed organizations cannot leave stale pages.
  const temporary = `${output}.tmp`;
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.mkdirSync(temporary, { recursive: true });
  const mapTemplate = fs.readFileSync(path.join(root, "index.html"), "utf8").replaceAll(DEFAULT_ORIGIN, url.origin).replaceAll("__DATA_VERSION__", dataVersion);
  for (const file of ["index.html", "app.js", "styles.css", "pages.css", "page.js", "submission.js", "install.js", "manifest.webmanifest", "site-config.js"]) {
    if (file === "index.html") fs.writeFileSync(path.join(temporary, file), mapTemplate);
    else if (["app.js", "submission.js"].includes(file)) fs.writeFileSync(path.join(temporary, file), fs.readFileSync(path.join(root, file), "utf8").replaceAll("__DATA_VERSION__", dataVersion));
    else fs.copyFileSync(path.join(root, file), path.join(temporary, file));
  }
  fs.cpSync(path.join(root, "assets"), path.join(temporary, "assets"), { recursive: true });
  fs.mkdirSync(path.join(temporary, "data"));
  fs.writeFileSync(path.join(temporary, "data/organizations.json"), JSON.stringify(publicPayload));
  function write(route, html) {
    const destination = path.join(temporary, route, "index.html");
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, html.replaceAll("__DATA_VERSION__", dataVersion));
  }
  for (const o of organizations) write(organizationPath(o), profile(o, origin, mapTemplate));
  for (const redirect of redirects) write(redirect.source, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${escape(redirect.destination)}"><link rel="canonical" href="${escape(new URL(redirect.destination, origin).href)}"><title>Listing moved | Grain List</title></head><body><a href="${escape(redirect.destination)}">Open organization</a></body></html>`);
  write("/organizations/", directory(organizations, origin));
  write("/add/", contribution(functions, origin));
  const routes = ["/", "/organizations/", ...organizations.map(organizationPath)];
  fs.writeFileSync(path.join(temporary, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map(route => `<url><loc>${escape(new URL(route, origin).href)}</loc></url>`).join("")}</urlset>`);
  fs.writeFileSync(path.join(temporary, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${new URL('/sitemap.xml', origin).href}\n`);
  fs.writeFileSync(path.join(temporary, "404.html"), page({ title: "Listing Not Found | Grain List", description: "This Grain List page is not available.", route: "/404", content: '<main class="page-main"><h1>Listing not found</h1><p>This listing may have been removed or its link is incorrect.</p><a class="button button-primary" href="/">Explore Grain List</a></main>', origin, noindex: true }));
  fs.rmSync(output, { recursive: true, force: true });
  fs.renameSync(temporary, output);
  return payload.organizations.length;
}
module.exports = { buildSite, profile, organizationPath, escape };
if (require.main === module) console.log(`Built ${buildSite({ origin: process.env.GRAIN_LIST_ORIGIN || DEFAULT_ORIGIN })} organization pages in dist/`);
