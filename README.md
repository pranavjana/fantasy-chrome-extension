# Fantasy Chrome Extension

Basic Manifest V3 extension harness migrated from the `fantasy-world-cup` app shape.

## What works

- Chrome side panel chat UI sends agent turns to the background service worker.
- Background owns the agent loop and calls OpenRouter directly when an API key is saved.
- Tinyfish tools are wired into the OpenRouter tool loop:
  - `tinyfish_search`
  - `tinyfish_fetch`
- Content script can return a lightweight page snapshot now and is the place to add direct fantasy-site player JSON extraction later.
- If OpenRouter is not configured, the popup still proves the communication harness with a local fallback response.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder: `/Users/pranavjanakiraman/Documents/fantasy-chrome-extension`.
5. Click the extension icon to open the side panel and save keys if you want live agent/tool calls.

## Configuration

Open the side panel, expand Settings, and save:

- `OPENROUTER_API_KEY`
- optional `OPENROUTER_MODEL`, defaults to `anthropic/claude-3.5-haiku`
- `TINYFISH_API_KEY`

Keys are stored in `chrome.storage.local` for local development.
