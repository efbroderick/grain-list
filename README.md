# Grain List

Grain List is a mobile-friendly public map and directory of grain growers,
processors, millers, maltsters, bakers, brewers, restaurants, retailers, and
research organizations. Visitors can search by name or location, filter by
Function and Grain, browse nearby organizations, and submit corrections or new
listings through their own email client.

Every published organization appears on the map. When an exact address cannot
be verified, the interface identifies the point as an approximate city, region,
organization, or state location rather than presenting it as street-level data.

## Run locally

```bash
make setup
make test
make validate
make serve
```

Open `http://localhost:4173`.

## Project structure

- `index.html`, `styles.css`, `app.js`: static web application
- `data/organizations.json`: validated public directory data
- `tools/`: public-data build and validation utilities
- `tests/`: regression tests for data publication safeguards
- `config/functions.json`: controlled Function vocabulary
- `docs/MAINTENANCE.md`: update and deployment workflow
- `docs/REVIEW_WORKFLOW.md`: full-list audits, Sheet downloads, website checks,
  change review, and publication snapshots
- `docs/DATA_QUALITY.md`: evidence and publication policy

## Contact submissions

Set `contactEmail` in `site-config.js` before deployment. Grain List does not
store form data: it creates a prefilled email in the visitor's email client, so
the visitor reviews and sends the message themselves.

## Deployment

The repository is configured as a static Vercel project. Run tests and data
validation before every production deployment. See `docs/MAINTENANCE.md` for
the complete publication checklist.

## Review the full list

```bash
python tools/maintain_directory.py --input /path/to/reviewed-export.csv
```

Open `.maintenance/latest/review.html` to inspect missing fields, duplicate
candidates, address/state conflicts, map precision, and changes versus the site.
This command is read-only for the website and Sheet. See `docs/REVIEW_WORKFLOW.md`
before publishing.
