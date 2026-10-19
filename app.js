const DATA_URL = "/data/organizations.json";
const USA_VIEW = { center: [39.5, -98.35], zoom: 4 };
const MAX_VISIBLE_RESULTS = 250;

const elements = {
  search: document.querySelector("#search-input"),
  clearSearch: document.querySelector("#clear-search"),
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
};

let map;
let markerLayer;
let userMarker;
const markersById = new Map();
let lastFiltered = [];
let toastTimer;

function normalized(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
    className: "",
    html: `<span class="grain-marker ${markerClass(organization)}"></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  });
}

function initializeMap() {
  map = L.map("map", {
    center: USA_VIEW.center,
    zoom: USA_VIEW.zoom,
    minZoom: 3,
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
  L.layerGroup([lightBase, lightLabels]).addTo(map);
  markerLayer = L.markerClusterGroup({
    chunkedLoading: true,
    showCoverageOnHover: false,
    maxClusterRadius: 42,
    spiderfyOnMaxZoom: true,
    iconCreateFunction(cluster) {
      const count = cluster.getChildCount();
      const size = count < 10 ? "small" : count < 50 ? "medium" : "large";
      const dimension = count < 10 ? 38 : count < 50 ? 46 : 54;
      return L.divIcon({
        className: "",
        html: `<span class="grain-cluster grain-cluster-${size}"><strong>${count}</strong></span>`,
        iconSize: [dimension, dimension],
      });
    },
  });
  map.addLayer(markerLayer);
  map.on("moveend", () => {
    renderViewportResults();
  });
}

function listingIdFromLocation() {
  const route = window.location.pathname.match(/^\/organizations\/(grain-[a-f0-9]{16})\/?$/);
  return route?.[1] || new URLSearchParams(window.location.search).get("organization") || "";
}

function parseUrlState() {
  const params = new URLSearchParams(window.location.search);
  state.query = params.get("q") || "";
  state.stateCode = params.get("state") || "";
  state.functions = new Set((params.get("functions") || "").split("|").filter(Boolean));
  state.grains = new Set((params.get("grains") || "").split("|").filter(Boolean));
  state.radius = params.get("radius") || "";
  state.focusedOrganizationId = listingIdFromLocation();
}

function updateUrl() {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.stateCode) params.set("state", state.stateCode);
  if (state.functions.size) params.set("functions", [...state.functions].sort().join("|"));
  if (state.grains.size) params.set("grains", [...state.grains].sort().join("|"));
  if (state.radius && state.userLocation) params.set("radius", state.radius);
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
      fitResults();
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
  const terms = normalized(state.query).split(" ").filter(Boolean);
  return terms.every((term) => organization.searchText.includes(term));
}

function matchesSelection(values, selected) {
  return selected.size === 0 || values.some((value) => selected.has(value));
}

function filteredOrganizations(ignoreBounds = false) {
  const bounds = !ignoreBounds && map ? map.getBounds() : null;
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
      if (a.distance == null) return 1;
      if (b.distance == null) return -1;
      return a.distance - b.distance || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });
  return results;
}

function renderMarkers(organizations) {
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
  return button;
}

function organizationUrl(organization) {
  return `/organizations/${encodeURIComponent(organization.id)}/`;
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
  elements.results.replaceChildren();
  if (!organizations.length) {
    const empty = document.createElement("div");
    empty.className = "empty-results";
    empty.innerHTML = `
      <i data-lucide="search-x" aria-hidden="true"></i>
      <strong>No organizations match</strong>
      <span>Clear a filter or try a broader search.</span>
    `;
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
      fitResults();
    }));
  }
  window.lucide?.createIcons();
}

function renderViewportResults() {
  const visible = filteredOrganizations();
  const mapped = visible.filter((item) => item.location).length;
  elements.resultCount.textContent = pluralize(visible.length, "organization");
  elements.mappedCount.textContent = `${mapped.toLocaleString()} mapped`;
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
  const organization = state.organizations.find(item => item.id === state.focusedOrganizationId);
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
  map.fitBounds(bounds, { padding: [38, 38], maxZoom: 12 });
}

function locateUser() {
  if (!navigator.geolocation) {
    showToast("Location is not available in this browser.");
    return;
  }
  setLocationButtonsDisabled(true);
  navigator.geolocation.getCurrentPosition(
    (position) => {
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
      showToast("Showing organizations within 50 miles.");
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

function closeFilters() {
  document.body.classList.remove("filters-open");
}

function bindEvents() {
  let searchTimer;
  elements.search.addEventListener("input", (event) => {
    state.query = event.target.value;
    state.focusedOrganizationId = "";
    elements.clearSearch.hidden = !state.query;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => { render(); fitResults(); }, 120);
  });
  elements.clearSearch.addEventListener("click", () => {
    state.query = "";
    elements.search.value = "";
    elements.search.focus();
    render();
    fitResults();
  });
  elements.state.addEventListener("change", (event) => {
    state.stateCode = event.target.value;
    render();
    fitResults();
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
    document.body.dataset.mobileView = "list";
    syncMobileViewButtons();
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
    document.body.dataset.mobileView = "map";
    syncMobileViewButtons();
    map.invalidateSize();
    const zoom = organization.location.precision === "state" ? 5 : organization.location.precision === "place" ? 11 : 13;
    map.setView([organization.location.lat, organization.location.lng], zoom);
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
    const id = listingIdFromLocation();
    const organization = state.organizations.find(item => item.id === id);
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
  document.querySelectorAll(".view-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.body.dataset.mobileView = button.dataset.view;
      syncMobileViewButtons();
      if (button.dataset.view === "map") window.setTimeout(() => map.invalidateSize(), 50);
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeFilters();
  });
}

function syncMobileViewButtons() {
  document.querySelectorAll(".view-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === document.body.dataset.mobileView);
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
    initializeControls();
    render();
    fitResults();
    focusLinkedOrganization();
    window.lucide?.createIcons();
  } catch (error) {
    console.error(error);
    elements.datasetSummary.textContent = "Directory unavailable";
    elements.results.innerHTML = `<div class="empty-results"><strong>We could not load Grain List</strong><span>Please refresh and try again.</span></div>`;
  }
}

start();
