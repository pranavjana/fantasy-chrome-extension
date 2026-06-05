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

function isRendered(element) {
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

function findPlayerPoolContainer() {
  const title = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, div, span"))
    .find((element) => isVisible(element) && element.textContent?.trim().toUpperCase() === "PLAYER POOL");

  let node = title;
  for (let depth = 0; node && node !== document.body && depth < 8; depth += 1) {
    if (node.querySelector?.('input[name="search"], input[placeholder*="Search" i]') && node.querySelector?.("button")) {
      return node;
    }
    node = node.parentElement;
  }

  return closestWithClassToken(title, "sidebar") || document.body;
}

function getNameTokens(playerName) {
  return normalizeText(playerName)
    .split(" ")
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length >= 3);
}

function findFirstFilteredPlayerActionButton(playerName) {
  const container = findPlayerPoolContainer();
  const nameTokens = getNameTokens(playerName);
  const candidates = Array.from(container.querySelectorAll("button"))
    .filter(isVisible)
    .map((button) => {
      let row = button.parentElement;
      for (let depth = 0; row && row !== document.body && depth < 8; depth += 1) {
        const text = row.textContent || "";
        const normalizedText = normalizeText(text);
        const actionButton = findActionColumnButton(row);
        const hasNameToken = nameTokens.some((token) => normalizedText.includes(token));
        if (actionButton === button && /\$\d/.test(text) && hasNameToken) {
          return { row, button };
        }
        row = row.parentElement;
      }
      return null;
    })
    .filter(Boolean);

  return candidates
    .sort((a, b) => a.row.getBoundingClientRect().top - b.row.getBoundingClientRect().top)[0] || null;
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

function getVisibleText() {
  return Array.from(document.querySelectorAll("body *"))
    .filter(isVisible)
    .map((element) => element.textContent || "")
    .join("\n");
}

function getSelectedCount() {
  const match = getVisibleText().match(/\b(\d{1,2})\s*\/\s*15\s*Selected\b/i);
  return match ? Number(match[1]) : null;
}

function getRemainingBudget() {
  const match = getVisibleText().match(/\$?\s*(\d+(?:\.\d+)?)m\s*Budget\b/i);
  return match ? Number(match[1]) : null;
}

function parseFantasyPrice(value) {
  const match = String(value || "").match(/\$?\s*(\d+(?:\.\d+)?)m\b/i);
  return match ? Number(match[1]) : null;
}

function getVisibleLeafTexts(root) {
  return Array.from(root.querySelectorAll("*"))
    .filter((element) => isRendered(element) && element.children.length === 0)
    .map((element) => (element.textContent || "").trim())
    .filter(Boolean);
}

function isInsideExcludedSquadArea(element) {
  const playerPool = findPlayerPoolContainer();
  if (playerPool?.contains(element)) {
    return true;
  }

  const text = normalizeText(element.textContent);
  return text.includes("fixtures & results") ||
    text.includes("how to score points") ||
    text.includes("remove injured suspended eliminated") ||
    text.includes("player pool");
}

function findCompactPlayerCard(priceElement) {
  let best = priceElement;
  let node = priceElement.parentElement;

  for (let depth = 0; node && node !== document.body && depth < 8; depth += 1) {
    const text = (node.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length > 120 || /Budget|Selected|Player Pool|Fixtures & Results/i.test(text)) {
      break;
    }

    if (/\$?\s*\d+(?:\.\d+)?m\b/i.test(text)) {
      best = node;
    }

    node = node.parentElement;
  }

  return best;
}

function playerNameMatchScore(candidateName, targetName) {
  const candidate = normalizeText(candidateName);
  const target = normalizeText(targetName);
  if (!candidate || !target) {
    return 0;
  }

  if (candidate === target) {
    return 100;
  }

  if (candidate.startsWith(target) || candidate.endsWith(target)) {
    return 80;
  }

  if (candidate.includes(target)) {
    return 70;
  }

  const targetTokens = getNameTokens(targetName);
  if (targetTokens.length && targetTokens.every((token) => candidate.includes(token))) {
    return 60;
  }

  return 0;
}

function extractPlayerFromCard(card, fallbackIndex) {
  const leafTexts = getVisibleLeafTexts(card);
  const priceText = leafTexts.find((text) => parseFantasyPrice(text) !== null);
  const price = parseFantasyPrice(priceText);
  const nameCandidates = leafTexts
    .filter((text) => parseFantasyPrice(text) === null)
    .filter((text) => !/^(add|remove|bench|starting|injured|suspended|eliminated|out of squad)$/i.test(text))
    .filter((text) => !/^\d+$/.test(text));
  const name = nameCandidates[nameCandidates.length - 1] || card.querySelector("img")?.alt || `Player ${fallbackIndex + 1}`;
  const rect = card.getBoundingClientRect();

  return {
    name,
    price,
    rawText: leafTexts.join(" | "),
    top: Math.round(rect.top),
    left: Math.round(rect.left)
  };
}

function cleanSquadName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikePlayerName(value) {
  const text = cleanSquadName(value);
  return text.length >= 2 &&
    text.length <= 40 &&
    /[A-Za-zÀ-ž]/.test(text) &&
    !/\b(Budget|Selected|FIFA|World Cup|Fantasy|Player Pool|Transfers deadline|Price|Team|Position|Stat|Action|Round|Fixtures|Results|Reset|Save|Key|Remove|Add|Bench|Starting)\b/i.test(text);
}

function parsePlayersFromRawText(rawText) {
  const tokens = String(rawText || "")
    .replace(/\s+/g, " ")
    .split(/\s*\|\s*/)
    .map((token) => token.trim())
    .filter(Boolean);
  const players = [];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const name = cleanSquadName(tokens[index]);
    const price = parseFantasyPrice(tokens[index + 1]);
    if (!looksLikePlayerName(name) || price === null) {
      continue;
    }

    players.push({
      name,
      price,
      rawText: `${name} | ${tokens[index + 1]}`
    });
    index += 1;
  }

  return players;
}

function findRawSquadPlayers() {
  const candidates = Array.from(document.querySelectorAll("div"))
    .filter(isRendered)
    .filter((element) => !isInsideExcludedSquadArea(element))
    .map((element) => ({
      element,
      text: getVisibleLeafTexts(element).join(" | ")
    }))
    .filter((candidate) => (candidate.text.match(/\$?\s*\d+(?:\.\d+)?m\b/gi) || []).length >= 8)
    .map((candidate) => ({
      ...candidate,
      players: parsePlayersFromRawText(candidate.text)
    }))
    .filter((candidate) => candidate.players.length >= 8);

  return candidates
    .sort((left, right) => right.players.length - left.players.length || right.text.length - left.text.length)[0] || null;
}

function inferPositionBySquadOrder(index) {
  if (index < 2) {
    return "GK";
  }

  if (index < 7) {
    return "DEF";
  }

  if (index < 12) {
    return "MID";
  }

  return "FWD";
}

function getCurrentFantasySquad() {
  const rawSquad = findRawSquadPlayers();
  if (rawSquad?.players?.length) {
    const players = rawSquad.players.map((player, index) => ({
      index: index + 1,
      position: inferPositionBySquadOrder(index),
      name: player.name,
      price: player.price,
      rawText: player.rawText
    }));

    return {
      ok: true,
      source: "raw_text",
      selectedCount: getSelectedCount(),
      remainingBudget: getRemainingBudget(),
      parsedPlayerCount: players.length,
      visiblePlayerCount: players.length,
      rawText: rawSquad.text,
      players
    };
  }

  const priceElements = Array.from(document.querySelectorAll("div, span"))
    .filter(isRendered)
    .filter((element) => parseFantasyPrice(element.textContent) !== null)
    .filter((element) => !/Budget/i.test(element.textContent || ""))
    .filter((element) => !isInsideExcludedSquadArea(element));

  const seenCards = new Set();
  const players = [];

  for (const priceElement of priceElements) {
    const card = findCompactPlayerCard(priceElement);
    if (seenCards.has(card)) {
      continue;
    }
    seenCards.add(card);

    const player = extractPlayerFromCard(card, players.length);
    if (!player.name || player.price === null) {
      continue;
    }

    players.push(player);
  }

  players.sort((left, right) => (left.top - right.top) || (left.left - right.left));

  const normalizedPlayers = players.map((player, index) => ({
    index: index + 1,
    position: inferPositionBySquadOrder(index),
    name: player.name,
    price: player.price,
    rawText: player.rawText
  }));

  const selectedCount = getSelectedCount();

  return {
    ok: true,
    source: "cards",
    selectedCount,
    remainingBudget: getRemainingBudget(),
    parsedPlayerCount: normalizedPlayers.length,
    visiblePlayerCount: normalizedPlayers.length,
    players: normalizedPlayers
  };
}

function squadContainsPlayerName(squad, playerName) {
  return Array.isArray(squad?.players) &&
    squad.players.some((player) => playerNameMatchScore(player.name, playerName) > 0);
}

async function waitForSelectedCountIncrease(beforeCount) {
  if (typeof beforeCount !== "number") {
    await sleep(700);
    return null;
  }

  for (let attempt = 0; attempt < 14; attempt += 1) {
    await sleep(250);
    const afterCount = getSelectedCount();
    if (typeof afterCount === "number" && afterCount > beforeCount) {
      return afterCount;
    }
  }

  return getSelectedCount();
}

async function waitForSelectedCountDecrease(beforeCount) {
  if (typeof beforeCount !== "number") {
    await sleep(700);
    return null;
  }

  for (let attempt = 0; attempt < 14; attempt += 1) {
    await sleep(250);
    const afterCount = getSelectedCount();
    if (typeof afterCount === "number" && afterCount < beforeCount) {
      return afterCount;
    }
  }

  return getSelectedCount();
}

function findRemoveButtonInCard(card) {
  const visibleButtons = Array.from(card.querySelectorAll("button"))
    .filter(isVisible);

  const labelledButton = visibleButtons.find((button) => {
    const label = `${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.textContent || ""}`;
    return /\bremove\b/i.test(label);
  });
  if (labelledButton) {
    return labelledButton;
  }

  return visibleButtons
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return (leftRect.top - rightRect.top) || (leftRect.left - rightRect.left);
    })[0] || null;
}

function findSelectedCardFromImage(image) {
  let best = image;
  let node = image.parentElement;

  for (let depth = 0; node && node !== document.body && depth < 10; depth += 1) {
    if (isInsideExcludedSquadArea(node)) {
      break;
    }

    const text = (node.textContent || "").replace(/\s+/g, " ").trim();
    const hasPrice = parseFantasyPrice(text) !== null;
    const hasImage = node.contains(image);
    if (hasImage && hasPrice && !/Budget|Selected|Player Pool|Fixtures & Results|How to score points/i.test(text)) {
      best = node;
    }

    if (hasPrice && text.length > 180) {
      break;
    }

    node = node.parentElement;
  }

  return best;
}

function buttonDistanceFromRect(button, rect) {
  const buttonRect = button.getBoundingClientRect();
  const centerX = buttonRect.left + (buttonRect.width / 2);
  const centerY = buttonRect.top + (buttonRect.height / 2);
  const nearestX = Math.max(rect.left, Math.min(centerX, rect.right));
  const nearestY = Math.max(rect.top, Math.min(centerY, rect.bottom));
  return Math.hypot(centerX - nearestX, centerY - nearestY);
}

function findNearestRemoveButton(card, image) {
  const cardRect = card.getBoundingClientRect();
  const imageRect = image.getBoundingClientRect();
  const searchRect = {
    left: Math.min(cardRect.left, imageRect.left) - 36,
    right: Math.max(cardRect.right, imageRect.right) + 36,
    top: Math.min(cardRect.top, imageRect.top) - 36,
    bottom: Math.max(cardRect.bottom, imageRect.bottom) + 36
  };

  const buttons = [
    ...Array.from(card.querySelectorAll("button")),
    ...Array.from(document.querySelectorAll("button"))
  ]
    .filter(isVisible)
    .filter((button) => !isInsideExcludedSquadArea(button))
    .filter((button) => {
      const rect = button.getBoundingClientRect();
      const centerX = rect.left + (rect.width / 2);
      const centerY = rect.top + (rect.height / 2);
      return centerX >= searchRect.left &&
        centerX <= searchRect.right &&
        centerY >= searchRect.top &&
        centerY <= searchRect.bottom;
    })
    .map((button) => ({
      button,
      isLabelledRemove: /\bremove\b/i.test(`${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.textContent || ""}`),
      distance: buttonDistanceFromRect(button, imageRect)
    }))
    .filter((candidate, index, all) => all.findIndex((other) => other.button === candidate.button) === index);

  return buttons
    .sort((left, right) => Number(right.isLabelledRemove) - Number(left.isLabelledRemove) || left.distance - right.distance)[0]?.button || null;
}

function findSelectedPlayerCard(playerName) {
  const imageCandidates = Array.from(document.querySelectorAll("img[alt]"))
    .filter(isRendered)
    .filter((image) => !isInsideExcludedSquadArea(image))
    .map((image) => ({
      image,
      name: image.getAttribute("alt") || "",
      score: playerNameMatchScore(image.getAttribute("alt") || "", playerName)
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  for (const candidate of imageCandidates) {
    const card = findSelectedCardFromImage(candidate.image);
    const player = extractPlayerFromCard(card, 0);
    const removeButton = findNearestRemoveButton(card, candidate.image);
    if (removeButton) {
      return {
        card,
        player: {
          ...player,
          name: candidate.name || player.name
        },
        removeButton
      };
    }
  }

  const priceElements = Array.from(document.querySelectorAll("div, span"))
    .filter(isRendered)
    .filter((element) => parseFantasyPrice(element.textContent) !== null)
    .filter((element) => !/Budget/i.test(element.textContent || ""))
    .filter((element) => !isInsideExcludedSquadArea(element));

  const seenCards = new Set();
  const candidates = [];

  for (const priceElement of priceElements) {
    const card = findCompactPlayerCard(priceElement);
    if (seenCards.has(card)) {
      continue;
    }
    seenCards.add(card);

    const player = extractPlayerFromCard(card, candidates.length);
    const image = card.querySelector("img[alt]");
    const imageName = image?.getAttribute("alt") || "";
    const score = Math.max(
      playerNameMatchScore(player.name, playerName),
      playerNameMatchScore(imageName, playerName)
    );

    if (score > 0) {
      candidates.push({
        card,
        image,
        player: {
          ...player,
          name: imageName || player.name
        },
        score,
        removeButton: image ? findNearestRemoveButton(card, image) : findRemoveButtonInCard(card)
      });
    }
  }

  return candidates
    .filter((candidate) => candidate.removeButton)
    .sort((left, right) => right.score - left.score)[0] || null;
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

    if (normalizeText(input.value) === normalizeText(playerName)) {
      const filteredAction = findFirstFilteredPlayerActionButton(playerName);
      if (filteredAction) {
        return {
          action: {
            ...filteredAction,
            searched: true,
            usedFirstFilteredResult: true
          },
          attempted: true
        };
      }
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

  const selectedCountBefore = getSelectedCount();
  const budgetBefore = getRemainingBudget();
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
  const selectedCountAfter = await waitForSelectedCountIncrease(selectedCountBefore);
  const budgetAfter = getRemainingBudget();

  if (typeof selectedCountBefore === "number" && selectedCountAfter <= selectedCountBefore) {
    throw new Error(`Clicked add for ${cleanPlayerName}, but the selected count stayed at ${selectedCountAfter ?? selectedCountBefore}/15. The add likely failed because of budget, position, country-limit, filters, or page state.`);
  }

  return {
    ok: true,
    playerName: cleanPlayerName,
    position: cleanPosition || null,
    selectedCountBefore,
    selectedCountAfter,
    budgetBefore,
    budgetAfter,
    openedPosition,
    searched: Boolean(playerAction.searched),
    message: typeof selectedCountAfter === "number"
      ? `Added ${cleanPlayerName}; selected count is now ${selectedCountAfter}/15.`
      : `Clicked add for ${cleanPlayerName}.`
  };
}

async function removeFantasyPlayer({ playerName }) {
  const cleanPlayerName = String(playerName || "").trim();

  if (!cleanPlayerName) {
    throw new Error("playerName is required.");
  }

  const squadBefore = getCurrentFantasySquad();
  const selectedCountBefore = getSelectedCount();
  const budgetBefore = getRemainingBudget();
  const selectedPlayer = findSelectedPlayerCard(cleanPlayerName);

  if (!selectedPlayer?.removeButton) {
    throw new Error(`Could not find ${cleanPlayerName} in the selected squad cards.`);
  }

  selectedPlayer.removeButton.click();
  const selectedCountAfter = await waitForSelectedCountDecrease(selectedCountBefore);
  const budgetAfter = getRemainingBudget();
  const squadAfter = getCurrentFantasySquad();

  if (typeof selectedCountBefore === "number" && selectedCountAfter >= selectedCountBefore) {
    throw new Error(`Clicked remove for ${cleanPlayerName}, but the selected count stayed at ${selectedCountAfter ?? selectedCountBefore}/15. The remove likely failed or the matched card was not removable.`);
  }

  if (squadContainsPlayerName(squadBefore, cleanPlayerName) && squadContainsPlayerName(squadAfter, cleanPlayerName)) {
    throw new Error(`Clicked remove for ${cleanPlayerName} and the selected count changed, but ${cleanPlayerName} still appears in the current squad. The page likely removed a different card; please restore the missing player before trying again.`);
  }

  return {
    ok: true,
    playerName: cleanPlayerName,
    matchedName: selectedPlayer.player?.name || null,
    selectedCountBefore,
    selectedCountAfter,
    budgetBefore,
    budgetAfter,
    message: typeof selectedCountAfter === "number"
      ? `Removed ${selectedPlayer.player?.name || cleanPlayerName}; selected count is now ${selectedCountAfter}/15.`
      : `Clicked remove for ${selectedPlayer.player?.name || cleanPlayerName}.`
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CAPTURE_PAGE_CONTEXT") {
    sendResponse(capturePageContext());
    return false;
  }

  if (message?.type === "GET_CURRENT_FANTASY_SQUAD") {
    sendResponse(getCurrentFantasySquad());
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

  if (message?.type === "REMOVE_FANTASY_PLAYER") {
    removeFantasyPlayer(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Could not remove fantasy player."
      }));
    return true;
  }
});
}());
