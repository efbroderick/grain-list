# Approved Naming Conventions

The October 29, 2026 owner-approved category and grain mappings live in
`config/taxonomy.json`. They cover the reviewed A-D cleanup only. Baker, Mill,
and Food Distributor replace Bakery, Miller, and Distributor. Every other
category in a combined entry is preserved.

Grain mappings correct approved spellings, capitalization, singular/plural
forms, missing Wheat suffixes, and source-checked Edison/WB9229/Chiddam cultivar
names. Non-grain facility/diet labels are excluded. The configuration does not
guess unfamiliar names or collapse Farro, Sonora/Sonoran, KAMUT, or Patwin-515HP
into other grains. Food Business and Food Producer remain separate.

Python import/standardization uses this configuration. `node tools/build_admin.cjs`
embeds it in the private admin domain validator; commit the generated Domain.gs
and update the existing private deployment after a mapping change. Tests compare
the embedded rules with the configuration. Publication validation rejects stale
approved aliases and non-grain values rather than letting them reappear.

Do not expand mappings based on fuzzy spelling or model guesses. Obtain owner
approval and supporting cultivar documentation before adding factual mappings.
Unknown names remain unchanged and can be flagged for review.

## Cultivar Evidence

- [Cairnspring Edison](https://cairnspring.com/collections/all/products/organic-edison-all-purpose-flour): Hard White Spring Wheat.
- [WestBred WB9229 specification](https://www.cs-contentapi.bayer.com/content/dam/westbred/us/en/products/spring-wheat/Product-SW-WB9229.pdf): Hard Red Spring Wheat, not winter.
- [Farmer Mai](https://www.farmermai.com/grain) and [Enney Ranch](https://www.enneyranch.com/chiddam-blanc-de-mars/): Chiddam spelling and white spring class. Enney describes soft/medium; the approved canonical label uses Soft White Spring.

These support names/classes of existing grain references, not current product
availability at every organization using the cultivar. Preserve organization
source links and review current availability separately when needed.

## Targeted Cleanup Release

`tools/apply_approved_taxonomy.cjs` prepares an explicitly approved cell plan
against a verified post-cleanup master snapshot and the latest public dataset.
It refuses changed before-values, mismatched IDs, source conflicts, unsupported
fields, or changes beyond the approved mapping configuration. It retains other
fields and unrelated organizations. Inputs, candidate output, and release log
must be different files. This script does not write to Google Sheets or deploy.

```sh
node tools/apply_approved_taxonomy.cjs \
  --published /path/to/current-public.json \
  --plan /path/to/applied-plan.json \
  --source /path/to/post-cleanup-snapshot.json \
  --output /path/to/candidate.json \
  --report /path/to/release-changes.json --date 2026-10-29
```

Review the candidate, run the full tests/validation/build, and publish through
the normal GitHub/Vercel release. Do not use a full-Sheet replacement to publish
this focused cleanup or overwrite newer admin publications.
