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

function getScrollTop(container) {
  if (container === document.scrollingElement) {
    return window.scrollY;
  }

  return container.scrollTop;
}

function setScrollTop(container, value) {
  if (container === document.scrollingElement) {
    window.scrollTo({ top: value, behavior: "instant" });
    return;
  }

  container.scrollTop = value;
}

function findScrollablePlayerContainers() {
  const candidates = [
    document.scrollingElement,
    ...Array.from(document.querySelectorAll("*"))
  ].filter((element) => {
    if (!element || !isVisible(element)) {
      return false;
    }

    return element.scrollHeight > element.clientHeight + 80;
  });

  return candidates
    .map((element) => {
      const text = element.textContent || "";
      const rect = element.getBoundingClientRect();
      const visibleButtonCount = Array.from(element.querySelectorAll("button")).filter(isVisible).length;
      let score = 0;

      if (text.includes("Player") && text.includes("Price") && text.includes("Action")) {
        score += 100;
      }

      if (visibleButtonCount >= 3) {
        score += 30;
      }

      if (rect.right > window.innerWidth * 0.55) {
        score += 20;
      }

      score += Math.min(20, visibleButtonCount);
      score += Math.min(20, Math.floor((element.scrollHeight - element.clientHeight) / 200));

      return { element, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((candidate) => candidate.element)
    .slice(0, 5);
}

async function findPlayerActionButtonWithScrolling(playerName) {
  const visibleAction = findPlayerActionButton(playerName);
  if (visibleAction) {
    return { ...visibleAction, scrolled: false };
  }

  for (const container of findScrollablePlayerContainers()) {
    const originalTop = getScrollTop(container);
    setScrollTop(container, 0);
    await sleep(150);

    for (let attempt = 0; attempt < 45; attempt += 1) {
      const playerAction = findPlayerActionButton(playerName);
      if (playerAction) {
        return { ...playerAction, scrolled: true };
      }

      const before = getScrollTop(container);
      const step = Math.max(220, Math.floor(container.clientHeight * 0.75));
      setScrollTop(container, before + step);
      await sleep(150);

      if (getScrollTop(container) === before) {
        break;
      }
    }

    setScrollTop(container, originalTop);
    await sleep(100);
  }

  return null;
}

async function addFantasyPlayer({ playerName, position }) {
  const cleanPlayerName = String(playerName || "").trim();
  const cleanPosition = String(position || "").trim().toUpperCase();

  if (!cleanPlayerName) {
    throw new Error("playerName is required.");
  }

  let playerAction = await findPlayerActionButtonWithScrolling(cleanPlayerName);
  let openedPosition = false;

  if (!playerAction && cleanPosition) {
    const slot = findPositionSlot(cleanPosition);
    if (!slot) {
      throw new Error(`Could not find an empty ${cleanPosition} slot.`);
    }

    slot.button.click();
    openedPosition = true;
    await sleep(600);
    playerAction = await findPlayerActionButtonWithScrolling(cleanPlayerName);
  }

  if (!playerAction) {
    throw new Error(`Could not find ${cleanPlayerName} in the player list after scrolling. Open the correct position list or adjust filters so the player is available.`);
  }

  playerAction.button.scrollIntoView({ block: "center", inline: "center" });
  await sleep(100);
  playerAction.button.click();

  return {
    ok: true,
    playerName: cleanPlayerName,
    position: cleanPosition || null,
    openedPosition,
    scrolled: Boolean(playerAction.scrolled),
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
