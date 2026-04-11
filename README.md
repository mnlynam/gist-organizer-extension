# Gist Organizer

A Chrome extension that replaces the flat GitHub Gist list with a project-based file explorer. Each gist becomes a project tile, and clicking it opens a left-panel file navigator with a syntax-highlighted code editor.

## Features

- **Project tiles** — gists displayed as a clean tile grid, grouped by description
- **File explorer layout** — left-panel file tree with a full code editor
- **Syntax-highlighted editor** — CodeMirror with dark theme, line numbers, bracket matching
- **Markdown rendering** — `.md` files show rendered HTML by default with an Edit button
- **Inline saving** — saves directly to GitHub using the native gist form mechanism
- **Unsaved changes protection** — dot indicator, confirmation prompts, browser unload warning
- **Keyboard shortcuts** — Ctrl+S to save, Escape to go back
- **Zero-flicker** — hides original page before it renders
- **Works for any user** — visit any `gist.github.com/{user}` page

## How grouping works

Each gist's **description** is used as the project name. Gists with the same description share a tile. To group gists into one project, give them the same description.

## Install

Install from the [Chrome Web Store](#) or load unpacked:

1. Clone this repo
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select this directory

## Privacy

Gist Organizer does not collect, store, or transmit any personal data.
See the [privacy policy](https://mnlynam.github.io/gist-organizer-extension/privacy/)
(canonical source: [PRIVACY.md](PRIVACY.md)).

## Support

If you find this useful, consider [buying me a coffee](https://buymeacoffee.com/matthew81).
