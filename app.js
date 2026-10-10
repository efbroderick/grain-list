const DATA_URL = "./data/organizations.json";
const USA_VIEW = { center: [39.5, -98.35], zoom: 4 };
const MAX_VISIBLE_RESULTS = 250;

function configuredContactEmail() {
  return window.GRAIN_LIST_CONFIG?.contactEmail?.trim() || "";
}

const elements = {
  search: document.querySelector("#search-input"),
  clearSearch: document.querySelector("#clear-search"),
  state: document.querySelector("#state-filter"),
  radius: document.querySelector("#radius-filter"),
  verified: document.querySelector("#verified-filter"),
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
  contribute: document.querySelector("#contribute-button"),
  share: document.querySelector("#share-button"),
  filterButton: document.querySelector("#filter-button"),
  filterCount: document.querySelector("#filter-count"),
  closeFilters: document.querySelector("#close-filters"),
  filterOverlay: document.querySelector("#filter-overlay"),
  clearFiltersMobile: document.querySelector("#clear-filters-mobile"),
  showResults: document.querySelector("#show-results"),
  mapArea: document.querySelector("#map-area-button"),
  fitResults: document.querySelector("#fit-results-button"),
  mapEmpty: document.querySelector("#map-empty"),
  detail: document.querySelector("#detail-dialog"),
  detailName: document.querySelector("#detail-name"),
  detailCategory: document.querySelector("#detail-category"),
  detailContent: document.querySelector("#detail-content"),
  detailWebsite: document.querySelector("#detail-website"),
  detailMap: document.querySelector("#detail-map-button"),
  detailSuggest: document.querySelector("#detail-suggest-button"),
  closeDetail: document.querySelector("#close-detail"),
  contributeDialog: document.querySelector("#contribute-dialog"),
  contributeForm: document.querySelector("#contribute-form"),
  contributeTitle: document.querySelector("#contribute-title"),
  submissionType: document.querySelector("#submission-type"),
  submissionOrganization: document.querySelector("#submission-organization"),
  submissionDetails: document.querySelector("#submission-details"),
  submissionSource: document.querySelector("#submission-source"),
  submissionName: document.querySelector("#submission-name"),
  submissionEmail: document.querySelector("#submission-email"),
  closeContribute: document.querySelector("#close-contribute"),
  cancelContribute: document.querySelector("#cancel-contribute"),
  toast: document.querySelector("#toast"),
};

const state = {
  organizations: [],
  query: "",
  stateCode: "",
  functions: new Set(),
  grains: new Set(),
  verifiedOnly: false,
  radius: "",
  sort: "name",
  boundsOnly: false,
  userLocation: null,
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
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 16,
    attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
  }).addTo(map);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 16,
    pane: "shadowPane",
  }).addTo(map);
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
    if (state.boundsOnly) render();
  });
}

function parseUrlState() {
  const params = new URLSearchParams(window.location.search);
  state.query = params.get("q") || "";
  state.stateCode = params.get("state") || "";
  state.functions = new Set((params.get("functions") || "").split("|").filter(Boolean));
  state.grains = new Set((params.get("grains") || "").split("|").filter(Boolean));
  state.verifiedOnly = params.get("verified") === "1";
  state.radius = params.get("radius") || "";
}

function updateUrl() {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.stateCode) params.set("state", state.stateCode);
  if (state.functions.size) params.set("functions", [...state.functions].sort().join("|"));
  if (state.grains.size) params.set("grains", [...state.grains].sort().join("|"));
  if (state.verifiedOnly) params.set("verified", "1");
  if (state.radius && state.userLocation) params.set("radius", state.radius);
  const query = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
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
  elements.verified.checked = state.verifiedOnly;
  elements.sort.value = state.sort;
  elements.sort.options.namedItem?.("distance");
  elements.sort.querySelector('option[value="distance"]').disabled = !state.userLocation;
  elements.functionSummary.textContent = state.functions.size ? `${state.functions.size} selected` : "All";
  elements.grainSummary.textContent = state.grains.size ? `${state.grains.size} selected` : "All";
  const filterCount = Number(Boolean(state.stateCode)) + state.functions.size + state.grains.size + Number(state.verifiedOnly) + Number(Boolean(state.radius));
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

function filteredOrganizations() {
  const bounds = state.boundsOnly && map ? map.getBounds() : null;
  const radius = state.userLocation && state.radius ? Number(state.radius) : null;
  const results = state.organizations.filter((organization) => {
    if (!matchesQuery(organization)) return false;
    if (state.stateCode && organization.state !== state.stateCode) return false;
    if (!matchesSelection(organization.functions, state.functions)) return false;
    if (!matchesSelection(organization.grains, state.grains)) return false;
    if (state.verifiedOnly && organization.status !== "Verified") return false;
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
  const button = document.createElement("button");
  button.className = "result-item";
  button.type = "button";
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
  button.addEventListener("click", () => showDetails(organization));
  return button;
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
  if (state.verifiedOnly) filters.push(["Verified only", () => { state.verifiedOnly = false; }]);
  if (state.radius) filters.push([`${state.radius} miles`, () => { state.radius = ""; }]);
  if (state.boundsOnly) filters.push(["This map area", () => { state.boundsOnly = false; }]);
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

function render() {
  lastFiltered = filteredOrganizations();
  const mapped = lastFiltered.filter((item) => item.location).length;
  elements.resultCount.textContent = pluralize(lastFiltered.length, "organization");
  elements.mappedCount.textContent = `${mapped.toLocaleString()} mapped`;
  renderResults(lastFiltered);
  renderMarkers(lastFiltered);
  renderActiveFilters();
  syncControls();
  elements.mapArea.classList.toggle("is-active", state.boundsOnly);
  elements.mapArea.querySelector("span").textContent = state.boundsOnly ? "Showing this area" : "Search this area";
  updateUrl();
}

function detailSection(title, content, className = "") {
  const section = document.createElement("section");
  section.className = `detail-section ${className}`.trim();
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading, content);
  return section;
}

function detailDisclosure(title, content, count) {
  const disclosure = document.createElement("details");
  disclosure.className = "detail-section detail-disclosure";
  const summary = document.createElement("summary");
  const label = document.createElement("span");
  label.textContent = title;
  const meta = document.createElement("span");
  meta.className = "detail-disclosure-meta";
  const countLabel = document.createElement("span");
  countLabel.textContent = `${count} ${count === 1 ? "source" : "sources"}`;
  const icon = document.createElement("i");
  icon.dataset.lucide = "chevron-down";
  icon.setAttribute("aria-hidden", "true");
  meta.append(countLabel, icon);
  summary.append(label, meta);
  disclosure.append(summary, content);
  return disclosure;
}

function textBlock(value) {
  const paragraph = document.createElement("p");
  paragraph.textContent = value;
  return paragraph;
}

function tags(values, className = "") {
  const container = document.createElement("div");
  container.className = "tag-list";
  for (const value of values) {
    const tag = document.createElement("span");
    tag.className = `tag ${className}`.trim();
    tag.textContent = value;
    container.append(tag);
  }
  return container;
}

function showDetails(organization) {
  state.selectedOrganization = organization;
  elements.detailName.textContent = organization.name;
  elements.detailCategory.textContent = `${organization.category || "Grain organization"} · ${organization.state}`;
  elements.detailContent.replaceChildren();
  if (organization.functions.length) {
    elements.detailContent.append(detailSection("Functions", tags(organization.functions)));
  }
  if (organization.grains.length) {
    elements.detailContent.append(detailSection("Grains", tags(organization.grains, "grain")));
  }
  const mapNote = locationNote(organization);
  if (mapNote) {
    const note = textBlock(mapNote);
    note.className = "location-note";
    elements.detailContent.append(detailSection("Map location", note));
  }
  const contact = document.createElement("div");
  contact.className = "contact-list";
  if (organization.address) contact.append(textBlock(organization.address));
  if (organization.phone) {
    const link = document.createElement("a");
    link.href = `tel:${organization.phone.replace(/[^\d+]/g, "")}`;
    link.textContent = organization.phone;
    contact.append(link);
  }
  if (organization.email) {
    const link = document.createElement("a");
    link.href = `mailto:${organization.email}`;
    link.textContent = organization.email;
    contact.append(link);
  }
  if (contact.children.length) elements.detailContent.append(detailSection("Contact", contact));
  if (organization.sources.length) {
    const sources = document.createElement("div");
    sources.className = "contact-list";
    for (const [index, url] of organization.sources.entries()) {
      const link = document.createElement("a");
      link.className = "source-link";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      let sourceName = url;
      try {
        sourceName = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        // The public-data validator normally prevents malformed URLs.
      }
      link.textContent = `Source ${index + 1}: ${sourceName}`;
      sources.append(link);
    }
    elements.detailContent.append(detailDisclosure("Sources", sources, organization.sources.length));
  }
  elements.detailWebsite.hidden = !organization.url;
  if (organization.url) elements.detailWebsite.href = organization.url;
  elements.detailMap.hidden = !organization.location;
  elements.detail.showModal();
  window.lucide?.createIcons();
}

function openContribution(organization = null) {
  elements.contributeForm.reset();
  elements.submissionType.value = organization ? "Suggest a correction" : "Add an organization";
  elements.submissionOrganization.value = organization?.name || "";
  elements.submissionSource.value = organization?.url || "";
  elements.contributeTitle.textContent = organization
    ? `Update ${organization.name}`
    : "Add or update a listing";
  if (elements.detail.open) elements.detail.close();
  elements.contributeDialog.showModal();
  window.lucide?.createIcons();
  window.setTimeout(() => {
    if (organization) elements.submissionDetails.focus();
    else elements.submissionOrganization.focus();
  }, 0);
}

function submitContribution(event) {
  event.preventDefault();
  const contactEmail = configuredContactEmail();
  if (!contactEmail) {
    showToast("The contact email has not been configured yet.");
    return;
  }

  const type = elements.submissionType.value;
  const organization = elements.submissionOrganization.value.trim();
  const subject = `[Grain List] ${type}: ${organization}`;
  const body = [
    `Submission type: ${type}`,
    `Organization: ${organization}`,
    "",
    "Details:",
    elements.submissionDetails.value.trim(),
    "",
    `Supporting source: ${elements.submissionSource.value.trim() || "Not provided"}`,
    `Submitted by: ${elements.submissionName.value.trim() || "Not provided"}`,
    `Reply email: ${elements.submissionEmail.value.trim() || "Not provided"}`,
    "",
    `Grain List page: ${window.location.href}`,
  ].join("\n");
  window.location.href = `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  elements.contributeDialog.close();
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
  state.query = "";
  state.stateCode = "";
  state.functions.clear();
  state.grains.clear();
  state.verifiedOnly = false;
  state.radius = "";
  state.boundsOnly = false;
  state.sort = "name";
  renderCheckboxOptions(elements.functions, countsFor("functions"), state.functions, "functions");
  renderCheckboxOptions(elements.grains, countsFor("grains"), state.grains, "grains");
  syncControls();
  render();
}

function closeFilters() {
  document.body.classList.remove("filters-open");
}

function bindEvents() {
  let searchTimer;
  elements.search.addEventListener("input", (event) => {
    state.query = event.target.value;
    elements.clearSearch.hidden = !state.query;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(render, 120);
  });
  elements.clearSearch.addEventListener("click", () => {
    state.query = "";
    elements.search.value = "";
    elements.search.focus();
    render();
  });
  elements.state.addEventListener("change", (event) => {
    state.stateCode = event.target.value;
    state.boundsOnly = false;
    render();
    if (state.stateCode) fitResults();
  });
  elements.radius.addEventListener("change", (event) => {
    state.radius = event.target.value;
    if (state.radius) state.sort = "distance";
    render();
  });
  elements.verified.addEventListener("change", (event) => {
    state.verifiedOnly = event.target.checked;
    render();
  });
  elements.sort.addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });
  elements.locate.addEventListener("click", locateUser);
  elements.locateMobile.addEventListener("click", locateUser);
  elements.contribute.addEventListener("click", () => openContribution());
  elements.filterButton.addEventListener("click", () => document.body.classList.add("filters-open"));
  elements.closeFilters.addEventListener("click", closeFilters);
  elements.filterOverlay.addEventListener("click", closeFilters);
  elements.showResults.addEventListener("click", () => {
    closeFilters();
    document.body.dataset.mobileView = "list";
    syncMobileViewButtons();
  });
  elements.clearFiltersMobile.addEventListener("click", clearAllFilters);
  elements.mapArea.addEventListener("click", () => {
    state.boundsOnly = !state.boundsOnly;
    render();
  });
  elements.fitResults.addEventListener("click", fitResults);
  elements.closeDetail.addEventListener("click", () => elements.detail.close());
  elements.detailSuggest.addEventListener("click", () => openContribution(state.selectedOrganization));
  elements.detail.addEventListener("click", (event) => {
    if (event.target === elements.detail) elements.detail.close();
  });
  elements.closeContribute.addEventListener("click", () => elements.contributeDialog.close());
  elements.cancelContribute.addEventListener("click", () => elements.contributeDialog.close());
  elements.contributeDialog.addEventListener("click", (event) => {
    if (event.target === elements.contributeDialog) elements.contributeDialog.close();
  });
  elements.contributeForm.addEventListener("submit", submitContribution);
  elements.detailMap.addEventListener("click", () => {
    const organization = state.selectedOrganization;
    if (!organization?.location) return;
    elements.detail.close();
    document.body.dataset.mobileView = "map";
    syncMobileViewButtons();
    window.setTimeout(() => {
      map.invalidateSize();
      map.setView([organization.location.lat, organization.location.lng], 13);
      markersById.get(organization.id)?.openTooltip();
    }, 80);
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
  initializeMap();
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
    initializeControls();
    render();
    fitResults();
    window.lucide?.createIcons();
  } catch (error) {
    console.error(error);
    elements.datasetSummary.textContent = "Directory unavailable";
    elements.results.innerHTML = `<div class="empty-results"><strong>We could not load Grain List</strong><span>Please refresh and try again.</span></div>`;
  }
}

start();
