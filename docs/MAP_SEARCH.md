# Map Search Behavior

Search runs entirely in the visitor's browser against the published directory.
It does not call Tavily, an LLM, or a paid geocoding service.

- Typing updates matches and suggestions after a short pause, without moving the map.
- Enter submits the typed search; arrow keys and Enter can select a suggestion.
- Selecting an organization opens its existing profile overlay and named URL.
  Suggestions include organizations outside current filters; selecting one clears
  only conflicting filters and reports that change.
- Place suggestions come from states and cities represented in the directory,
  not a worldwide address database. Ambiguous cities include their state.
- Full state names and postal codes match geography, not word fragments.
- Common terms such as bakery/bakeries share a search token. This affects search
  only; it does not reclassify organizations or modify published grain names.
- Exact organization names take precedence over geographic interpretation.
- Searches such as "wheat near Denver" retain the grain term and navigate to
  the represented city. City searches frame an area, not a precise mile radius.
  A submitted place replaces the previous state/distance restriction, while
  preserving selected functions and grains.
- Function/grain changes, removed filter chips, and clearing text preserve the
  current viewport. State selection intentionally navigates to that state.
- The sidebar follows the map, excluding the area behind the mobile sheet.
- Empty results distinguish no matches nearby from no matches in the directory.
  Recovery buttons preserve other filters unless explicitly cleared.
- Focusing a result highlights its marker or containing cluster without panning.
- Map URLs retain the current center and zoom for refresh and sharing.

Automated regression coverage is in `tests/test_search.cjs` and
`tests/test_mobile_sheet.cjs`. Run `make test validate build` before publishing.
