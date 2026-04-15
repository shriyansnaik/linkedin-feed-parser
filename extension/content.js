// LinkedIn Feed Parser — content script
// Runs on linkedin.com, responds to messages from the popup.

function parsePostElement(el) {
  // --- Profile URL ---
  let profileUrl = null;
  for (const a of el.querySelectorAll("a[href]")) {
    if (/https:\/\/www\.linkedin\.com\/in\/[^/]+\/?$/.test(a.href)) {
      profileUrl = a.href.replace(/\/$/, "");
      break;
    }
  }

  // --- Name, degree, verified ---
  let name = null, verified = false, connectionDegree = null;
  const ariaDiv = el.querySelector("div[aria-label]");
  if (ariaDiv) {
    const label = ariaDiv.getAttribute("aria-label") || "";
    const degreeMatch = label.match(/\b(1st|2nd|3rd)\b/);
    if (degreeMatch) connectionDegree = degreeMatch[1];
    verified = label.includes("Verified");
    const nameMatch = label.match(
      /^(.+?)(?:,?\s+(?:Verified|Premium|Hiring|Profile)|\s+\d(?:st|nd|rd))/
    );
    if (nameMatch) name = nameMatch[1].trim().replace(/,$/, "");
  }

  // --- Premium (LinkedIn logo SVG = Premium badge) ---
  const premium = !!el.querySelector("svg#linkedin-bug-small");

  // --- Profile image ---
  let profileImage = null;
  const img = el.querySelector("img[alt*=\"profile\"]");
  if (img) profileImage = img.src;

  // --- Headline ---
  let headline = null;
  for (const p of el.querySelectorAll("p")) {
    const text = p.textContent.trim();
    if (
      text.length > 30 &&
      !/^\d+[hmd]\s*[•·]/.test(text) &&
      !/^\d+\s+reaction/i.test(text) &&
      !/^\d+\s+repost/i.test(text) &&
      !/^\d+\s+comment/i.test(text) &&
      (!name || !text.includes(name))
    ) {
      headline = text;
      break;
    }
  }

  // --- Timestamp & visibility ---
  let timestamp = null, visibility = null;
  for (const p of el.querySelectorAll("p")) {
    const text = p.textContent.trim();
    if (/^\d+[hmd]\s*[•·]/.test(text) || /^\d+d\s*[•·]/.test(text) || /^\d+[hmd]\s*•/.test(text)) {
      const tsMatch = text.match(/^(\d+[hmd])/);
      if (tsMatch) timestamp = tsMatch[1];
      const visSvg = p.querySelector("svg[aria-label]");
      if (visSvg) {
        const lbl = visSvg.getAttribute("aria-label") || "";
        if (lbl.includes("Visibility")) visibility = lbl.replace("Visibility: ", "").trim();
      }
      break;
    }
  }

  // --- Post text (clone node to avoid mutating the page DOM) ---
  let postText = null;
  const textBox = el.querySelector("[data-testid='expandable-text-box']");
  if (textBox) {
    const clone = textBox.cloneNode(true);
    clone.querySelectorAll("button").forEach((b) => b.remove());
    clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    postText = clone.textContent.replace(/\n{3,}/g, "\n\n").trim();
  }

  // --- Hashtags ---
  const hashtags = postText
    ? [...postText.matchAll(/#\w+/g)].map((m) => m[0])
    : [];

  // --- Reactions, comments, reposts ---
  let reactions = null, comments = null, reposts = null;
  for (const span of el.querySelectorAll("span._812797c9")) {
    const t = span.textContent.trim();
    if (/^\d+\s+reaction/i.test(t)) reactions = parseInt(t, 10);
    else if (/^\d+\s+repost/i.test(t)) reposts = parseInt(t, 10);
    else if (/^\d+\s+comment/i.test(t)) comments = parseInt(t, 10);
  }

  return {
    poster: {
      name,
      linkedin_url: profileUrl,
      headline,
      connection_degree: connectionDegree,
      verified,
      premium,
      profile_image_url: profileImage,
    },
    post: {
      text: postText,
      hashtags,
      timestamp,
      visibility,
      reactions,
      comments,
      reposts,
    },
  };
}

function parseFeed() {
  const all = [...document.querySelectorAll("div[role='listitem']")];

  // Keep only outermost listitems (skip nested ones inside reposts/shares)
  const topLevel = all.filter((el) => {
    let parent = el.parentElement;
    while (parent) {
      if (parent.getAttribute("role") === "listitem" && all.includes(parent))
        return false;
      parent = parent.parentElement;
    }
    return true;
  });

  return topLevel
    .map((el) => parsePostElement(el))
    .filter((p) => p.poster.name || p.post.text);
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.action === "parse") {
    try {
      const posts = parseFeed();
      respond({ ok: true, posts, count: posts.length });
    } catch (err) {
      respond({ ok: false, error: err.message });
    }
  }
  return true; // keep channel open for async respond
});
