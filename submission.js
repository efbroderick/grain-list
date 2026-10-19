(() => {
  const form = document.querySelector("#listing-form");
  if (!form) return;
  const type = document.querySelector("#suggestion-type");
  const title = document.querySelector("#contribution-title");
  const status = document.querySelector("#page-status");
  const labels = { addition: "Add an organization", correction: "Correct a listing", closure: "Report a closure" };
  const params = new URLSearchParams(window.location.search);
  const edited = new Set();
  for (const input of form.querySelectorAll("input,select,textarea")) {
    input.addEventListener("input", () => edited.add(input.id));
    input.addEventListener("change", () => edited.add(input.id));
  }
  const requestedType = params.get("type");
  if (Object.hasOwn(labels, requestedType)) type.value = requestedType;
  function updateTitle() { title.textContent = labels[type.value]; }
  type.addEventListener("change", updateTitle);
  updateTitle();

  function prepareDraft() {
    if (!form.reportValidity()) return null;
    const email = window.GRAIN_LIST_CONFIG?.contactEmail?.trim();
    if (!email) { status.textContent = "Email delivery is unavailable. Please try again later."; return null; }
    const data = new FormData(form);
    const name = String(data.get("organization") || "").trim();
    const details = String(data.get("details") || "").trim();
    if (!name || !details) { status.textContent = "Please include the organization name and details."; return null; }
    const subject = `[Grain List] ${labels[type.value]}: ${name}`;
    const body = [
      `Suggestion: ${labels[type.value]}`, `Organization: ${name}`,
      `Website or social profile: ${data.get("url") || "Not provided"}`,
      `State: ${data.get("state") || "Not provided"}`, `City or address: ${data.get("address") || "Not provided"}`,
      `Functions: ${data.getAll("functions").join(", ") || "Not provided"}`,
      `Grains: ${data.get("grains") || "Not provided"}`, "", "Details / local grain connection:", details, "",
      `Supporting source: ${data.get("source") || "Not provided"}`, `Submitted by: ${data.get("name") || "Not provided"}`,
      `Reply email: ${data.get("email") || "Not provided"}`,
      ...(params.get("organization") ? [`Listing: ${window.location.origin}/organizations/${encodeURIComponent(params.get("organization"))}/`] : []),
    ].join("\n");
    return { email, subject, body, mailto: `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
  }
  function showDelivery(draft, copied) {
    document.querySelector("#delivery-status").hidden = false;
    document.querySelector("#delivery-heading").textContent = copied ? "Suggestion copied" : "Your email draft is ready";
    document.querySelector("#delivery-message").textContent = copied
      ? "Paste it into an email and send it to the address below. Nothing has been sent yet."
      : "Send the draft from your email app to complete your suggestion. If no draft opened, copy the text below and email it. Nothing has been sent by this website.";
    const link = document.querySelector("#delivery-email");
    link.href = `mailto:${draft.email}`;
    link.textContent = draft.email;
    document.querySelector("#delivery-draft").value = `Subject: ${draft.subject}\n\n${draft.body}`;
    status.textContent = "";
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    const draft = prepareDraft();
    if (!draft) return;
    showDelivery(draft, false);
    // Avoid browser/email-client URL limits; the complete text is always retained for copying.
    if (draft.mailto.length <= 1800) window.location.href = draft.mailto;
    else document.querySelector("#delivery-message").textContent = "This suggestion is too long to open reliably as an email link. Copy the full draft below and email it. Nothing has been sent yet.";
  });
  document.querySelector("#copy-submission").addEventListener("click", async () => {
    const draft = prepareDraft();
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      showDelivery(draft, true);
    } catch {
      showDelivery(draft, false);
      document.querySelector("#delivery-message").textContent = "Copy the text below and email it. Nothing has been sent yet.";
      document.querySelector("#delivery-draft").focus();
      document.querySelector("#delivery-draft").select();
    }
  });
  const id = params.get("organization");
  if (id && /^grain-[a-f0-9]{16}$/.test(id)) {
    // A reader may start typing while the request is in flight; never replace their edits.
    fetch("/data/organizations.json?version=__DATA_VERSION__").then(response => {
      if (!response.ok) throw new Error("Directory unavailable");
      return response.json();
    }).then(payload => {
      const organization = payload.organizations.find(item => item.id === id);
      if (!organization) { status.textContent = "That listing was not found. You can enter its details below."; return; }
      for (const [selector, value] of [["#organization-name", organization.name], ["#organization-url", organization.url], ["#organization-state", organization.state], ["#organization-address", organization.address]]) {
        const input = document.querySelector(selector);
        if (!edited.has(input.id) && !input.value) input.value = value || "";
      }
    }).catch(() => { status.textContent = "We could not load the existing listing. You can enter its details below."; });
  }
})();
