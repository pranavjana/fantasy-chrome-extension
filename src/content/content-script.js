(function () {
if (globalThis.__tinyfishFantasyContentScriptLoaded) {
  return;
}

globalThis.__tinyfishFantasyContentScriptLoaded = true;

function findJsonScriptPayloads() {
  return Array.from(document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__'))
    .map((script, index) => {
      const text = script.textContent || "";
      if (!text.trim()) {
        return null;
      }

      try {
        const parsed = JSON.parse(text);
        return {
          index,
          id: script.id || "",
          text: JSON.stringify(parsed).slice(0, 5000)
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, 3);
}

function capturePageContext() {
  return {
    title: document.title,
    url: location.href,
    selection: String(getSelection() || "").slice(0, 2000),
    jsonPayloads: findJsonScriptPayloads()
  };
}

const FANTASY_POSITIONS = new Set(["GK", "DEF", "MID", "FWD"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isVisible(element) {
  if (!element || !(element instanceof Element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    Number(style.opacity || 1) !== 0;
}

function findPositionSlot(position) {
  const normalizedPosition = String(position || "").trim().toUpperCase();
  if (!FANTASY_POSITIONS.has(normalizedPosition)) {
    throw new Error("position must be one of GK, DEF, MID, or FWD.");
  }

  const exactPositionLabels = Array.from(document.querySelectorAll("div, span"))
    .filter((element) => isVisible(element) && element.textContent?.trim() === normalizedPosition);

  for (const label of exactPositionLabels) {
    const emptyCard = label.closest(".empty-card");
    const scopedButton = emptyCard?.querySelector('button[aria-label="Add Player"], button');
    if (isVisible(scopedButton)) {
      return { label, button: scopedButton };
    }

    let node = label.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 6; depth += 1) {
      const button = node.querySelector?.('button[aria-label="Add Player"], button');
      if (isVisible(button) && node.textContent?.includes(normalizedPosition)) {
        return { label, button };
      }
      node = node.parentElement;
    }
  }

  return null;
}

function findVisiblePlayerNameElement(playerName) {
  const normalizedPlayerName = normalizeText(playerName);
  const leafElements = Array.from(document.querySelectorAll("*"))
    .filter((element) => isVisible(element) && element.children.length === 0);

  return leafElements.find((element) => normalizeText(element.textContent) === normalizedPlayerName) ||
    leafElements.find((element) => normalizeText(element.textContent).includes(normalizedPlayerName));
}

function hasClassToken(element, token) {
  return Array.from(element?.classList || []).includes(token);
}

function closestWithClassToken(element, token) {
  let node = element;
  while (node && node !== document.body) {
    if (hasClassToken(node, token)) {
      return node;
    }
    node = node.parentElement;
  }

  return null;
}

function findActionColumnButton(row) {
  const actionChild = Array.from(row.children)
    .find((child) => hasClassToken(child, "action"));
  const actionButton = actionChild?.querySelector?.("button");

  if (isVisible(actionButton)) {
    return actionButton;
  }

  const rowRect = row.getBoundingClientRect();
  const visibleButtons = Array.from(row.querySelectorAll("button"))
    .filter(isVisible)
    .filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.left > rowRect.left + (rowRect.width * 0.65);
    });

  return visibleButtons
    .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0] || null;
}

function findPlayerActionButton(playerName) {
  const nameElement = findVisiblePlayerNameElement(playerName);
  if (!nameElement) {
    return null;
  }

  let row = nameElement.parentElement;
  for (let depth = 0; row && row !== document.body && depth < 8; depth += 1) {
    const text = row.textContent || "";
    const hasPlayer = normalizeText(text).includes(normalizeText(playerName));
    const hasPrice = /\$\d/.test(text);
    const actionButton = findActionColumnButton(row);

    if (hasPlayer && hasPrice && actionButton) {
      return { nameElement, row, button: actionButton };
    }

    row = row.parentElement;
  }

  return null;
}

function findPlayerSearchInput() {
  return Array.from(document.querySelectorAll('input[name="search"], input[placeholder*="Search" i]'))
    .find(isVisible) || null;
}

function setNativeInputValue(input, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(input, "value")?.set;
  const prototype = Object.getPrototypeOf(input);
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(input, value);
  } else if (valueSetter) {
    valueSetter.call(input, value);
  } else {
    input.value = value;
  }
}

function dispatchInputEvents(input) {
  input.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: input.value
  }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function findFilterButton() {
  const playerPoolButtons = Array.from(document.querySelectorAll("button"))
    .filter(isVisible)
    .filter((button) => button.querySelector("svg.active, svg[width='32'][height='32']"))
    .filter((button) => {
      const sidebar = closestWithClassToken(button, "sidebar");
      if (sidebar?.textContent?.includes("PLAYER POOL")) {
        return true;
      }

      let node = button.parentElement;
      for (let depth = 0; node && node !== document.body && depth < 8; depth += 1) {
        if (node.textContent?.includes("PLAYER POOL")) {
          return true;
        }
        node = node.parentElement;
      }

      return false;
    });

  if (playerPoolButtons.length) {
    return playerPoolButtons
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return (aRect.top - bRect.top) || (aRect.left - bRect.left);
      })[0];
  }

  const playerPoolTitle = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, div, span"))
    .find((element) => isVisible(element) && element.textContent?.trim().toUpperCase() === "PLAYER POOL");

  let header = playerPoolTitle;
  for (let depth = 0; header && header !== document.body && depth < 5; depth += 1) {
    const buttons = Array.from(header.querySelectorAll("button")).filter(isVisible);
    if (buttons.length) {
      return buttons
        .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0];
    }

    header = header.parentElement;
  }

  return null;
}

async function ensurePlayerSearchOpen() {
  let input = findPlayerSearchInput();
  if (input) {
    return input;
  }

  const filterButton = findFilterButton();
  if (filterButton) {
    filterButton.click();
    await sleep(350);
    input = findPlayerSearchInput();
  }

  return input;
}

async function searchPlayerPool(playerName) {
  const input = await ensurePlayerSearchOpen();
  if (!input) {
    return { action: null, attempted: false };
  }

  input.focus();
  setNativeInputValue(input, "");
  dispatchInputEvents(input);
  await sleep(100);

  setNativeInputValue(input, playerName);
  dispatchInputEvents(input);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(250);
    const playerAction = findPlayerActionButton(playerName);
    if (playerAction) {
      return {
        action: {
          ...playerAction,
          searched: true
        },
        attempted: true
      };
    }
  }

  return { action: null, attempted: true };
}

async function addFantasyPlayer({ playerName, position }) {
  const cleanPlayerName = String(playerName || "").trim();
  const cleanPosition = String(position || "").trim().toUpperCase();

  if (!cleanPlayerName) {
    throw new Error("playerName is required.");
  }

  let playerAction = findPlayerActionButton(cleanPlayerName);
  let openedPosition = false;

  if (!playerAction && cleanPosition) {
    const slot = findPositionSlot(cleanPosition);
    if (!slot) {
      throw new Error(`Could not find an empty ${cleanPosition} slot.`);
    }

    slot.button.click();
    openedPosition = true;
    await sleep(600);
  }

  if (!playerAction) {
    const searchResult = await searchPlayerPool(cleanPlayerName);
    playerAction = searchResult.action;

    if (!playerAction && searchResult.attempted) {
      throw new Error(`Could not find ${cleanPlayerName} after searching the player pool. Open the correct position list or adjust filters so the player is available.`);
    }
  }

  if (!playerAction) {
    throw new Error(`Could not find ${cleanPlayerName}. The player-pool search field was not available, and scrolling fallback is disabled.`);
  }

  playerAction.button.click();

  return {
    ok: true,
    playerName: cleanPlayerName,
    position: cleanPosition || null,
    openedPosition,
    searched: Boolean(playerAction.searched),
    message: `Clicked add for ${cleanPlayerName}.`
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CAPTURE_PAGE_CONTEXT") {
    sendResponse(capturePageContext());
    return false;
  }

  if (message?.type === "ADD_FANTASY_PLAYER") {
    addFantasyPlayer(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Could not add fantasy player."
      }));
    return true;
  }
});
}());
