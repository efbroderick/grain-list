# Grain List

Grain List is a mobile-friendly public map and directory of grain growers,
processors, millers, maltsters, bakers, brewers, restaurants, retailers, and
research organizations. Visitors can search by name or location, filter by
Function and Grain, browse nearby organizations, and submit corrections or new
listings through their own email client.

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
- `docs/DATA_QUALITY.md`: evidence and publication policy

## Contact submissions

Set `contactEmail` in `site-config.js` before deployment. Grain List does not
store form data: it creates a prefilled email in the visitor's email client, so
the visitor reviews and sends the message themselves.

## Deployment

The repository is configured as a static Vercel project. Run tests and data
validation before every production deployment. See `docs/MAINTENANCE.md` for
the complete publication checklist.
