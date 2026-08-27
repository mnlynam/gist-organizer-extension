# Privacy Policy for Gist Organizer

_Last updated: April 11, 2026_

This Privacy Policy describes how the **Gist Organizer** Chrome extension
("the Extension") handles information. The Extension is published on the
Chrome Web Store under the item ID `iciendbcnpjibknlfmlpnjpmmnoefbkm`.

## Summary

**The Gist Organizer extension does not collect, store, transmit, sell, or
share any personal or sensitive user data.** It runs entirely in your
browser and only interacts with pages on `https://gist.github.com/` that you
visit yourself.

## What the Extension does

Gist Organizer is a purely client-side user-interface enhancement for
GitHub Gist. When you load a page on `https://gist.github.com/{user}`, the
Extension:

1. Restyles the page to display your gists as project tiles and a
   file-tree based explorer.
2. Loads a syntax-highlighted code editor (CodeMirror) bundled inside the
   extension package — no remote scripts are fetched.
3. Requests gist content from the same `gist.github.com` origin that you
   are already viewing, using your existing GitHub session, in order to
   display and edit files. These requests are first-party requests to
   GitHub and are subject to
   [GitHub's own Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

The Extension does not inject, load, or communicate with any third-party
server, analytics provider, advertising network, or tracking service.

## Data collection

The Extension does **not** collect any of the following categories of
data defined by the Chrome Web Store User Data Policy:

- Personally identifiable information (name, email, address, phone, ID
  numbers, etc.)
- Health or financial information
- Authentication information (passwords, credentials, security tokens)
- Personal communications (emails, texts, chat messages)
- Location data
- Web history or browsing activity
- User activity (clicks, mouse position, keystrokes)
- Website content other than the gist data that the Extension displays
  locally in your browser for the sole purpose of rendering the UI

No data of any kind is sent to the developer or to any third party.

## Permissions

The Extension declares the minimum permissions needed to function:

- `host_permissions: ["https://gist.github.com/*"]` — required so that
  the content script can run on GitHub Gist pages and request gist
  content from the same origin to render the file explorer and editor.

It does **not** request `storage`, `tabs`, `cookies`, `webRequest`,
`identity`, `<all_urls>`, or any other permission.

## Local storage

The Extension does not use `chrome.storage`, `localStorage`,
`sessionStorage`, IndexedDB, or cookies to persist user data. All state
exists only in the memory of the current page and is discarded when the
tab is closed.

## Remote code

The Extension does not load or execute any remote code. All JavaScript
and CSS — including CodeMirror — is bundled inside the extension package
that you install from the Chrome Web Store.

## Children's privacy

The Extension is not directed at children under 13 and does not
knowingly collect any information from them (and in fact does not
collect information from anyone).

## Changes to this policy

If this policy is updated, the new version will be committed to this
same file in the public repository at
<https://github.com/mnlynam/gist-organizer-extension/blob/master/PRIVACY.md>
and the "Last updated" date above will be revised. Continued use of the
Extension after an update constitutes acceptance of the revised policy.

## Contact

If you have any questions about this Privacy Policy or the Extension's
data practices, please contact:

**Matthew Lynam** — <mnlynam@gmail.com>

You may also open an issue at
<https://github.com/mnlynam/gist-organizer-extension/issues>.
