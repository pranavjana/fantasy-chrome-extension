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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CAPTURE_PAGE_CONTEXT") {
    sendResponse(capturePageContext());
  }
});
