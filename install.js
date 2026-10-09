(() => {
  const button = document.querySelector("#install-button");
  const dialog = document.querySelector("#install-dialog");
  const intro = document.querySelector("#install-intro");
  const steps = document.querySelector("#install-steps");
  const status = document.querySelector("#install-status");
  const nativeButton = document.querySelector("#native-install");
  const standalone = window.matchMedia("(display-mode: standalone)");
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(navigator.userAgent);
  let installPrompt = null;
  let installed = false;
  let prompting = false;

  function isInstalled() {
    return installed || standalone.matches || navigator.standalone === true;
  }

  function render() {
    button.hidden = isInstalled() || (!apple && !android && !installPrompt);
    nativeButton.hidden = !installPrompt || prompting || isInstalled();
    let instructions;
    if (installPrompt && !apple) {
      intro.textContent = "Add Grain List to your device.";
      instructions = ["Tap Install Grain List below.", "Confirm the installation in your browser."];
    } else if (apple) {
      intro.textContent = "In Safari on your iPhone or iPad:";
      instructions = [
        "Open the Share menu. Depending on your Safari layout, tap Share directly or open the page menu, then Share.",
        "Choose Add to Home Screen. If it is missing, use Edit Actions to add it.",
        "Leave Open as Web App enabled if shown, then tap Add.",
      ];
    } else if (android) {
      intro.textContent = "In Chrome on Android:";
      instructions = [
        "Open the browser menu (the three dots).",
        "Choose Add to Home screen or Install app.",
        "Confirm Add or Install. If the option is unavailable, open this page in Chrome rather than an in-app browser.",
      ];
    } else {
      intro.textContent = "In Chrome or Edge on your computer:";
      instructions = ["Open the browser menu.", "Choose Install Grain List or the option to install this page as an app.", "Confirm the installation."];
    }
    steps.replaceChildren(...instructions.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }));
    if (isInstalled() && dialog.open) dialog.close();
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    if (isInstalled()) return;
    event.preventDefault();
    installPrompt = event;
    render();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    installPrompt = null;
    render();
  });
  standalone.addEventListener("change", render);
  button.addEventListener("click", () => {
    status.textContent = "";
    render();
    if (!isInstalled()) dialog.showModal();
  });
  for (const id of ["close-install", "dismiss-install"]) {
    document.querySelector(`#${id}`).addEventListener("click", () => dialog.close());
  }
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  nativeButton.addEventListener("click", async () => {
    if (!installPrompt || prompting) return;
    const prompt = installPrompt;
    installPrompt = null;
    prompting = true;
    nativeButton.disabled = true;
    status.textContent = "";
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") {
        installed = true;
        dialog.close();
      } else {
        status.textContent = "Installation canceled. You can add Grain List later from your browser menu.";
      }
    } catch {
      status.textContent = "The install prompt could not open. Use your browser menu to add Grain List.";
    } finally {
      prompting = false;
      nativeButton.disabled = false;
      render();
    }
  });
  render();
})();
