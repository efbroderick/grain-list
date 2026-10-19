# Organization Pages And Suggestions

Every published organization has a stable URL:
`/organizations/<public-id>/`. Names can change without breaking links. Clicking
a map marker or result opens the original profile overlay above the map and
updates the address bar to this URL. Direct links open the same map overlay.
Back closes it, Forward reopens it, and a refresh preserves the listing.
Show on map closes the profile and focuses the exact public ID.

## Publishing

`node tools/build_site.cjs` builds `dist/` from the approved public JSON. This
generates all organization pages, a state directory, a sitemap, robots.txt,
the suggestion form, and a genuine 404 page. Only explicitly listed public
assets are copied. The private publication CSV and maintenance reports are
not deployed. `dist/` is generated and ignored by Git.

Vercel runs this build automatically on every deployment. A normal reviewed
data refresh therefore regenerates all profile pages without another manual
step. Dataset requests and the app entry script include a content-hash version,
so browser/CDN caches cannot retain an earlier release's taxonomy or contacts.
Removed listings do not leave stale pages behind. Do not add a catch-all
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

## Map Behavior And Design Approval

Use the original light-gray map and sans-serif typography. Numbered clusters
have one color and indicate counts only. Individual dot colors correspond to
the organization groups in the map key. Sidebar results automatically follow
the visible map bounds; moving the map does not remove offscreen markers from
the underlying layer. Distance controls appear only after Near me succeeds.
There is no verified-only filter.

Do not implement or deploy a new visual direction without showing mockups and
obtaining explicit user approval. Permission to continue unrelated work is not
approval of a redesign.

## Taxonomy

Retail Grain / Retail Whole Grains normalize to Retail Whole Grain; wholesale
aliases normalize to Wholesale Whole Grain. Values are deduplicated and sorted.
Chickpeas, lentils, and soybeans are legumes, not grain choices, and are excluded
from Grains. Normalization runs during source import and dataset generation;
public validation rejects non-grains and unsupported/duplicate functions.
The offline `tools/clean_public_taxonomy.py` utility applies these approved
changes to an existing local CSV and public JSON without changing coordinates
or IDs and writes a local change report. It does not edit the Google Sheet.

## Checks

Run `make test validate build` before release and `make serve` to preview `dist/`.
Tests cover static page generation and privacy, stable URLs, source escaping,
stale-page removal, exact-ID map links, email drafts and fallback behavior,
prefill races, and existing search/home-screen behavior. Browser checks must
also cover phone and desktop map/profile/form navigation and actual tile loads.
