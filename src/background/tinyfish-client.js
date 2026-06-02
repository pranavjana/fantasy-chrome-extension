const SEARCH_ENDPOINT = "https://api.search.tinyfish.ai";
const FETCH_ENDPOINT = "https://api.fetch.tinyfish.ai";

export async function tinyfishSearch({ apiKey, query, limit = 8 }) {
  if (!apiKey) {
    throw new Error("TINYFISH_API_KEY is not configured.");
  }

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("location", "US");
  url.searchParams.set("language", "en");

  const response = await fetch(url, {
    headers: {
      "X-API-Key": apiKey
    }
  });

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

  const response = await fetch(FETCH_ENDPOINT, {
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
  });

  if (!response.ok) {
    throw new Error(`Tinyfish Fetch failed with status ${response.status}`);
  }

  const payload = await response.json();
  return payload.results || [];
}
