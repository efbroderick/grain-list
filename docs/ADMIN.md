# Connected Admin

## What Is Implemented

The private admin reads the **Listings** tab in the current editable master:
[Grain List - Current Listings - 2026-10-26](https://docs.google.com/spreadsheets/d/1zhNRetv5gNYuaQtlZ8hxsW7GBdX7VpMbSN9boXkuYT8/edit).
This is the authoritative list. Do not use the older Publication Source Sheet.

- Add and edit organizations, Functions, Grains, contacts, and source URLs.
- Save durable drafts in the same spreadsheet's **Admin Drafts** tab.
- Find an address using the free Census geocoder, or place the map pin manually.
- Compare the proposed master-Sheet change and the change visitors will see.
- Explicitly confirm cleared fields and closures.
- Save approved changes to **Listings**, then request checked publication.
- Show saved, queued, validating, deploying, failed, and verified-live states.
- Retain before-values in **Admin Activity** and public changes in Git history.

The admin is a private Google Apps Script web app. `/admin/` on the public site
opens it after activation. Google sign-in and an explicit owner-email check
restrict all server calls. Nothing uses a shared password or a credential in
browser code. Public email suggestions remain unchanged.

## One-Time Activation

Google authorization and a publishing credential must be supplied by the owner.
The repository contains no credentials. Do not paste tokens into chat or commit
them. No LLM, Tavily, paid database, or paid email service is required. Apps Script
quotas apply. The GitHub workflow uses standard public-repository runners.

### 1. Open The Browser Editor

Use [Google Apps Script](https://script.google.com/home) in the account that owns
the current master Sheet. Create a project named **Grain List Admin**, or reopen
the existing project rather than creating another one. A standalone project is
supported: the server explicitly opens the current master by its ID.

Clasp is optional and not needed for this setup. Do not approve its broader
Google permissions just to install this admin.

### 2. Add The Checked-In Files

In the editor add or replace these files from `admin/apps-script/`:
`Code.gs`, `Domain.gs`, `Index.html`, `Client.html`, `Styles.html`, `Schema.html`.
For HTML files, enter the name without `.html` when Google prompts for it.

In **Project Settings**, enable **Show appsscript.json manifest file in editor**.
Replace that manifest with the checked-in `appsscript.json`. Save all files.
Do not run or authorize the script until the source and owner settings match.

The admin requests Google Sheets read/write access, the signed-in email, and
external HTTPS connections for GitHub, live publication checks, and address
lookup. Google's Sheets scope covers spreadsheets generally; application code
restricts writes to the configured master, but that is not an OAuth restriction.
It does not request Gmail, contacts, calendar, or the additional clasp scopes.

### 3. Set Two Private Script Properties

In the Apps Script editor, open **Project Settings > Script Properties**:

| Property | Value |
| --- | --- |
| `ADMIN_EMAIL` | The exact Google email used to deploy this private app |
| `GITHUB_TOKEN` | A fine-grained GitHub token limited to `efbroderick/grain-list`, with **Actions: Read and write** |

Create the token in GitHub **Settings > Developer settings > Personal access
tokens > Fine-grained tokens**. Select only the grain-list repository and set
an expiration. Metadata read access is automatic. Contents write access is not
needed for this token: the checked workflow has its own short-lived repository
token. Put the token only in the private Script Property.

Do not reuse the developer machine's broad GitHub credential for this purpose.

### 4. Deploy Privately

In Apps Script select **Deploy > New deployment > Web app**:

- **Execute as:** Me.
- **Who has access:** Only myself.
- Review and authorize the listed Google permissions.

Do not select Anyone. The manifest defaults to `MYSELF`, and the server also
checks `ADMIN_EMAIL` on every callable operation. If Google cannot identify the
active account, access is refused rather than granted.

Open the returned `/exec` URL. Click **Initialize Google Sheet connection** once
while you are not simultaneously sorting or editing the source Sheet. This
adds the private draft/activity tabs, fills missing IDs, binds existing listings
to their current public IDs, and retains map points only for matching source
addresses. It does not replace contacts, Functions, Grains, sources, or notes.
Ambiguous identities stop initialization instead of merging records.

If a custom Google Cloud project is attached, enable its Google Sheets API.
With the default Apps Script Cloud project, the included advanced Sheets service
enables the API. No service-account key is needed.

### 5. Connect The Site Entry

Share the non-secret deployed `/exec` URL with the maintainer, or run:

```bash
cd /Users/efb/Documents/grain-list
node tools/configure_admin_entry.cjs 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec'
make test validate build
```

Commit `config/admin.json` and push it to deploy the `/admin/` link. The private
app URL is not an access credential; Google still requires your account.

## Normal Use

1. Open `/admin/` and sign in with the deploying Google account.
2. Add an organization or open a source listing. Keep the complete Functions
   and Grains lists: these fields replace the prior lists after your review.
3. Confirm the map point and its precision; include supporting source URLs.
4. **Save draft** writes only Admin Drafts, not the published master record.
5. **Review changes** shows both master-Sheet and public-site differences.
6. **Save to Sheet & publish** saves Listings first and starts validation.
7. Check Activity. Only **Published** means the deployed record was read back
   and matched the approved change after a successful workflow.

A dispatch, test, or deployment failure leaves the Sheet save intact. Reopen
the retained draft to retry; never add the organization again. Concurrent draft
versions, changed source rows, and changed live listings require a fresh review.
Avoid editing the same record or rearranging source columns while saving it.
Row-level developer metadata follows records through normal row sorting.

## Sheet And Bulk-Import Compatibility

Keep Record ID and Public ID unchanged. Existing `grain-...` Record IDs in
Current Listings are already public identities and are never hashed again.
Website/Sources headers stay unchanged; the admin supports these native names.
Public ID explicitly binds the source
row to its existing public profile, including pre-existing identity exceptions.
The regular Python import respects this binding. Latitude, Longitude, Location
Precision, City, and Map Fingerprint carry confirmed locations into future bulk
exports without depending on a developer's private geocoding cache. Real address
or state changes invalidate the confirmation. Formatting-equivalent street
suffixes do not. Spreadsheet highlights are not interpreted by the admin;
use Operating status Closed for a deliberate removal.

Admin publication updates only the reviewed record, not unrelated unreviewed
Sheet edits. Continue using the reviewed bulk workflow for large Sheet changes.

## Maintenance And Recovery

- Renew the limited GitHub token in Script Properties before it expires.
- After code changes, run `make admin`, replace the changed files in the browser
  editor, then update the existing Apps Script deployment to a new version.
  Keep its URL. Clasp remains an optional alternative for experienced maintainers.
- Run `make test validate build` before releasing changes.
- Inspect Admin Activity's Previous Record before-values and Git history when
  correcting an erroneous publication. Restore both the source Sheet values and
  the public release; reverting Git alone does not revert the Sheet.
- Never deploy `admin/apps-script/` as static site assets. The public builder's
  explicit allowlist excludes server source, private snapshots, and credentials.
- No scheduled research, LLM extraction, or external paid lookups are enabled.

References: [Google web apps](https://developers.google.com/apps-script/guides/web),
[private access](https://developers.google.com/apps-script/manifest/web-app-api-executable),
[clasp](https://github.com/google/clasp),
[GitHub workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).
