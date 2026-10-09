# Add Grain List to a Home Screen

The smartphone icon in the header opens device-specific installation options.
Android/Chromium uses the native prompt when the browser offers one, otherwise
the dialog shows browser-menu instructions. iPhone/iPad show Safari's Share >
Add to Home Screen flow. The control is hidden when launched as an installed
standalone app. No installation prompt appears without a user's click.

The manifest supplies the wheat logo, stable app identity, and standalone
launch mode. The app needs an internet connection; no service worker or offline
directory cache is added. Data continues to follow the normal publication
refresh, without introducing a second persistent dataset.

## Test

Run `make test` (or `node --test tests/test_install.cjs` for installation logic).
Regression cases cover Apple/Android, native acceptance/cancellation/failure,
installed mode, repeated prompt protection, and required manifest/icon sizes.

On actual phones, use the stable public production URL, not a deployment-specific
preview or a login-protected URL. On iPhone, open Safari, tap the smartphone
button, follow the Share steps, and launch the icon. On Android Chrome, install
from the dialog or browser menu, then launch the icon. Verify that map/search
work and the install control is hidden. Also confirm that ordinary browser
visits still work. Native prompts depend on browser eligibility; mobile browser
emulation alone does not establish that a real device will offer installation.

## References

- [Apple: turn a website into an app](https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios)
- [MDN: installability and platform support](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [MDN: native install prompt](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt)
