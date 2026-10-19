# Organization Pages And Suggestions

Every published organization has a stable URL:
`/organizations/<public-id>/`. Names can change without breaking links. Clicking
a map marker or result opens this page. Show on map opens the exact public ID,
not a potentially ambiguous name search. The selected organization can be
cleared with its active-filter chip; typing a new search also clears it.

## Publishing

`node tools/build_site.cjs` builds `dist/` from the approved public JSON. This
generates all organization pages, a state directory, a sitemap, robots.txt,
the suggestion form, and a genuine 404 page. Only explicitly listed public
assets are copied. The private publication CSV and maintenance reports are
not deployed. `dist/` is generated and ignored by Git.

Vercel runs this build automatically on every deployment. A normal reviewed
data refresh therefore regenerates all profile pages without another manual
step. Removed listings do not leave stale pages behind. Do not add a catch-all
rewrite to index.html: unknown profile URLs must return HTTP 404.

The default canonical origin is https://grain-list.vercel.app. Set the
`GRAIN_LIST_ORIGIN` build environment variable when adopting a custom domain.
It must contain only the origin, without a path. Verify sitemap.xml after any
domain change. Search-engine indexing is not immediate or guaranteed; the
owner can submit `/sitemap.xml` through their Google Search Console account.

Profiles contain names, contacts, Functions, Grains, citations, descriptive
titles and Organization JSON-LD in their initial HTML. Approximate coordinates
are not emitted as exact business coordinates in structured data. Mailing PO
Boxes are labeled and are not presented as visitor addresses. Blank grain fields
say Not yet recorded rather than implying an organization does not use grain.

## Public Suggestions

The Add organization action opens `/add/`. Suggest an update on a profile opens
the same form with the organization and suggestion type selected. Functions,
grains, location, the local grain connection, and a supporting source can be
included. Suggested changes never directly modify the Sheet or published data.

Create email draft uses the visitor's email app and the alias in site-config.js.
The visitor must send the email. No email provider, paid API, submission database
or server-side delivery is configured. The form does not falsely confirm that
an email was delivered. Copy suggestion and a selectable full-text fallback
work when mailto or clipboard access is unavailable. Long drafts use the full
copyable fallback instead of oversized mailto URLs. No suggestions are saved in
browser storage by Grain List.

Review incoming emails, verify supporting sources, apply accepted changes to
the publication Google Sheet, and use REVIEW_WORKFLOW.md to publish. Keep Record
IDs unchanged, including when outreach corrects an organization's name.

## Map Styling

The Atlas split layout uses a terrain basemap with a Light option in Leaflet's
layer control. Both use the existing public Esri raster infrastructure without
an API key. Terrain falls back to Light after repeated tile failures. Required
source attribution remains visible. The World Topo service is legacy/mature
support; its cartography may not reflect current roads or buildings. Organization
coordinates and evidence remain separate from the basemap. Revisit a maintained
tile provider before relying on the site for navigation or scaling traffic.

## Checks

Run `make test validate build` before release and `make serve` to preview `dist/`.
Tests cover static page generation and privacy, stable URLs, source escaping,
stale-page removal, exact-ID map links, email drafts and fallback behavior,
prefill races, and existing search/home-screen behavior. Browser checks must
also cover phone and desktop map/profile/form navigation and actual tile loads.
