// Gmail API helper — uses chrome.identity.getAuthToken (Chrome manages
// token refresh automatically; no redirect URI setup needed).

window.GmailAPI = (() => {

  const SCOPE = "https://www.googleapis.com/auth/gmail.send";

  // ── Token helpers ──────────────────────────────────────────────────────
  function getToken(interactive) {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive, scopes: [SCOPE] }, (token) => {
        if (chrome.runtime.lastError || !token) {
          reject(new Error(chrome.runtime.lastError?.message || "Auth failed."));
        } else {
          resolve(token);
        }
      });
    });
  }

  function removeToken(token) {
    return new Promise(r => chrome.identity.removeCachedAuthToken({ token }, r));
  }

  // ── Public ─────────────────────────────────────────────────────────────

  // First-time connect — shows Google account picker
  async function connect() {
    return getToken(true);
  }

  // True if Chrome already has a cached token (no popup needed)
  async function isConnected() {
    try {
      await getToken(false);
      return true;
    } catch {
      return false;
    }
  }

  async function disconnect() {
    try {
      const token = await getToken(false);
      await removeToken(token);
    } catch { /* already disconnected */ }
  }

  // Returns a valid token, re-authenticates silently if needed.
  // Chrome handles refresh automatically for getAuthToken.
  async function getValidToken() {
    try {
      return await getToken(false); // silent first
    } catch {
      return getToken(true);        // interactive fallback
    }
  }

  // ── MIME builder ───────────────────────────────────────────────────────
  function b64url(str) {
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function buildMime({ to, subject, body, attachmentName, attachmentDataUrl }) {
    const boundary = "----=_FeedParser_" + Math.random().toString(36).slice(2);
    const lines = [];

    lines.push(`To: ${to}`);
    lines.push(`Subject: ${subject}`);
    lines.push(`MIME-Version: 1.0`);

    if (attachmentDataUrl) {
      lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
      lines.push(``);
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: text/plain; charset="UTF-8"`);
      lines.push(`Content-Transfer-Encoding: quoted-printable`);
      lines.push(``);
      lines.push(body);
      lines.push(``);
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: application/pdf; name="${attachmentName}"`);
      lines.push(`Content-Disposition: attachment; filename="${attachmentName}"`);
      lines.push(`Content-Transfer-Encoding: base64`);
      lines.push(``);
      const b64Data = attachmentDataUrl.split(",")[1] || "";
      lines.push(b64Data.replace(/(.{76})/g, "$1\n"));
      lines.push(``);
      lines.push(`--${boundary}--`);
    } else {
      lines.push(`Content-Type: text/plain; charset="UTF-8"`);
      lines.push(``);
      lines.push(body);
    }

    return lines.join("\r\n");
  }

  // ── Send ───────────────────────────────────────────────────────────────
  async function sendEmail({ to, subject, body, attachmentName, attachmentDataUrl }) {
    let token = await getValidToken();
    const raw = b64url(buildMime({ to, subject, body, attachmentName, attachmentDataUrl }));

    const doSend = (t) => fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { "Authorization": `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });

    let res = await doSend(token);

    if (res.status === 401) {
      // Token stale — remove and retry once with a fresh one
      await removeToken(token);
      token = await getToken(true);
      res   = await doSend(token);
    }

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Gmail API ${res.status}: ${err.slice(0, 200)}`);
    }
    return res.json();
  }

  return { isConnected, connect, disconnect, sendEmail };
})();
