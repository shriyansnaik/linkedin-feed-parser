// ── SVG icons ──────────────────────────────────────────────────────────────
const ICONS = {
  connect: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`,
  email:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`,
  apply:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>`,
  back:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,
  pin:     `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
  mode:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>`,
};

// ── State ──────────────────────────────────────────────────────────────────
let totalPosts  = 0;
let doneCount   = 0;
let jobOnlyMode = false;
const renderedCards = [];
let allPosts = [];  // kept for retry

// Per-post persistence
const emailDrafts = {};   // postIndex -> { to, subject, body }
const emailSent   = {};   // postIndex -> true
const emailBtnMap = {};   // postIndex -> card email button element

// Current modal context
let emailModalJobInfo      = null;
let currentModalPostIndex  = null;

// ── Draft / sent helpers ───────────────────────────────────────────────────
function saveDraftToStorage() {
  chrome.storage.local.set({ emailDrafts });
}

function saveSentToStorage() {
  chrome.storage.local.set({ emailSent });
}

// Snapshot current modal fields into the draft cache (called on close)
function snapshotDraft() {
  if (currentModalPostIndex === null) return;
  const subject = document.getElementById("emSubject").value;
  const body    = document.getElementById("emBody").value;
  const to      = document.getElementById("emTo").value;
  if (subject || body) {
    emailDrafts[currentModalPostIndex] = { to, subject, body };
    saveDraftToStorage();
  }
}

function markSent(postIndex) {
  emailSent[postIndex] = true;
  saveSentToStorage();
  // Visually disable the email icon on the card
  const btn = emailBtnMap[postIndex];
  if (btn) {
    btn.disabled = true;
    btn.title    = "Email already sent";
    btn.classList.add("btn-email-sent");
  }
}

// ── Email modal ────────────────────────────────────────────────────────────
function openEmailModal(jobInfo, postIndex) {
  emailModalJobInfo     = jobInfo;
  currentModalPostIndex = postIndex;

  const overlay = document.getElementById("emailOverlay");
  overlay.style.display = "flex";
  document.getElementById("emInstruction").value        = "";
  document.getElementById("emGmailStatus").textContent  = "";
  document.getElementById("emError").style.display      = "none";
  document.getElementById("emTo").value = jobInfo.contact_email || "";

  chrome.storage.local.get(["llmKeys", "userProfile", "userResume"], (data) => {
    const keys = data.llmKeys || [];

    document.getElementById("emDownloadResume").style.display =
      data.userResume ? "inline-flex" : "none";

    if (window.GmailAPI) {
      window.GmailAPI.isConnected().then(connected => {
        const sendBtn = document.getElementById("emSendGmail");
        const status  = document.getElementById("emGmailStatus");
        sendBtn.style.display = "inline-flex";
        if (connected) {
          sendBtn.textContent = "Send ✓";
          sendBtn.disabled    = false;
          status.style.color  = "#057642";
          status.textContent  = data.userResume ? "Resume will be auto-attached." : "Connected to Gmail.";
        } else {
          sendBtn.textContent = "Connect & Send";
          sendBtn.disabled    = false;
          status.style.color  = "#888";
          status.textContent  = "Not connected — go to Settings → Email to connect Gmail.";
        }
      });
    }

    // Use saved draft if available — no LLM call needed
    const saved = emailDrafts[postIndex];
    if (saved) {
      document.getElementById("emTo").value      = saved.to      || jobInfo.contact_email || "";
      document.getElementById("emSubject").value = saved.subject || "";
      document.getElementById("emBody").value    = saved.body    || "";
      document.getElementById("emLoading").style.display = "none";
      document.getElementById("emForm").style.display    = "flex";
    } else {
      document.getElementById("emLoading").style.display = "flex";
      document.getElementById("emForm").style.display    = "none";
      generateDraft(jobInfo, data.userProfile, data.userResume, keys);
    }
  });
}

async function generateDraft(jobInfo, userProfile, userResume, keys, extraInstruction = "") {
  document.getElementById("emLoading").style.display = "flex";
  document.getElementById("emForm").style.display    = "none";
  document.getElementById("emError").style.display   = "none";

  try {
    const { subject, body } = await window.LLM.generateEmail(jobInfo, userProfile, keys, extraInstruction);
    document.getElementById("emSubject").value = subject;
    document.getElementById("emBody").value    = body;
    document.getElementById("emLoading").style.display = "none";
    document.getElementById("emForm").style.display    = "flex";

    // Cache the draft so reopening the modal skips the LLM call
    if (currentModalPostIndex !== null) {
      emailDrafts[currentModalPostIndex] = {
        to:      document.getElementById("emTo").value,
        subject,
        body,
      };
      saveDraftToStorage();
    }
  } catch (err) {
    document.getElementById("emLoading").style.display = "none";
    document.getElementById("emForm").style.display    = "flex";
    const errEl = document.getElementById("emError");
    errEl.style.display = "block";
    errEl.textContent = "⚠ " + err.message;
  }
}

function closeModal() {
  snapshotDraft(); // save any manual edits before closing
  document.getElementById("emailOverlay").style.display = "none";
}

// ── Modal event listeners ──────────────────────────────────────────────────
document.getElementById("emailClose").addEventListener("click", closeModal);
document.getElementById("emailOverlay").addEventListener("click", (e) => {
  if (e.target === document.getElementById("emailOverlay")) closeModal();
});

// Regenerate
document.getElementById("emRegen").addEventListener("click", () => {
  if (!emailModalJobInfo) return;
  const instruction = document.getElementById("emInstruction").value.trim();
  chrome.storage.local.get(["llmKeys", "userProfile", "userResume"], (data) => {
    generateDraft(emailModalJobInfo, data.userProfile, data.userResume, data.llmKeys || [], instruction);
  });
});

// Open in Gmail (compose window — also counts as "sent")
document.getElementById("emOpenGmail").addEventListener("click", () => {
  const to      = document.getElementById("emTo").value.trim();
  const subject = document.getElementById("emSubject").value.trim();
  const body    = document.getElementById("emBody").value.trim();
  const url = "https://mail.google.com/mail/?view=cm"
    + "&to="   + encodeURIComponent(to)
    + "&su="   + encodeURIComponent(subject)
    + "&body=" + encodeURIComponent(body);
  chrome.tabs.create({ url });
  if (currentModalPostIndex !== null) markSent(currentModalPostIndex);
});

// Send via Gmail API
document.getElementById("emSendGmail").addEventListener("click", async () => {
  const btn    = document.getElementById("emSendGmail");
  const status = document.getElementById("emGmailStatus");
  const to      = document.getElementById("emTo").value.trim();
  const subject = document.getElementById("emSubject").value.trim();
  const body    = document.getElementById("emBody").value.trim();

  if (!to) {
    status.style.color = "#c00";
    status.textContent = "No recipient email — fill in the To field.";
    return;
  }

  btn.disabled    = true;
  btn.textContent = "Sending…";
  status.style.color = "#888";
  status.textContent = "Connecting to Gmail…";

  chrome.storage.local.get("userResume", async ({ userResume }) => {
    try {
      const connected = await window.GmailAPI.isConnected();
      if (!connected) {
        status.textContent = "Opening Google sign-in…";
        await window.GmailAPI.connect();
      }

      status.textContent = "Sending…";
      await window.GmailAPI.sendEmail({
        to, subject, body,
        attachmentName:    userResume?.name    || null,
        attachmentDataUrl: userResume?.dataUrl || null,
      });

      btn.textContent    = "Sent ✓";
      btn.disabled       = true;
      status.style.color = "#057642";
      status.textContent = userResume ? "Email sent with resume attached!" : "Email sent!";

      if (currentModalPostIndex !== null) markSent(currentModalPostIndex);
    } catch (err) {
      btn.disabled       = false;
      btn.textContent    = "Connect & Send";
      status.style.color = "#c00";
      status.textContent = "⚠ " + err.message;
    }
  });
});

// Download resume
document.getElementById("emDownloadResume").addEventListener("click", () => {
  chrome.storage.local.get("userResume", ({ userResume }) => {
    if (!userResume) return;
    const a = document.createElement("a");
    a.href     = userResume.dataUrl;
    a.download = userResume.name;
    a.click();
  });
});

// ── Init ───────────────────────────────────────────────────────────────────
chrome.storage.local.get(
  ["linkedinPosts", "llmKeys", "emailDrafts", "emailSent"],
  ({ linkedinPosts, llmKeys, emailDrafts: savedDrafts, emailSent: savedSent }) => {
    const posts = linkedinPosts || [];
    const keys  = llmKeys || [];
    totalPosts  = posts.length;

    // Restore persisted draft/sent state
    Object.assign(emailDrafts, savedDrafts || {});
    Object.assign(emailSent,   savedSent   || {});

    allPosts = posts; // keep reference for retries

    if (!posts.length) { setLabel("No posts found."); return; }

    setLabel("Starting…");
    setBar(0, totalPosts);

    if (!keys.length) {
      document.getElementById("noKeysMsg").style.display = "block";
      document.getElementById("openSettingsLink").addEventListener("click", () =>
        chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") })
      );
      setLabel("Add an LLM key in Settings.");
      return;
    }

    document.getElementById("jobOnlyToggle").addEventListener("change", e => {
      jobOnlyMode = e.target.checked;
      applyFilter();
    });

    processAll(posts, keys);
  }
);

// ── Processing ─────────────────────────────────────────────────────────────
async function processAll(posts, keys) {
  const concurrency = Math.min(keys.length, 4);
  let next = 0;

  async function worker() {
    while (next < posts.length) {
      const i = next++;
      try {
        const info = await window.LLM.extractJobInfo(
          posts[i].post.text, keys,
          sec => setLabel(`⏳ Rate limited — waiting ${sec}s…`)
        );
        appendCard(posts[i], info, i);
      } catch (err) {
        appendErrorCard(posts[i], err.message, i);
      }
      doneCount++;
      setBar(doneCount, totalPosts);
      setLabel(doneCount === totalPosts ? "Done ✓" : "Analyzing…");
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
}

// ── Progress ───────────────────────────────────────────────────────────────
function setBar(done, total) {
  document.getElementById("progressCount").textContent = `${done} / ${total}`;
  document.getElementById("progressFill").style.width = `${(done / total) * 100}%`;
}
function setLabel(t) { document.getElementById("progressText").textContent = t; }

// ── Filter ─────────────────────────────────────────────────────────────────
function applyFilter() {
  renderedCards.forEach(({ el, isJobPost }) =>
    el.classList.toggle("hidden", jobOnlyMode && !isJobPost)
  );
}

// ── Card append ────────────────────────────────────────────────────────────
function appendCard(raw, info, postIndex) {
  const el = buildCard(raw, info, postIndex);
  document.getElementById("cards").appendChild(el);
  renderedCards.push({ el, isJobPost: !!info.is_job_post });
  applyFilter();
}

function appendErrorCard(raw, errMsg, postIndex) {
  const card = buildErrorCard(raw, errMsg, postIndex);
  document.getElementById("cards").appendChild(card);
  renderedCards.push({ el: card, isJobPost: null });
}

function buildErrorCard(raw, errMsg, postIndex) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="card-inner">
      <div class="card-front">
        <div class="error-front">
          <div class="error-name">${esc(raw.poster?.name || "Unknown")}</div>
          <div class="error-msg">⚠ ${esc(errMsg)}</div>
          <button class="retry-btn">↺ Retry</button>
        </div>
      </div>
    </div>`;

  card.querySelector(".retry-btn").addEventListener("click", () => retryCard(card, raw, postIndex));
  return card;
}

async function retryCard(card, raw, postIndex) {
  // Show spinner while retrying
  card.innerHTML = `
    <div class="card-inner">
      <div class="card-front">
        <div class="error-front">
          <div class="error-name">${esc(raw.poster?.name || "Unknown")}</div>
          <div class="error-msg" style="color:#888">Retrying…</div>
        </div>
      </div>
    </div>`;

  chrome.storage.local.get("llmKeys", async ({ llmKeys }) => {
    const keys = llmKeys || [];
    try {
      const info = await window.LLM.extractJobInfo(
        raw.post.text, keys,
        sec => {}
      );
      // Success — replace error card with real card
      const newCard = buildCard(raw, info, postIndex);
      card.replaceWith(newCard);
      const idx = renderedCards.findIndex(r => r.el === card);
      if (idx !== -1) renderedCards[idx] = { el: newCard, isJobPost: !!info.is_job_post };
      applyFilter();
    } catch (err) {
      // Still failing — rebuild error card with new message
      const newErrCard = buildErrorCard(raw, err.message, postIndex);
      card.replaceWith(newErrCard);
      const idx = renderedCards.findIndex(r => r.el === card);
      if (idx !== -1) renderedCards[idx] = { el: newErrCard, isJobPost: null };
    }
  });
}

// ── Card builder ───────────────────────────────────────────────────────────
function buildCard(raw, info, postIndex) {
  const { poster, post } = raw;
  const card = document.createElement("div");
  card.className = "card";

  const vanityName = (poster.linkedin_url || "").split("/in/")[1]?.replace(/\/$/, "") || "";

  if (!info.is_job_post) {
    card.innerHTML = `
      <div class="card-inner">
        <div class="card-front">
          <div class="not-job-front">
            ${avatarEl(poster)}
            <div class="not-job-name">${esc(poster.name || "Unknown")}</div>
            <div class="not-job-label">Not a job post</div>
          </div>
        </div>
      </div>`;
    return card;
  }

  card.innerHTML = `
    <div class="card-inner">
      <div class="card-front">${frontHtml(poster, post, info, vanityName)}</div>
      <div class="card-back">${backHtml(info)}</div>
    </div>`;

  // Email button
  const emailBtn = card.querySelector(".email-draft-btn");
  if (emailBtn) {
    emailBtnMap[postIndex] = emailBtn;

    // Restore sent state immediately
    if (emailSent[postIndex]) {
      emailBtn.disabled = true;
      emailBtn.title    = "Email already sent";
      emailBtn.classList.add("btn-email-sent");
    }

    emailBtn.addEventListener("click", e => {
      e.stopPropagation();
      if (!emailBtn.disabled) openEmailModal(info, postIndex);
    });
  }

  // Flip on front click (but not on action-btn clicks)
  card.querySelector(".card-front").addEventListener("click", e => {
    if (!e.target.closest(".action-btn")) card.classList.add("flipped");
  });

  card.querySelector(".back-flip").addEventListener("click", e => {
    e.stopPropagation();
    card.classList.remove("flipped");
  });

  return card;
}

// ── Front HTML ─────────────────────────────────────────────────────────────
function frontHtml(poster, post, info, vanityName) {
  const badges = [
    poster.verified ? `<span class="badge badge-v">✓</span>` : "",
    poster.premium  ? `<span class="badge badge-p">Pro</span>` : "",
    poster.connection_degree ? `<span class="badge badge-d">${esc(poster.connection_degree)}</span>` : "",
  ].join("");

  const tags = [];
  if (info.work_mode) tags.push(`<span class="tag">${ICONS.mode} ${esc(info.work_mode)}</span>`);
  const loc = info.location || "Not specified";
  tags.push(`<span class="tag">${ICONS.pin} ${esc(loc)}</span>`);

  const companyHtml = info.company
    ? `<div class="company-name">${esc(info.company)}</div>`
    : `<div class="company-name dim">Company not specified</div>`;

  const hasComp = info.compensation && info.compensation.toLowerCase() !== "null";
  const compHtml = hasComp ? `<div class="compensation-small">${esc(info.compensation)}</div>` : "";

  const btns = [];
  if (vanityName)
    btns.push(`<a class="action-btn btn-connect" href="https://www.linkedin.com/preload/custom-invite/?vanityName=${encodeURIComponent(vanityName)}" target="_blank" title="Connect on LinkedIn">${ICONS.connect}</a>`);
  if (info.contact_email)
    btns.push(`<button class="action-btn btn-email email-draft-btn" title="Draft email to ${esc(info.contact_email)}" data-email="${esc(info.contact_email)}">${ICONS.email}</button>`);
  if (info.apply_link)
    btns.push(`<a class="action-btn btn-apply" href="${esc(info.apply_link)}" target="_blank" title="Apply">${ICONS.apply}</a>`);

  return `
    <div class="front-wrap">
      <div class="front-top">
        ${avatarEl(poster)}
        <div class="front-top-meta">
          <div class="poster-name">
            ${poster.linkedin_url
              ? `<a href="${esc(poster.linkedin_url)}" target="_blank" onclick="event.stopPropagation()">${esc(poster.name || "Unknown")}</a>`
              : esc(poster.name || "Unknown")}
          </div>
          ${badges ? `<div class="poster-badges">${badges}</div>` : ""}
        </div>
        ${post.timestamp ? `<div class="front-time">${esc(post.timestamp)} ago</div>` : ""}
      </div>

      <div class="job-title">${esc(info.role || "Role not specified")}</div>

      <div class="tags">${tags.join("")}</div>

      <div class="front-spacer"></div>

      <div class="front-bottom">
        <div class="comp-loc">
          ${companyHtml}
          ${compHtml}
        </div>
        ${btns.length ? `<div class="actions">${btns.join("")}</div>` : ""}
      </div>
    </div>`;
}

// ── Back HTML ──────────────────────────────────────────────────────────────
function backHtml(info) {
  const skillsHtml = info.skills?.length
    ? `<div class="back-section">
         <div class="back-section-label">Tech Stack</div>
         <div class="skills-wrap">${info.skills.map(s => `<span class="skill-tag">${esc(s)}</span>`).join("")}</div>
       </div>`
    : "";

  const metaItems = [];
  if (info.experience_years) metaItems.push(`⏱ ${esc(info.experience_years)}`);
  if (info.work_mode)        metaItems.push(`${modeIcon(info.work_mode)} ${esc(info.work_mode)}`);
  if (info.location)         metaItems.push(`📍 ${esc(info.location)}`);

  return `
    <div class="back-wrap">
      <div class="back-header">
        <div class="back-title">${esc(info.role || "Details")}</div>
        <button class="back-flip" title="Flip back">${ICONS.back}</button>
      </div>

      ${info.summary ? `
        <div class="back-section">
          <div class="back-section-label">About the Role</div>
          <div class="back-summary">${esc(info.summary)}</div>
        </div>` : ""}

      ${skillsHtml}

      ${metaItems.length ? `
        <div class="back-section">
          <div class="back-section-label">Details</div>
          <div class="back-meta-row">${metaItems.map(m => `<span class="back-meta-item">${m}</span>`).join("")}</div>
        </div>` : ""}
    </div>`;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function avatarEl(poster) {
  if (poster?.profile_image_url)
    return `<img class="avatar" src="${esc(poster.profile_image_url)}" alt="">`;
  const initials = (poster?.name || "?").split(" ").map(w => w[0]).slice(0, 2).join("");
  return `<div class="avatar-placeholder">${esc(initials)}</div>`;
}

function modeIcon(m) {
  return { remote: "🏠", hybrid: "🔀", onsite: "🏢" }[m] || "📋";
}

function esc(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
