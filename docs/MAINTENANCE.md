# Maintenance and Publishing

Grain List is intentionally separate from the private research system. It
accepts an approved publication CSV, generates browser-safe JSON, validates the
result, and deploys only the public website and public data.

## Update the directory

1. Export the approved public list as `data/publication_list.csv`. The file must
   contain `Record ID`, `Name`, `Category`, `State`, `Function`, `Grains`,
   `Address`, `Phone`, `Email`, `URL`, `Status`, and `Source` columns.
2. Run `make geocode`. This refreshes changed addresses using the free U.S.
   Census batch geocoder and writes `data/organizations.json`.
3. Run `make test` and `make validate`.
4. Preview with `make serve` on desktop and mobile before deployment.
5. Commit only the generated `data/organizations.json`, never the private CSV
   or `.cache/` geocoding records.

The validator blocks internal record IDs, confidence scores, research notes,
unknown Function values, invalid URLs, placeholder emails, invalid coordinates,
duplicate public IDs, and inconsistent summary counts.

## Handle public submissions

The site offers “Contribute” and “Suggest an update” actions. They create a
prefilled email and do not write directly to the published dataset. Review each
submission against the normal evidence rules, update the private master list,
then publish a fresh approved export through the steps above.

## Deploy to Vercel

The repository root is the Vercel project root; there is no build step. Before
production deployment:

```bash
make test
make validate
```

Then deploy with Vercel or connect the standalone GitHub repository to Vercel.
`vercel.json` supplies cache and security headers. The contact email is stored
in `site-config.js`; changing it requires a normal redeployment.
