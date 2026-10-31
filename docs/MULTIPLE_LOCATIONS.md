# Organizations and Locations

The master remains **Grain List - Current Listings - 2026-10-26**, spreadsheet
`1zhNRetv5gNYuaQtlZ8hxsW7GBdX7VpMbSN9boXkuYT8`. Listings holds shared organization
details; Locations holds linked branches. Never make another organization row for
a second branch of the same organization.

## Admin workflow

1. Open an organization in the private admin. Choose **Add location**.
2. Enter a branch name, type, address, state, contact details and supporting source.
3. Use **Find address**, check its map point and confirm its precision.
4. Save the draft, review changes, then **Save to Sheet & publish**.
5. Check Activity for the deployed outcome. A saved Sheet record is not necessarily
   published until validation and deployment finish.

All organization types can have multiple locations. Names are alphabetized. Close
an individual location using its status selector; its history stays in the Sheet.
Closing a branch does not close the organization. Closing the organization removes
all its public map pins.

Existing single-location records remain supported. The first admin save creates
their stable primary Location ID and corresponding Locations row. This is a lazy,
non-destructive migration: no bulk replacement of reviewed addresses or drafts.
The primary location's address/contact/map fields continue to be mirrored in
Listings for compatibility. Editing another branch does not overwrite those fields.

## Sheet columns

Locations uses these exact headers:

`Location ID`, `Organization Record ID`, `Organization Public ID`, `Location Name`,
`Type`, `Address`, `City`, `State`, `Phone`, `Email`, `URL`, `Function`, `Grains`,
`Source`, `Operational Status`, `Latitude`, `Longitude`, `Location Precision`,
`Map Fingerprint`.

Keep IDs unchanged. Use the admin for additions so IDs and map confirmation are
created safely. Direct Sheet edits invalidate open drafts, including edits made
only to Locations. Sorting either tab is supported through row metadata. Both
tabs' public values are written in a single Sheets values batch before publication.
Unfinished new-row identity placeholders have no name and are not published.

Functions and grains on the organization profile describe the organization as a
whole; they are not automatically copied into each branch's facts. Branch-specific
functions/grains can be maintained in Locations with supporting sources. Partner
shops, distributors and stockists are not owned branches.

Public links keep one named organization URL. `?location=loc-...` selects a branch
inside the profile overlay, including on refresh and share. Search groups branches
into one organization result, with distance based on its nearest matching active
branch and area filtering based on actual branch coordinates.

## Research organization

The private admin can fetch up to five pages on the supplied HTTPS website, with
same-site redirects only, size limits and a soft 60-second crawl budget. Individual
requests remain subject to Apps Script's platform timeout. Website failures do not
establish closure. Hostname checks reject private network addresses.

This first implementation uses direct website text and structured JSON-LD, the
approved grain vocabulary from the existing research/import work, and deterministic
function rules. It does **not** run the Python research service, Tavily or any LLM.
It uses no paid API credits. Unrendered JavaScript, PDFs, ambiguous addresses and
unstructured location layouts may require pasted text or manual entry.

Review findings alongside their exact evidence and source. Selected findings add
to the current draft only, never directly to the master or public website. Existing
contacts are not silently replaced; location map points require confirmation.
Evidence is retained privately with the admin draft. New branches do not inherit
grains or functions merely because another branch has them.

## Maintenance and deployment

Use the admin for publishing after organizations acquire linked locations. The
old Listings-only CSV publication command fails closed once branch data exists,
rather than silently erasing it. Read-only audits remain available.

For Apps Script deployment, update Domain.gs, Client.html, Index.html and Styles.html.
Use `node tools/build_admin_deployment.cjs` to produce a Code.gs bundle containing
Code.gs, Locations.gs and Research.gs for the existing seven-file Apps Script project.
Do not also add the two bundled modules as separate project files. Keep owner-only
access and the existing Script Properties unchanged.

Verification: `make test validate build PYTHON=/path/to/python`.
