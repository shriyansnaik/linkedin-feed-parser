// ── Tabs ──────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────
function showMsg(elId, text, isErr = false, durationMs = 3000) {
  const el = document.getElementById(elId);
  el.className = "save-msg" + (isErr ? " err" : "");
  el.textContent = text;
  if (durationMs) setTimeout(() => { el.textContent = ""; }, durationMs);
}

// ── API Keys tab ──────────────────────────────────────────────────────────
const PROVIDER_INFO = {
  openai:     { name: "OpenAI",       hint: "e.g. gpt-4o-mini, gpt-4o, gpt-3.5-turbo" },
  groq:       { name: "Groq",         hint: "e.g. llama-3.3-70b-versatile, mixtral-8x7b-32768" },
  together:   { name: "Together AI",  hint: "e.g. meta-llama/Llama-3-70b-chat-hf" },
  mistral:    { name: "Mistral",      hint: "e.g. mistral-small-latest, mistral-medium" },
  openrouter: { name: "OpenRouter",   hint: "e.g. openai/gpt-4o-mini, anthropic/claude-3-haiku" },
  custom:     { name: "Custom",       hint: "Enter the exact model name your server expects" },
};

const providerSelect = document.getElementById("providerSelect");
const modelInput     = document.getElementById("modelInput");
const modelHint      = document.getElementById("modelHint");
const apiKeyInput    = document.getElementById("apiKeyInput");
const baseUrlInput   = document.getElementById("baseUrlInput");
const customUrlRow   = document.getElementById("customUrlRow");

providerSelect.addEventListener("change", () => {
  const p = providerSelect.value;
  modelHint.textContent = PROVIDER_INFO[p]?.hint || "";
  customUrlRow.style.display = p === "custom" ? "block" : "none";
  modelInput.placeholder = PROVIDER_INFO[p]?.hint?.split(",")[0]?.replace("e.g. ", "") || "model-name";
});
providerSelect.dispatchEvent(new Event("change"));

function maskKey(key) {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••" + key.slice(-4);
}

function renderKeys(keys) {
  const el = document.getElementById("keyList");
  el.innerHTML = "";
  if (!keys.length) {
    el.innerHTML = `<p class="empty-msg">No keys added yet.</p>`;
    return;
  }
  keys.forEach((k, i) => {
    const row = document.createElement("div");
    row.className = "key-row";
    const providerName = PROVIDER_INFO[k.provider]?.name || k.provider;
    const baseUrlNote  = k.provider === "custom" ? `<div class="masked-key">${k.baseUrl}</div>` : "";
    row.innerHTML = `
      <div class="info">
        <div class="provider-name">${providerName}</div>
        <div class="model-name">${k.model}</div>
        <div class="masked-key">${maskKey(k.apiKey)}</div>
        ${baseUrlNote}
      </div>
      <button class="del-btn" data-index="${i}">Delete</button>`;
    row.querySelector(".del-btn").addEventListener("click", () => {
      chrome.storage.local.get("llmKeys", ({ llmKeys }) => {
        const updated = (llmKeys || []);
        updated.splice(i, 1);
        chrome.storage.local.set({ llmKeys: updated }, () => renderKeys(updated));
      });
    });
    el.appendChild(row);
  });
}

document.getElementById("saveBtn").addEventListener("click", () => {
  const provider = providerSelect.value;
  const apiKey   = apiKeyInput.value.trim();
  const model    = modelInput.value.trim();
  const baseUrl  = baseUrlInput.value.trim();

  if (!apiKey) { showMsg("saveMsg", "API key is required.", true); return; }
  if (!model)  { showMsg("saveMsg", "Model name is required.", true); return; }
  if (provider === "custom" && !baseUrl) {
    showMsg("saveMsg", "Base URL is required for Custom provider.", true); return;
  }

  const entry = { id: crypto.randomUUID(), provider, apiKey, model, baseUrl };
  chrome.storage.local.get("llmKeys", ({ llmKeys }) => {
    const keys = [...(llmKeys || []), entry];
    chrome.storage.local.set({ llmKeys: keys }, () => {
      renderKeys(keys);
      apiKeyInput.value = "";
      modelInput.value  = "";
      baseUrlInput.value = "";
      showMsg("saveMsg", "Key saved.");
    });
  });
});

chrome.storage.local.get("llmKeys", ({ llmKeys }) => renderKeys(llmKeys || []));

// Export
document.getElementById("exportBtn").addEventListener("click", () => {
  chrome.storage.local.get("llmKeys", ({ llmKeys }) => {
    const keys = llmKeys || [];
    if (!keys.length) { showMsg("saveMsg", "No keys to export.", true); return; }

    const entries = keys.map((k, i) => [
      `  {`,
      `    id: "bundled-${i + 1}",`,
      `    provider: "${k.provider}",`,
      `    apiKey: "${k.apiKey}",`,
      `    model: "${k.model}",`,
      `    baseUrl: "${k.baseUrl || ""}",`,
      `  }`,
    ].join("\n"));

    const output = [
      `// Auto-generated by LinkedIn Feed Parser — Settings → Share`,
      `// Paste this file over extension/bundled_keys.js, then zip the folder.`,
      ``,
      `const BUNDLED_KEYS = [`,
      entries.join(",\n"),
      `];`,
    ].join("\n");

    document.getElementById("exportText").value = output;
    document.getElementById("exportOut").style.display = "block";
    document.getElementById("exportOut").scrollIntoView({ behavior: "smooth" });
  });
});

document.getElementById("copyBtn").addEventListener("click", () => {
  navigator.clipboard.writeText(document.getElementById("exportText").value).then(() => {
    showMsg("copyMsg", "✓ Copied to clipboard!");
  });
});

// ── Profile tab ───────────────────────────────────────────────────────────
chrome.storage.local.get(["userProfile", "userResume"], ({ userProfile, userResume }) => {
  if (userProfile) {
    document.getElementById("profileName").value  = userProfile.name  || "";
    document.getElementById("profilePhone").value = userProfile.phone || "";
    document.getElementById("profileBio").value   = userProfile.bio   || "";
    document.getElementById("profileExtra").value = userProfile.extra || "";
  }
  renderResume(userResume);
});

function renderResume(resume) {
  document.getElementById("resumeEmpty").style.display  = resume ? "none"  : "block";
  document.getElementById("resumeLoaded").style.display = resume ? "block" : "none";
  if (resume) document.getElementById("resumeFileName").textContent = resume.name;
}

document.getElementById("saveProfileBtn").addEventListener("click", () => {
  const profile = {
    name:  document.getElementById("profileName").value.trim(),
    phone: document.getElementById("profilePhone").value.trim(),
    bio:   document.getElementById("profileBio").value.trim(),
    extra: document.getElementById("profileExtra").value.trim(),
  };
  chrome.storage.local.set({ userProfile: profile }, () => showMsg("profileMsg", "Profile saved."));
});

document.getElementById("uploadResumeBtn").addEventListener("click", () =>
  document.getElementById("resumeInput").click()
);

document.getElementById("resumeInput").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { alert("Resume must be under 5 MB."); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    const resume = { name: file.name, dataUrl: ev.target.result };
    chrome.storage.local.set({ userResume: resume }, () => renderResume(resume));
  };
  reader.readAsDataURL(file);
  e.target.value = "";
});

document.getElementById("removeResumeBtn").addEventListener("click", () =>
  chrome.storage.local.remove("userResume", () => renderResume(null))
);

// ── Email / Gmail tab ─────────────────────────────────────────────────────
const connectBtn    = document.getElementById("gmailConnectBtn");
const disconnectBtn = document.getElementById("gmailDisconnectBtn");
const statusEl      = document.getElementById("gmailStatus");

// Show the client ID that's currently baked into manifest.json
const manifestClientId = chrome.runtime.getManifest().oauth2?.client_id || "";
const hasClientId = manifestClientId && !manifestClientId.startsWith("PASTE_YOUR");
document.getElementById("manifestClientId").textContent =
  hasClientId ? manifestClientId : "not set — see setup steps above";
connectBtn.disabled = !hasClientId;

async function refreshGmailStatus() {
  const connected = await window.GmailAPI.isConnected();
  if (connected) {
    statusEl.textContent = "Connected — emails will be sent via Gmail with resume auto-attached.";
    statusEl.className   = "gmail-status connected";
    connectBtn.style.display    = "none";
    disconnectBtn.style.display = "inline-block";
  } else {
    statusEl.textContent = hasClientId
      ? "Not connected. Click Connect to authorise."
      : "Complete the setup steps above first.";
    statusEl.className   = "gmail-status";
    connectBtn.style.display    = "inline-block";
    disconnectBtn.style.display = "none";
  }
}

connectBtn.addEventListener("click", async () => {
  connectBtn.textContent = "Connecting…";
  connectBtn.disabled    = true;
  document.getElementById("gmailMsg").textContent = "";

  try {
    await window.GmailAPI.connect();
    showMsg("gmailMsg", "Google account connected.");
  } catch (err) {
    showMsg("gmailMsg", "⚠ " + err.message, true, 0);
    console.error("[Gmail connect]", err);
  }

  connectBtn.textContent = "Connect Google Account";
  connectBtn.disabled    = !hasClientId;
  refreshGmailStatus();
});

disconnectBtn.addEventListener("click", async () => {
  await window.GmailAPI.disconnect();
  showMsg("gmailMsg", "Disconnected.");
  refreshGmailStatus();
});

refreshGmailStatus();
