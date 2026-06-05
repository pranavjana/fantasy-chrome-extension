const SEARCH_ENDPOINT = "https://api.search.tinyfish.ai";
const FETCH_ENDPOINT = "https://api.fetch.tinyfish.ai";
const SEARCH_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function tinyfishSearch({ apiKey, query, limit = 8 }) {
  if (!apiKey) {
    throw new Error("TINYFISH_API_KEY is not configured.");
  }

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("location", "US");
  url.searchParams.set("language", "en");

  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        "X-API-Key": apiKey
      }
    },
    SEARCH_TIMEOUT_MS,
    "Tinyfish Search"
  );

  if (!response.ok) {
    throw new Error(`Tinyfish Search failed with status ${response.status}`);
  }

  const payload = await response.json();
  return (payload.results || []).slice(0, limit);
}

export async function tinyfishFetch({ apiKey, urls }) {
  if (!apiKey) {
    throw new Error("TINYFISH_API_KEY is not configured.");
  }

  if (!urls.length) {
    return [];
  }

  const response = await fetchWithTimeout(
    FETCH_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey
      },
      body: JSON.stringify({
        urls,
        format: "markdown",
        image_links: true,
        ttl: 0
      })
    },
    FETCH_TIMEOUT_MS,
    "Tinyfish Fetch"
  );

  if (!response.ok) {
    throw new Error(`Tinyfish Fetch failed with status ${response.status}`);
  }

  const payload = await response.json();
  return payload.results || [];
}
