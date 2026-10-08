# Review and Maintain Grain List

Use the editable [publication Google Sheet](https://docs.google.com/spreadsheets/d/1R1j385dUU2qMtzkSsUM5inT5tTyoTbQwI0vISf1Hav8/edit).
Keep each Record ID unchanged. Edit Function and Grains to the complete lists
you want published. A refresh replaces those lists exactly. Set Operational
Status to Closed to retain a source record while excluding it from publication.
The website is a snapshot; Sheet edits appear after a checked publication.

## Review the whole list

### Standardize formatting

Before review, create a cleaned copy and a cell-level change log:

```bash
python tools/standardize_directory.py --input /path/to/download.csv \
  --output /path/to/cleaned.csv --changes /path/to/formatting-changes.csv
```

This spells out street types in numbered addresses and alphabetizes each
Function list, without changing grain values, contacts, or sources. Saint
names such as St. Louis are preserved. The original export is never overwritten.
The publication vocabulary also supports the manually reviewed Grain Distiller,
Grain Malter, Retail Grain, and Wholesale Grain labels.

Use the cleaned CSV for the checks below. Formatting-only address changes reuse
map points only when the location's state and identity still match; a real
address or state change requires new geocoding.

In Google Sheets choose File > Download > Comma-separated values (.csv) on the
Organizations tab. In the grain-list project run:

```bash
python tools/maintain_directory.py --input /path/to/download.csv
```

Open `.maintenance/latest/review.html` directly in a browser. Search by name or
ID and switch between Issues, Changes, and Website checks. Issue links open the
source row in Google Sheets. CSV reports sit beside the HTML file.

Checks cover blank fields, controlled Function values, repeated/generic grains,
Whole Wheat used as a variety, duplicate names/websites, address/state conflicts,
invalid contacts/URLs, Verified records without sources, and map precision or
stale coordinates. Phone/Email gaps are counted but do not block publication.
Changes lists every addition, removal, and changed public field.

These checks cannot prove factual accuracy. A wrong Louisville, CO address and
a wrong CO State cell agree and require checking the actual organization site.
A working URL does not prove continued operation. Source should contain the
specific contact, product, or menu page supporting the record.

## Optional read-only download from Google Sheets

Use the existing Google service-account approach. The Sheet must be shared with
that account, or use CSV download instead. Credentials must never be committed.

```bash
python -m pip install -r requirements-maintenance.txt
python tools/maintain_directory.py \
  --sheet "https://docs.google.com/spreadsheets/d/1R1j385dUU2qMtzkSsUM5inT5tTyoTbQwI0vISf1Hav8/edit" \
  --tab Organizations --credentials /path/to/google-service-account.json
```

The script reads values only and never writes to the Sheet. Credentials are
excluded from reports and public files.

## Website checks and map refresh

These are optional free network operations, with no Tavily or LLM use:

```bash
python tools/maintain_directory.py --input /path/to/download.csv \
  --check-links --max-checks 100
python tools/maintain_directory.py --input /path/to/download.csv --geocode
```

Website checks use bounded timeouts and a seven-day cache. Repeat the command
to resume unchecked sites. `--refresh-links` rechecks cached URLs intentionally.
Failures and redirects require review and never automatically close a business.
The URL column is checked; individual Source pages still need factual review.

Geocoding invalidates changed addresses and states. Organization matches also
invalidate when the name changes. Approximate points remain labeled. Legacy
cache entries with insufficient identity metadata require a one-time refresh.
A geocoder match does not prove that an organization operates at that address.

## Acceptable exceptions and review dates

Some blanks are legitimate, for example when no controlled Function fits an
education organization. After review put a specific reason in
`reviewed_exceptions.csv` and rerun:

```bash
python tools/maintain_directory.py --input /path/to/download.csv \
  --exceptions /path/to/reviewed_exceptions.csv
```

Keep that file outside the report output folder so a later report cannot replace
your notes. Exceptions match Record ID, issue code, and exact fingerprint.
Changed values or source evidence require fresh review. Errors cannot be waived.

Optionally add Last Reviewed to the Sheet and enter YYYY-MM-DD after checking
the factual claims. When present, missing/invalid dates and reviews older than
180 days are flagged. This column is never published.

## Publish after review

Correct errors, review all warnings, and inspect Changes before running:

```bash
make test
python tools/maintain_directory.py --input /path/to/download.csv \
  --exceptions /path/to/reviewed_exceptions.csv --publish
make validate
```

Review removed records and add `--allow-removals` to confirm those changes.
Missing source rows and Closed rows both appear as removals. Empty sources,
unresolved errors, and unreviewed warnings block publication.

The script writes data/organizations.json only after checks pass. It saves the
source CSV, previous data, candidate data, source hash, and release manifest in
`.maintenance/releases/<timestamp>/`. Preview, then commit and push the public
JSON to GitHub for Vercel deployment. Reports/snapshots stay local and are ignored
by Git. To restore an old release, preserve the current file and inspect saved
previous.json first; this does not change the Sheet.
