window.lucide?.createIcons();
document.querySelector("#share-listing")?.addEventListener("click", async () => {
  const status = document.querySelector("#page-status");
  const url = document.querySelector('link[rel="canonical"]').href;
  try {
    if (navigator.share) await navigator.share({ title: document.title, url });
    else {
      await navigator.clipboard.writeText(url);
      status.textContent = "Listing link copied.";
    }
  } catch (error) {
    if (error.name !== "AbortError") status.textContent = "Could not share automatically. You can copy this page's address.";
  }
});
