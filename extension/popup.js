const parseBtn    = document.getElementById("parseBtn");
const statusEl    = document.getElementById("status");
const keyStatusEl = document.getElementById("keyStatus");

// Show how many keys are configured
chrome.storage.local.get("llmKeys", ({ llmKeys }) => {
  const keys = llmKeys || [];
  if (keys.length === 0) {
    keyStatusEl.className = "key-status warn";
    keyStatusEl.textContent = "⚠ No LLM keys — add one in Settings";
  } else {
    keyStatusEl.className = "key-status";
    keyStatusEl.textContent = `✓ ${keys.length} LLM key${keys.length > 1 ? "s" : ""} configured`;
  }
});

// Open settings tab
document.getElementById("settingsBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
});

// Parse feed
parseBtn.addEventListener("click", async () => {
  parseBtn.disabled = true;
  statusEl.className = "";
  statusEl.textContent = "Parsing…";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url || !tab.url.includes("linkedin.com")) {
      throw new Error("Navigate to LinkedIn first.");
    }

    // Re-inject content script in case page was loaded before extension
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    }).catch(() => {});

    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: "parse" }, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(res);
      });
    });

    if (!response?.ok) throw new Error(response?.error || "Content script error");

    await chrome.storage.local.set({ linkedinPosts: response.posts });
    chrome.tabs.create({ url: chrome.runtime.getURL("results.html") });
    statusEl.textContent = `Found ${response.count} post(s). Opening results…`;

  } catch (err) {
    statusEl.className = "err";
    statusEl.textContent = "Error: " + err.message;
    parseBtn.disabled = false;
  }
});
