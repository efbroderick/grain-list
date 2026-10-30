const DATA_URL = "/data/organizations.json?version=__DATA_VERSION__";
const USA_VIEW = { center: [39.5, -98.35], zoom: 4 };
const MAX_VISIBLE_RESULTS = 250;
const STATE_NAMES = Object.fromEntries([
  'AL:Alabama', 'AK:Alaska', 'AZ:Arizona', 'AR:Arkansas', 'CA:California', 'CO:Colorado',
  'CT:Connecticut', 'DE:Delaware', 'DC:District of Columbia', 'FL:Florida', 'GA:Georgia',
  'HI:Hawaii', 'ID:Idaho', 'IL:Illinois', 'IN:Indiana', 'IA:Iowa', 'KS:Kansas',
  'KY:Kentucky', 'LA:Louisiana', 'ME:Maine', 'MD:Maryland', 'MA:Massachusetts',
  'MI:Michigan', 'MN:Minnesota', 'MS:Mississippi', 'MO:Missouri', 'MT:Montana',
  'NE:Nebraska', 'NV:Nevada', 'NH:New Hampshire', 'NJ:New Jersey', 'NM:New Mexico',
  'NY:New York', 'NC:North Carolina', 'ND:North Dakota', 'OH:Ohio', 'OK:Oklahoma',
  'OR:Oregon', 'PA:Pennsylvania', 'RI:Rhode Island', 'SC:South Carolina',
  'SD:South Dakota', 'TN:Tennessee', 'TX:Texas', 'UT:Utah', 'VT:Vermont',
  'VA:Virginia', 'WA:Washington', 'WV:West Virginia', 'WI:Wisconsin', 'WY:Wyoming',
].map(entry => entry.split(':')));
const SEARCH_WORDS = { bakeries: 'baker', bakery: 'baker', bakers: 'baker', baked: 'baker', growers: 'grower', mills: 'mill', millers: 'mill', oats: 'oat', breweries: 'brew', brewery: 'brew', brewing: 'brew', brewer: 'brew', brewers: 'brew' };

const elements = {
  search: document.querySelector("#search-input"),
  clearSearch: document.querySelector("#clear-search"),
  suggestions: document.querySelector("#search-suggestions"),
  state: document.querySelector("#state-filter"),
  radius: document.querySelector("#radius-filter"),
  distanceField: document.querySelector("#distance-field"),
  functions: document.querySelector("#function-options"),
  grains: document.querySelector("#grain-options"),
  functionSummary: document.querySelector("#function-summary"),
  grainSummary: document.querySelector("#grain-summary"),
  sort: document.querySelector("#sort-select"),
  activeFilters: document.querySelector("#active-filters"),
  resultCount: document.querySelector("#result-count"),
  mappedCount: document.querySelector("#mapped-count"),
  results: document.querySelector("#results-list"),
  datasetSummary: document.querySelector("#dataset-summary"),
  locate: document.querySelector("#locate-button"),
  locateMobile: document.querySelector("#locate-button-mobile"),
  share: document.querySelector("#share-button"),
  filterButton: document.querySelector("#filter-button"),
  filterCount: document.querySelector("#filter-count"),
  closeFilters: document.querySelector("#close-filters"),
  filterOverlay: document.querySelector("#filter-overlay"),
  clearFiltersMobile: document.querySelector("#clear-filters-mobile"),
  showResults: document.querySelector("#show-results"),
  fitResults: document.querySelector("#fit-results-button"),
  mapEmpty: document.querySelector("#map-empty"),
  detail: document.querySelector("#detail-dialog"),
  detailName: document.querySelector("#detail-name"),
  detailCategory: document.querySelector("#detail-category"),
  detailContent: document.querySelector("#detail-content"),
  detailWebsite: document.querySelector("#detail-website"),
  detailMap: document.querySelector("#detail-map-button"),
  detailSuggest: document.querySelector("#detail-suggest-button"),
  detailShare: document.querySelector("#detail-share-button"),
  closeDetail: document.querySelector("#close-detail"),
  toast: document.querySelector("#toast"),
};

const state = {
  organizations: [],
  query: "",
  stateCode: "",
  functions: new Set(),
  grains: new Set(),
  radius: "",
  sort: "name",
  userLocation: null,
  focusedOrganizationId: "",
  selectedOrganization: null,
  initialView: null,
};

let map;
let markerLayer;
let userMarker;
const markersById = new Map();
let lastFiltered = [];
let toastTimer;
let mobileSheet;
let searchSuggestions = [];
let suggestionIndex = -1;
let places = [];
let intentCache;
let highlightedMarker;
let searchTimer;

function normalized(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchWords(value) {
  return normalized(value).split(' ').filter(Boolean).map(word => SEARCH_WORDS[word] || word);
}

function initializeSearch() {
  const cities = new Map();
  for (const o of state.organizations) {
    if (!o.city || !o.location || o.location.precision === 'state') continue;
    const key = `${normalized(o.city)}|${o.state}`;
    if (!cities.has(key)) cities.set(key, { type: 'city', city: o.city, code: o.state, label: `${o.city}, ${o.state}` });
  }
  places = [...Object.entries(STATE_NAMES).map(([code, name]) => ({ type: 'state', code, label: name })), ...cities.values()];
  intentCache = null;
}

function searchIntent() {
  if (intentCache?.query === state.query) return intentCache.value;
  let text = normalized(state.query);
  let place = null;
  // Exact organization names take precedence over similarly named places.
  const isGrain = state.organizations.some(o => o.grains.some(grain => normalized(grain) === text));
  if (!isGrain && !state.organizations.some(o => normalized(o.name) === text)) {
    const states = places.filter(p => p.type === 'state').sort((a, b) => b.label.length - a.label.length);
    for (const p of states) {
      const label = normalized(p.label), code = p.code.toLowerCase();
      const suffix = text === label || text.endsWith(` ${label}`) ? label : text === code || text.endsWith(` ${code}`) ? code : '';
      if (suffix) { place = p; text = text.slice(0, -suffix.length).trim(); break; }
    }
    const cities = places.filter(p => p.type === 'city' && (!place || p.code === place.code) && (text === normalized(p.city) || text.endsWith(` ${normalized(p.city)}`)));
    const longest = cities.sort((a, b) => b.city.length - a.city.length)[0];
    const sameName = longest && cities.filter(p => normalized(p.city) === normalized(longest.city));
    if (sameName?.length === 1) { place = longest; text = text.slice(0, -normalized(longest.city).length).trim(); }
    if (place) text = text.replace(/(?:^| )(?:near|in)$/, '').trim();
  }
  const value = { place, terms: searchWords(text) };
  intentCache = { query: state.query, value };
  return value;
}

function queryScore(o) {
  const query = normalized(state.query), name = normalized(o.name);
  if (!query) return 0;
  if (name === query) return 1000;
  if (name.startsWith(query)) return 700;
  if (name.includes(query)) return 500;
  const words = searchWords(o.name);
  return searchIntent().terms.reduce((score, term) => score + (words.some(w => w.startsWith(term)) ? 30 : 0), 0);
}

function closeSuggestions() {
  elements.suggestions.hidden = true;
  elements.search.setAttribute('aria-expanded', 'false');
  elements.search.removeAttribute('aria-activedescendant');
  suggestionIndex = -1;
}

function renderSuggestions() {
  const query = normalized(elements.search.value);
  elements.suggestions.replaceChildren();
  if (!query) { closeSuggestions(); return; }
  const placeMatches = places.filter(p => query.split(' ').every(term => normalized(p.label).split(' ').some(word => word === term || (term.length >= 3 && word.startsWith(term)))) || (p.type === 'state' && p.code.toLowerCase() === query))
    .sort((a, b) => Number(normalized(b.label) === query || b.code.toLowerCase() === query) - Number(normalized(a.label) === query || a.code.toLowerCase() === query) || a.label.localeCompare(b.label)).slice(0, 4);
  const orgMatches = state.organizations.filter(o => matchesQuery(o) && queryScore(o) > 0)
    .sort((a, b) => queryScore(b) - queryScore(a) || a.name.localeCompare(b.name)).slice(0, 5);
  searchSuggestions = [
    ...orgMatches.map(o => ({ type: 'organization', organization: o, label: o.name, secondary: [o.city, o.state].filter(Boolean).join(', ') })),
    ...placeMatches.map(p => ({ ...p, secondary: p.type === 'state' ? 'State' : 'City or region' })),
    { type: 'query', label: `Search for “${elements.search.value.trim()}”`, secondary: 'All matching organizations' },
  ];
  searchSuggestions.forEach((suggestion, index) => {
    const option = document.createElement('div');
    option.id = `search-option-${index}`;
    option.className = 'search-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.innerHTML = `<strong>${escapeHtml(suggestion.label)}</strong><span>${escapeHtml(suggestion.secondary)}</span>`;
    option.addEventListener('pointerdown', e => e.preventDefault());
    option.addEventListener('click', () => submitSearch(suggestion));
    elements.suggestions.append(option);
  });
  suggestionIndex = -1;
  elements.suggestions.hidden = false;
  elements.search.setAttribute('aria-expanded', 'true');
  elements.search.removeAttribute('aria-activedescendant');
}

function fitPlace(place) {
  const organizations = state.organizations.filter(o => o.state === place.code && (place.type === 'state' || normalized(o.city) === normalized(place.city)) && o.location);
  if (!organizations.length) return false;
  const bounds = L.latLngBounds(organizations.map(o => [o.location.lat, o.location.lng]));
  frameBounds(bounds, place.type === 'city' ? 10 : 7);
  return true;
}

function submitSearch(suggestion) {
  window.clearTimeout(searchTimer);
  const o = suggestion?.organization;
  state.query = o ? o.name : suggestion && suggestion.type !== 'query' ? suggestion.label : elements.search.value;
  state.focusedOrganizationId = '';
  state.sort = state.query.trim() ? 'relevance' : 'name';
  const place = searchIntent().place;
  if (place) { state.stateCode = ''; state.radius = ''; }
  let cleared = false;
  if (o) {
    if (state.stateCode && state.stateCode !== o.state) { state.stateCode = ''; cleared = true; }
    if (!matchesSelection(o.functions, state.functions)) { state.functions.clear(); cleared = true; }
    if (!matchesSelection(o.grains, state.grains)) { state.grains.clear(); cleared = true; }
    if (state.radius && state.userLocation && (!hasDistancePrecision(o) || distanceMiles(state.userLocation, o.location) > Number(state.radius))) { state.radius = ''; cleared = true; }
    if (cleared) refreshCheckboxes();
  }
  closeSuggestions();
  closeFilterMenus();
  closeFilters();
  render();
  if (place) fitPlace(place);
  else fitResults();
  if (o) showDetails(o);
  if (cleared) showToast('Conflicting filters cleared for this organization.');
  if (window.matchMedia?.('(max-width: 720px)')?.matches) elements.search.blur();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2400);
}

function distanceMiles(first, second) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const latitudeDelta = toRadians(second.lat - first.lat);
  const longitudeDelta = toRadians(second.lng - first.lng);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(first.lat)) *
      Math.cos(toRadians(second.lat)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hasDistancePrecision(organization) {
  return organization.location && organization.location.precision !== "state";
}

function locationNote(organization) {
  const precision = organization.location?.precision;
  if (precision === "state") return "Approximate map location (state only)";
  if (precision === "place") return "Approximate map location (city or region)";
  if (precision === "organization") return "Approximate map location (organization match)";
  return "";
}

function markerClass(organization) {
  const functions = organization.functions.join(" ").toLocaleLowerCase();
  if (functions.includes("grower")) return "marker-grower";
  if (functions.includes("baked")) return "marker-bakery";
  if (functions.includes("malt") || functions.includes("beer")) return "marker-brewer";
  if (functions.includes("processor") || functions.includes("milled") || functions.includes("flour")) {
    return "marker-processor";
  }
  if (functions.includes("featured on menu")) return "marker-menu";
  return "marker-other";
}

function organizationIcon(organization) {
  return L.divIcon({
    className: "grain-marker-target",
    html: `<span class="grain-marker ${markerClass(organization)}"></span>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -14],
  });
}

function initializeMap() {
  map = L.map("map", {
    center: USA_VIEW.center,
    zoom: USA_VIEW.zoom,
    minZoom: 2,
    maxZoom: 16,
    zoomControl: false,
    preferCanvas: true,
  });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  const lightBase = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 16,
    attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
  });
  const lightLabels = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 16,
    pane: "shadowPane",
  });
  const fallback = L.layerGroup([lightBase, lightLabels]);
  window.GrainListBasemap.addTo(map, fallback);
  markerLayer = L.markerClusterGroup({
    chunkedLoading: true,
    showCoverageOnHover: false,
    maxClusterRadius: 42,
    spiderfyOnMaxZoom: true,
    iconCreateFunction(cluster) {
      const count = cluster.getChildCount();
      const size = count < 10 ? "small" : count < 50 ? "medium" : "large";
      const dimension = count < 10 ? 32 : count < 50 ? 38 : 44;
      return L.divIcon({
        className: "grain-cluster-target",
        html: `<span class="grain-cluster grain-cluster-${size}" style="width:${dimension}px;height:${dimension}px"><strong>${count}</strong></span>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });
    },
  });
  map.addLayer(markerLayer);
  map.on("moveend", () => {
    renderViewportResults();
    updateUrl();
  });
}

function listingIdFromLocation() {
  const route = window.location.pathname.match(/^\/organizations\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
  return route?.[1] || new URLSearchParams(window.location.search).get("organization") || "";
}

function parseUrlState() {
  const params = new URLSearchParams(window.location.search);
  state.query = params.get("q") || "";
  state.stateCode = params.get("state") || "";
  state.functions = new Set((params.get("functions") || "").split("|").filter(Boolean));
  state.grains = new Set((params.get("grains") || "").split("|").filter(Boolean));
  state.radius = params.get("radius") || "";
  state.sort = state.query.trim() ? 'relevance' : 'name';
  const view = params.get('view')?.split(',').map(Number);
  state.initialView = view?.length === 3 && view.every(Number.isFinite) && Math.abs(view[0]) <= 85 && Math.abs(view[1]) <= 180 && view[2] >= 2 && view[2] <= 16 ? view : null;
  state.focusedOrganizationId = listingIdFromLocation();
}

function updateUrl() {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.stateCode) params.set("state", state.stateCode);
  if (state.functions.size) params.set("functions", [...state.functions].sort().join("|"));
  if (state.grains.size) params.set("grains", [...state.grains].sort().join("|"));
  if (state.radius && state.userLocation) params.set("radius", state.radius);
  if (map?.getCenter && map?.getZoom) {
    const inset = mobileSheet?.inset() || 0;
    const size = inset && map.getSize?.();
    const center = size && map.containerPointToLatLng ? map.containerPointToLatLng([size.x / 2, Math.max(1, size.y - inset) / 2]) : map.getCenter();
    params.set('view', `${center.lat.toFixed(5)},${center.lng.toFixed(5)},${map.getZoom()}`);
  }
  const query = params.toString();
  const route = state.selectedOrganization ? organizationUrl(state.selectedOrganization) : "/";
  window.history.replaceState(window.history.state, "", `${route}${query ? `?${query}` : ""}`);
}

function countsFor(key) {
  const counts = new Map();
  for (const organization of state.organizations) {
    for (const value of organization[key]) {
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function renderCheckboxOptions(container, entries, selected, key) {
  container.replaceChildren();
  for (const [value, count] of entries) {
    const label = document.createElement("label");
    label.className = "checkbox-option";
    label.innerHTML = `
      <input type="checkbox" value="${escapeHtml(value)}" ${selected.has(value) ? "checked" : ""} />
      <span>${escapeHtml(value)}</span>
      <span class="option-count">${count}</span>
    `;
    label.querySelector("input").addEventListener("change", (event) => {
      if (event.target.checked) selected.add(value);
      else selected.delete(value);
      document.querySelectorAll("details").forEach((details) => {
        if (details.contains(container)) return;
        details.open = false;
      });
      syncControls();
      render();
    });
    container.append(label);
  }
}

function initializeControls() {
  const states = [...new Set(state.organizations.map((item) => item.state).filter(Boolean))].sort();
  for (const stateCode of states) {
    const option = document.createElement("option");
    option.value = stateCode;
    option.textContent = stateCode;
    elements.state.append(option);
  }
  renderCheckboxOptions(elements.functions, countsFor("functions"), state.functions, "functions");
  renderCheckboxOptions(elements.grains, countsFor("grains"), state.grains, "grains");
  syncControls();
}

function syncControls() {
  elements.search.value = state.query;
  elements.clearSearch.hidden = !state.query;
  elements.state.value = state.stateCode;
  elements.radius.value = state.userLocation ? state.radius : "";
  elements.radius.disabled = !state.userLocation;
  elements.distanceField.hidden = !state.userLocation;
  elements.sort.value = state.sort;
  elements.sort.options.namedItem?.("distance");
  elements.sort.querySelector('option[value="distance"]').disabled = !state.userLocation;
  elements.functionSummary.textContent = state.functions.size ? `${state.functions.size} selected` : "All";
  elements.grainSummary.textContent = state.grains.size ? `${state.grains.size} selected` : "All";
  const filterCount = Number(Boolean(state.stateCode)) + state.functions.size + state.grains.size + Number(Boolean(state.radius));
  elements.filterCount.textContent = filterCount;
  elements.filterCount.hidden = filterCount === 0;
}

function matchesQuery(organization) {
  if (!state.query) return true;
  const { place, terms } = searchIntent();
  if (place?.type === 'state' && organization.state !== place.code) return false;
  const words = searchWords(organization.searchText);
  return terms.every(term => words.some(word => word === term || (term.length >= 3 && word.startsWith(term))));
}

function matchesSelection(values, selected) {
  return selected.size === 0 || values.some((value) => selected.has(value));
}

function filteredOrganizations(ignoreBounds = false) {
  const bounds = !ignoreBounds && map ? visibleMapBounds() : null;
  const radius = state.userLocation && state.radius ? Number(state.radius) : null;
  const results = state.organizations.filter((organization) => {
    if (!matchesQuery(organization)) return false;
    if (state.stateCode && organization.state !== state.stateCode) return false;
    if (!matchesSelection(organization.functions, state.functions)) return false;
    if (!matchesSelection(organization.grains, state.grains)) return false;
    if (radius) {
      if (!hasDistancePrecision(organization)) return false;
      if (distanceMiles(state.userLocation, organization.location) > radius) return false;
    }
    if (bounds) {
      if (!organization.location) return false;
      if (!bounds.contains([organization.location.lat, organization.location.lng])) return false;
    }
    return true;
  });

  for (const organization of results) {
    organization.distance = state.userLocation && hasDistancePrecision(organization)
      ? distanceMiles(state.userLocation, organization.location)
      : null;
  }
  results.sort((a, b) => {
    if (state.sort === "distance" && state.userLocation) {
      if (a.distance == null && b.distance == null) return a.name.localeCompare(b.name);
      if (a.distance == null) return 1;
      if (b.distance == null) return -1;
      return a.distance - b.distance || a.name.localeCompare(b.name);
    }
    if (state.sort === 'relevance' && state.query.trim()) return queryScore(b) - queryScore(a) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
  return results;
}

function visibleMapBounds() {
  const inset = mobileSheet?.inset() || 0;
  if (!inset || !map.containerPointToLatLng) return map.getBounds();
  const size = map.getSize();
  return L.latLngBounds(map.containerPointToLatLng([0, 0]), map.containerPointToLatLng([size.x, Math.max(1, size.y - inset)]));
}

function renderMarkers(organizations) {
  highlightOrganization(null);
  markerLayer.clearLayers();
  markersById.clear();
  for (const organization of organizations) {
    if (!organization.location) continue;
    const marker = L.marker(
      [organization.location.lat, organization.location.lng],
      { icon: organizationIcon(organization), title: organization.name },
    );
    const tooltip = locationNote(organization)
      ? `${organization.name} · approximate location`
      : organization.name;
    marker.bindTooltip(tooltip, { direction: "top", offset: [0, -14] });
    marker.on("click", () => showDetails(organization));
    markersById.set(organization.id, marker);
    markerLayer.addLayer(marker);
  }
  elements.mapEmpty.hidden = markersById.size !== 0;
}

function resultItem(organization) {
  const button = document.createElement("a");
  button.className = "result-item";
  button.href = organizationUrl(organization);
  button.addEventListener('mouseenter', () => highlightOrganization(organization));
  button.addEventListener('mouseleave', () => highlightOrganization(null));
  button.addEventListener('focus', () => highlightOrganization(organization));
  button.addEventListener('blur', () => highlightOrganization(null));
  button.addEventListener("click", event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (event.button != null && event.button !== 0)) return;
    event.preventDefault();
    showDetails(organization);
  });
  const locationText = organization.address || `${organization.state} · Approximate location`;
  const distance = organization.distance == null ? "" : `${organization.distance.toFixed(organization.distance < 10 ? 1 : 0)} mi`;
  const functionText = organization.functions.length
    ? organization.functions.slice(0, 2).join(" · ")
    : organization.category || "Grain organization";
  const grainText = organization.grains.length
    ? `Grains: ${organization.grains.slice(0, 4).join(", ")}${organization.grains.length > 4 ? ` +${organization.grains.length - 4}` : ""}`
    : "";
  button.innerHTML = `
    <div class="result-item-header">
      <h3>${escapeHtml(organization.name)}</h3>
      ${distance ? `<span class="result-distance">${escapeHtml(distance)}</span>` : ""}
    </div>
    <p class="result-meta"><span class="status-dot"></span>${escapeHtml(functionText)}</p>
    <p class="result-address">${escapeHtml(locationText)}</p>
    ${grainText ? `<p class="result-grains">${escapeHtml(grainText)}</p>` : ""}
  `;
  button.querySelectorAll("p").forEach(paragraph => { paragraph.title = paragraph.textContent; });
  return button;
}

function highlightOrganization(organization) {
  highlightedMarker?.classList.remove('search-marker-active');
  highlightedMarker = null;
  if (!organization) return;
  const marker = markersById.get(organization.id);
  const visible = marker && (markerLayer.getVisibleParent?.(marker) || marker);
  highlightedMarker = visible?.getElement?.() || null;
  highlightedMarker?.classList.add('search-marker-active');
}

function organizationUrl(organization) {
  return `/organizations/${encodeURIComponent(organization.slug || organization.id)}/`;
}

function webLink(value) {
  try { return ["http:", "https:"].includes(new URL(value).protocol) ? value : ""; }
  catch { return ""; }
}

function showDetails(organization, pushHistory = true) {
  const previous = state.selectedOrganization;
  const returnUrl = window.history.state?.returnUrl || `${window.location.pathname}${window.location.search}`;
  state.selectedOrganization = organization;
  state.focusedOrganizationId = "";
  elements.detailName.textContent = organization.name;
  elements.detailCategory.textContent = [organization.category, organization.state].filter(Boolean).join(" · ");
  const section = (title, content) => `<section class="detail-section"><h3>${title}</h3>${content}</section>`;
  const tags = (values, grain = false) => `<div class="tag-list">${values.map(value => `<span class="tag${grain ? " grain" : ""}">${escapeHtml(value)}</span>`).join("")}</div>`;
  const content = [];
  if (organization.functions.length) content.push(section("Functions", tags(organization.functions)));
  if (organization.grains.length) content.push(section("Grains", tags(organization.grains, true)));
  const note = locationNote(organization);
  if (note) content.push(section("Map location", `<p class="location-note">${escapeHtml(note)}</p>`));
  const contact = [
    organization.address ? `<p>${escapeHtml(organization.address)}</p>` : "",
    /\bP\.?\s*O\.?\s*Box\b/i.test(organization.address) ? '<p class="location-note">Mailing address, not a visitor address.</p>' : "",
    organization.phone ? `<a href="tel:${escapeHtml(organization.phone.replace(/[^\d+]/g, ""))}">${escapeHtml(organization.phone)}</a>` : "",
    organization.email ? `<a href="mailto:${escapeHtml(organization.email)}">${escapeHtml(organization.email)}</a>` : "",
  ].join("");
  if (contact) content.push(section("Contact", `<div class="contact-list">${contact}</div>`));
  const sources = organization.sources.filter(webLink);
  if (sources.length) content.push(`<details class="detail-section detail-disclosure"><summary><span>Sources</span><span class="detail-disclosure-meta">${sources.length} ${sources.length === 1 ? "source" : "sources"}<i data-lucide="chevron-down" aria-hidden="true"></i></span></summary><div class="contact-list">${sources.map((url, index) => `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">Source ${index + 1}: ${escapeHtml(new URL(url).hostname.replace(/^www\./, ""))}</a>`).join("")}</div></details>`);
  elements.detailContent.innerHTML = content.join("");
  elements.detailWebsite.hidden = !webLink(organization.url);
  if (webLink(organization.url)) elements.detailWebsite.href = organization.url;
  elements.detailMap.hidden = !organization.location;
  elements.detailSuggest.href = `/add/?organization=${encodeURIComponent(organization.id)}&type=correction`;
  const params = new URLSearchParams(window.location.search);
  params.delete("organization");
  const query = params.toString();
  const url = `${organizationUrl(organization)}${query ? `?${query}` : ""}`;
  if (pushHistory && !previous) window.history.pushState({ grainListOverlay: true, returnUrl }, "", url);
  else window.history.replaceState(window.history.state, "", url);
  document.title = `${organization.name} | Grain List`;
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", `${window.location.origin}${organizationUrl(organization)}`);
  if (!elements.detail.open) elements.detail.showModal();
  window.lucide?.createIcons();
}

function closeDetails() {
  if (!state.selectedOrganization) return;
  state.selectedOrganization = null;
  state.focusedOrganizationId = "";
  elements.detail.close();
  document.title = "Grain List";
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", `${window.location.origin}/`);
  if (window.history.state?.grainListOverlay) window.history.back();
  else updateUrl();
}

function renderResults(organizations) {
  highlightOrganization(null);
  elements.results.replaceChildren();
  if (!organizations.length) {
    const elsewhere = filteredOrganizations(true).length;
    const empty = document.createElement("div");
    empty.className = "empty-results";
    empty.innerHTML = `
      <i data-lucide="search-x" aria-hidden="true"></i>
      <strong>${elsewhere ? 'No matches in this area' : 'No organizations match these filters'}</strong>
      <span>${elsewhere ? `${pluralize(elsewhere, 'match', 'matches')} elsewhere.` : 'Try a broader search or remove a filter.'}</span>
    `;
    function recovery(label, handler) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'button button-secondary'; button.textContent = label;
      button.addEventListener('click', handler); empty.append(button);
    }
    if (elsewhere) recovery('Show matches elsewhere', fitResults);
    if (state.radius && Number(state.radius) < 250) recovery('Expand distance', () => {
      state.radius = String([25, 50, 100, 250].find(r => r > Number(state.radius)));
      render(); fitResults();
    });
    if (state.stateCode || state.functions.size || state.grains.size || state.radius) recovery('Clear filters', () => {
      state.stateCode = ''; state.functions.clear(); state.grains.clear(); state.radius = '';
      refreshCheckboxes(); render();
    });
    if (state.query) recovery('Clear search', clearSearch);
    elements.results.append(empty);
    window.lucide?.createIcons();
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const organization of organizations.slice(0, MAX_VISIBLE_RESULTS)) {
    fragment.append(resultItem(organization));
  }
  if (organizations.length > MAX_VISIBLE_RESULTS) {
    const message = document.createElement("div");
    message.className = "empty-results";
    message.innerHTML = `<strong>Showing the first ${MAX_VISIBLE_RESULTS}</strong><span>Use search or filters to narrow the directory.</span>`;
    fragment.append(message);
  }
  elements.results.append(fragment);
}

function activeFilterButton(label, onRemove) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "filter-chip";
  button.innerHTML = `<span>${escapeHtml(label)}</span><i data-lucide="x" aria-hidden="true"></i>`;
  button.addEventListener("click", onRemove);
  return button;
}

function renderActiveFilters() {
  elements.activeFilters.replaceChildren();
  const filters = [];
  if (state.stateCode) filters.push([state.stateCode, () => { state.stateCode = ""; }]);
  for (const value of state.functions) filters.push([value, () => state.functions.delete(value)]);
  for (const value of state.grains) filters.push([value, () => state.grains.delete(value)]);
  if (state.radius) filters.push([`${state.radius} miles`, () => { state.radius = ""; }]);
  for (const [label, remove] of filters) {
    elements.activeFilters.append(activeFilterButton(label, () => {
      remove();
      renderCheckboxOptions(elements.functions, countsFor("functions"), state.functions, "functions");
      renderCheckboxOptions(elements.grains, countsFor("grains"), state.grains, "grains");
      syncControls();
      render();
    }));
  }
  window.lucide?.createIcons();
}

function renderViewportResults() {
  const visible = filteredOrganizations();
  elements.resultCount.textContent = `${pluralize(visible.length, "organization")} in this area`;
  elements.mappedCount.textContent = "Updates as you move the map";
  renderResults(visible);
}

function render() {
  lastFiltered = filteredOrganizations(true);
  renderMarkers(lastFiltered);
  renderViewportResults();
  renderActiveFilters();
  syncControls();
  updateUrl();
}

function focusLinkedOrganization() {
  if (!state.focusedOrganizationId) return;
  const organization = state.organizations.find(item => item.id === state.focusedOrganizationId || item.slug === state.focusedOrganizationId);
  if (!organization?.location) {
    state.focusedOrganizationId = "";
    render();
    showToast("That listing is no longer available on the map.");
    return;
  }
  const precision = organization.location.precision;
  const zoom = precision === "state" ? 5 : precision === "place" ? 11 : 13;
  map.setView([organization.location.lat, organization.location.lng], zoom);
  const marker = markersById.get(organization.id);
  if (marker) markerLayer.zoomToShowLayer(marker, () => marker.openTooltip());
  showDetails(organization, false);
}

function fitResults() {
  const locations = lastFiltered.filter((item) => item.location);
  if (!locations.length) return;
  const bounds = L.latLngBounds(locations.map((item) => [item.location.lat, item.location.lng]));
  frameBounds(bounds, 12);
}

function frameBounds(bounds, maxZoom) {
  mobileSheet?.collapse();
  const bottomInset = mobileSheet?.inset() || 0;
  const verticalPadding = Math.min(38, Math.max(4, (map.getSize().y - bottomInset - 20) / 2));
  map.fitBounds(bounds, { paddingTopLeft: [38, verticalPadding], paddingBottomRight: [38, bottomInset + verticalPadding], maxZoom });
}

function restoreMapView(view) {
  map.setView([view[0], view[1]], view[2], { animate: false });
  const inset = mobileSheet?.inset() || 0;
  if (inset) map.panBy([0, inset / 2], { animate: false });
}

function sheetSizes(viewportHeight, topbarHeight) {
  const maximum = Math.max(96, viewportHeight - topbarHeight - 52);
  return { minimum: Math.min(144, maximum), collapsed: Math.min(338, maximum), maximum };
}

function initializeMobileSheet() {
  const handle = document.querySelector("#sheet-handle");
  const sidebar = document.querySelector("#sidebar");
  const media = window.matchMedia("(max-width: 720px)");
  let sizes;
  let height;
  let drag;
  let dragEnded = 0;

  function setHeight(value) {
    height = Math.max(sizes.minimum, Math.min(sizes.maximum, value));
    document.body.style.setProperty("--sheet-height", `${height}px`);
    const expanded = height > sizes.collapsed + 24;
    document.body.classList.toggle("sheet-expanded", expanded);
    handle.setAttribute("aria-expanded", String(expanded));
    handle.setAttribute("aria-label", expanded ? "Collapse organization list" : "Expand organization list");
    if (map?.getBounds && state.organizations.length) renderViewportResults();
  }

  function resize() {
    const wasExpanded = sizes && height > sizes.collapsed + 24;
    sizes = sheetSizes(window.innerHeight, document.querySelector(".topbar").getBoundingClientRect().height);
    setHeight(wasExpanded ? sizes.maximum : height ?? sizes.collapsed);
    drag = null;
  }

  handle.addEventListener("pointerdown", event => {
    if (!media.matches || event.isPrimary === false || event.button !== 0) return;
    drag = { y: event.clientY, height, moved: false };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", event => {
    if (!drag) return;
    if (Math.abs(event.clientY - drag.y) > 5) drag.moved = true;
    if (drag.moved) setHeight(drag.height + drag.y - event.clientY);
  });
  handle.addEventListener("pointerup", () => {
    if (drag?.moved) dragEnded = Date.now();
    drag = null;
  });
  handle.addEventListener("pointercancel", () => {
    if (drag) setHeight(drag.height);
    drag = null;
  });
  handle.addEventListener("lostpointercapture", () => { drag = null; });
  handle.addEventListener("click", event => {
    if (event.detail > 0 && Date.now() - dragEnded < 350) return;
    setHeight(height > sizes.collapsed + 24 ? sizes.collapsed : sizes.maximum);
  });
  handle.addEventListener("keydown", event => {
    const values = { ArrowUp: height + 80, ArrowDown: height - 80, Home: sizes.minimum, End: sizes.maximum };
    if (!(event.key in values)) return;
    event.preventDefault();
    setHeight(values[event.key]);
  });
  window.addEventListener("resize", resize);
  media.addEventListener("change", resize);
  resize();
  return {
    collapse() { setHeight(sizes.collapsed); },
    inset() { return media.matches ? sidebar.getBoundingClientRect().height : 0; },
  };
}

function locateUser() {
  if (!navigator.geolocation) {
    showToast("Location is not available in this browser.");
    return;
  }
  setLocationButtonsDisabled(true);
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (searchIntent().place) state.query = searchIntent().terms.join(' ');
      state.stateCode = '';
      state.userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      state.radius = state.radius || "50";
      state.sort = "distance";
      if (userMarker) userMarker.remove();
      userMarker = L.circleMarker([state.userLocation.lat, state.userLocation.lng], {
        radius: 8,
        color: "#ffffff",
        weight: 3,
        fillColor: "#315b9d",
        fillOpacity: 1,
      }).addTo(map).bindTooltip("Your location");
      map.setView([state.userLocation.lat, state.userLocation.lng], 8);
      setLocationButtonsDisabled(false);
      syncControls();
      render();
      closeSuggestions();
      showToast(`Showing organizations within ${state.radius} miles.`);
    },
    () => {
      setLocationButtonsDisabled(false);
      showToast("We could not access your location.");
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
  );
}

function setLocationButtonsDisabled(disabled) {
  elements.locate.disabled = disabled;
  elements.locateMobile.disabled = disabled;
}

function clearAllFilters() {
  window.clearTimeout(searchTimer);
  closeSuggestions();
  state.focusedOrganizationId = "";
  state.query = "";
  state.stateCode = "";
  state.functions.clear();
  state.grains.clear();
  state.radius = "";
  state.sort = "name";
  renderCheckboxOptions(elements.functions, countsFor("functions"), state.functions, "functions");
  renderCheckboxOptions(elements.grains, countsFor("grains"), state.grains, "grains");
  syncControls();
  render();
  fitResults();
}

function refreshCheckboxes() {
  renderCheckboxOptions(elements.functions, countsFor('functions'), state.functions, 'functions');
  renderCheckboxOptions(elements.grains, countsFor('grains'), state.grains, 'grains');
}

function clearSearch() {
  window.clearTimeout(searchTimer);
  state.query = '';
  state.sort = state.userLocation ? 'distance' : 'name';
  elements.search.value = '';
  closeSuggestions();
  elements.search.focus();
  render();
}

function closeFilters() {
  document.body.classList.remove("filters-open");
}

function closeFilterMenus() {
  document.querySelectorAll('.filter-disclosures details').forEach(details => { details.open = false; });
}

function bindEvents() {
  elements.search.addEventListener("input", (event) => {
    state.query = event.target.value;
    state.sort = state.query.trim() ? 'relevance' : state.userLocation ? 'distance' : 'name';
    state.focusedOrganizationId = "";
    elements.clearSearch.hidden = !state.query;
    window.clearTimeout(searchTimer);
    if (event.isComposing) return;
    searchTimer = window.setTimeout(() => { render(); renderSuggestions(); }, 250);
  });
  elements.search.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault(); submitSearch(suggestionIndex >= 0 && !elements.suggestions.hidden ? searchSuggestions[suggestionIndex] : null);
    } else if (event.key === 'Escape') {
      closeSuggestions();
    } else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      if (elements.suggestions.hidden) renderSuggestions();
      if (!searchSuggestions.length || elements.suggestions.hidden) return;
      suggestionIndex = (suggestionIndex + (event.key === 'ArrowDown' ? 1 : -1) + searchSuggestions.length) % searchSuggestions.length;
      [...elements.suggestions.children].forEach((option, index) => {
        option.setAttribute('aria-selected', String(index === suggestionIndex));
        if (index === suggestionIndex) { elements.search.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' }); }
      });
    }
  });
  elements.search.addEventListener('focus', () => { closeFilterMenus(); if (elements.search.value) renderSuggestions(); });
  elements.search.addEventListener('blur', () => { window.clearTimeout(searchTimer); closeSuggestions(); });
  elements.clearSearch.addEventListener('click', clearSearch);
  elements.state.addEventListener("change", (event) => {
    state.stateCode = event.target.value;
    render();
    closeSuggestions();
    const place = places.find(p => p.type === 'state' && p.code === state.stateCode);
    if (place) fitPlace(place);
  });
  elements.radius.addEventListener("change", (event) => {
    state.radius = event.target.value;
    if (state.radius) state.sort = "distance";
    render();
    fitResults();
  });
  elements.sort.addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });
  elements.locate.addEventListener("click", locateUser);
  elements.locateMobile.addEventListener("click", locateUser);
  elements.filterButton.addEventListener("click", () => document.body.classList.add("filters-open"));
  elements.closeFilters.addEventListener("click", closeFilters);
  elements.filterOverlay.addEventListener("click", closeFilters);
  elements.showResults.addEventListener("click", () => {
    closeFilters();
    mobileSheet?.collapse();
  });
  elements.clearFiltersMobile.addEventListener("click", clearAllFilters);
  elements.fitResults.addEventListener("click", fitResults);
  elements.closeDetail.addEventListener("click", closeDetails);
  elements.detail.addEventListener("cancel", event => { event.preventDefault(); closeDetails(); });
  elements.detail.addEventListener("close", closeDetails);
  elements.detail.addEventListener("click", event => { if (event.target === elements.detail) closeDetails(); });
  elements.detailMap.addEventListener("click", () => {
    const organization = state.selectedOrganization;
    closeDetails();
    if (!organization?.location) return;
    mobileSheet?.collapse();
    map.invalidateSize();
    const zoom = organization.location.precision === "state" ? 5 : organization.location.precision === "place" ? 11 : 13;
    map.setView([organization.location.lat, organization.location.lng], zoom);
    const bottomInset = mobileSheet?.inset() || 0;
    if (bottomInset) map.panBy([0, bottomInset / 2], { animate: false });
    markersById.get(organization.id)?.openTooltip();
  });
  elements.detailShare.addEventListener("click", async () => {
    const organization = state.selectedOrganization;
    if (!organization) return;
    const url = `${window.location.origin}${organizationUrl(organization)}`;
    try {
      if (navigator.share) await navigator.share({ title: organization.name, url });
      else { await navigator.clipboard.writeText(url); showToast("Listing link copied."); }
    } catch (error) { if (error.name !== "AbortError") showToast("Could not share this listing."); }
  });
  window.addEventListener("popstate", () => {
    parseUrlState();
    const id = listingIdFromLocation();
    const organization = state.organizations.find(item => item.id === id || item.slug === id);
    state.selectedOrganization = organization || null;
    refreshCheckboxes();
    render();
    if (state.initialView && map?.setView) restoreMapView(state.initialView);
    if (organization) showDetails(organization, false);
    else {
      state.selectedOrganization = null;
      elements.detail.close();
      document.title = "Grain List";
      document.querySelector('link[rel="canonical"]')?.setAttribute("href", `${window.location.origin}/`);
    }
  });
  elements.share.addEventListener("click", async () => {
    const shareData = { title: "Grain List", text: "Explore grain organizations", url: window.location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(window.location.href);
        showToast("Link copied.");
      }
    } catch (error) {
      if (error.name !== "AbortError") showToast("Could not share this view.");
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeFilters();
  });
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.filter-disclosures')) closeFilterMenus();
  });
}

async function start() {
  parseUrlState();
  bindEvents();
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`Data request failed (${response.status})`);
    const payload = await response.json();
    state.organizations = payload.organizations.map((organization) => ({
      ...organization,
      searchText: normalized([
        organization.name,
        organization.category,
        organization.state,
        organization.city,
        organization.address,
        ...organization.functions,
        ...organization.grains,
      ].join(" ")),
    }));
    elements.datasetSummary.textContent = `${payload.summary.total.toLocaleString()} active organizations · ${payload.summary.mapped.toLocaleString()} mapped`;
    const shell = document.querySelector("#map-app-shell");
    if (shell) {
      document.querySelector("#static-profile-content").hidden = true;
      document.body.classList.remove("document-page");
      document.body.dataset.mobileView = "map";
      shell.hidden = false;
    }
    initializeMap();
    mobileSheet = initializeMobileSheet();
    initializeControls();
    initializeSearch();
    render();
    if (state.initialView) restoreMapView(state.initialView);
    else if (searchIntent().place) fitPlace(searchIntent().place);
    else fitResults();
    focusLinkedOrganization();
    window.lucide?.createIcons();
  } catch (error) {
    console.error(error);
    elements.datasetSummary.textContent = "Directory unavailable";
    elements.results.innerHTML = `<div class="empty-results"><strong>We could not load Grain List</strong><span>Please refresh and try again.</span></div>`;
  }
}

start();
