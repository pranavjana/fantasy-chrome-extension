# Fantasy Chrome Extension

Basic Manifest V3 extension harness migrated from the `fantasy-world-cup` app shape.

## What works

- Chrome side panel chat UI sends agent turns to the background service worker.
- Background owns the agent loop and can call OpenRouter, OpenAI, or Anthropic directly when the matching API key is saved.
- Tinyfish tools are wired into the OpenRouter tool loop:
  - `tinyfish_search`
  - `tinyfish_fetch`
- Content script can return a lightweight page snapshot now and is the place to add direct fantasy-site player JSON extraction later.
- If the selected model provider is not configured, the popup still proves the communication harness with a local fallback response.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder: `/Users/pranavjanakiraman/Documents/fantasy-chrome-extension`.
5. Click the extension icon to open the side panel and save keys if you want live agent/tool calls.

## Configuration

Open the side panel, expand Settings, and save:

- `LLM_PROVIDER`: choose OpenRouter, OpenAI, or Anthropic in the settings dropdown
- `OPENROUTER_API_KEY`
- optional `OPENROUTER_MODEL`, defaults to `anthropic/claude-3.5-haiku`
- `OPENAI_API_KEY`
- optional `OPENAI_MODEL`, defaults to `gpt-5.4-mini`
- `ANTHROPIC_API_KEY`
- optional `ANTHROPIC_MODEL`, defaults to `claude-haiku-4-5-20251001`
- `TINYFISH_API_KEY`

Keys are stored in `chrome.storage.local` for local development.
