// Service worker — seeds storage with bundled keys on first install.
importScripts("bundled_keys.js");

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== "install") return; // only on fresh install, not updates

  chrome.storage.local.get("llmKeys", ({ llmKeys }) => {
    // Don't overwrite if the user already has keys (e.g. after a reinstall
    // where they kept their profile data).
    if (llmKeys && llmKeys.length > 0) return;

    const valid = (BUNDLED_KEYS || []).filter(
      k => k.apiKey && k.apiKey !== "YOUR_GROQ_API_KEY_HERE"
               && k.apiKey !== "YOUR_OPENAI_KEY_HERE"
               && k.apiKey.trim() !== ""
    );

    if (valid.length > 0) {
      chrome.storage.local.set({ llmKeys: valid }, () => {
        console.log(`[FeedParser] Seeded ${valid.length} bundled key(s) into storage.`);
      });
    }
  });
});
