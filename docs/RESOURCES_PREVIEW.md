# Resources Page Draft

The resources page is a local review draft, not part of the deployed public site.
Its links and short publisher-attributed descriptions are in
`config/resources.json`. No paid services, tracking, embedded third-party pages,
or copied recipes are used.

Build a standalone preview with:

```sh
node tools/build_resources_preview.cjs /tmp/grain-list-resources-preview
```

Open its `index.html` locally. It uses the existing Grain List typography,
branding, and colors. Topics are whole grain basics, nutrition research, cooking,
and recipes/baking. Resource links open in a new tab; the map is unchanged.

After the owner approves the layout/content, connect the page to `/resources/`,
include it in the sitemap, and add a compact Resources entry to navigation. Do
not publish a redesigned map as part of that step. Recheck links and publisher
attribution when updating the review date.
