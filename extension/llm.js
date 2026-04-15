// LLM client — OpenAI-compatible, round-robin + per-key rate-limit tracking
window.LLM = (() => {

  const BASE_URLS = {
    openai:     "https://api.openai.com/v1",
    groq:       "https://api.groq.com/openai/v1",
    together:   "https://api.together.xyz/v1",
    mistral:    "https://api.mistral.ai/v1",
    openrouter: "https://openrouter.ai/api/v1",
    custom:     null,
  };

  // keyId -> timestamp when the key becomes usable again
  const rateLimitedUntil = {};
  let rrIndex = 0;

  function getBaseUrl(key) {
    return key.provider === "custom"
      ? key.baseUrl.replace(/\/$/, "")
      : (BASE_URLS[key.provider] || "");
  }

  // Pick next available (non-rate-limited) key
  function pickKey(keys) {
    const now = Date.now();
    // Build ordered list starting from rrIndex, skip limited keys
    for (let i = 0; i < keys.length; i++) {
      const k = keys[(rrIndex + i) % keys.length];
      if ((rateLimitedUntil[k.id] || 0) <= now) {
        rrIndex = (rrIndex + i + 1) % keys.length;
        return k;
      }
    }
    return null; // all keys limited
  }

  // Returns ms until the soonest key recovers
  function msUntilNextKey(keys) {
    const now = Date.now();
    const earliest = Math.min(...keys.map(k => rateLimitedUntil[k.id] || 0));
    return Math.max(0, earliest - now);
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const SYSTEM_PROMPT = `You are a LinkedIn job post parser.
Output ONLY a single raw JSON object. No markdown, no code fences, no explanation, no <think> blocks. Just the JSON.

Required fields:
- is_job_post: true if this is a job opening/hiring post, false otherwise
- role: job title (string or null)
- company: hiring company name (string or null)
- location: city/country name, "Remote", "Multiple locations", or "Not specified"
- work_mode: "remote", "hybrid", or "onsite" (infer from context, or null)
- experience_years: e.g. "3-7 years" or "5+ years" (string or null)
- skills: array of specific technologies, tools, languages (keep it concise, max 10)
- compensation: salary/CTC/range as stated (string or null)
- apply_link: job application URL if present (string or null)
- contact_email: email address if present (string or null)
- summary: 1-2 sentence plain description of the role and key requirements

If not a job post: is_job_post=false, role/company/location/etc. all null, skills=[].`;

  // Close any unclosed brackets/braces in a truncated JSON string
  function repairJson(str) {
    let s = str.trimEnd();

    // Remove a trailing comma (last field before truncation)
    s = s.replace(/,\s*$/, "");

    // Walk the string tracking open structures (skip strings)
    const stack = [];
    let inString = false, escape = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (escape)              { escape = false; continue; }
      if (c === "\\" && inString) { escape = true; continue; }
      if (c === '"')           { inString = !inString; continue; }
      if (inString)            continue;
      if      (c === "{")  stack.push("}");
      else if (c === "[")  stack.push("]");
      else if (c === "}" || c === "]") stack.pop();
    }

    // Close whatever is still open (in reverse order)
    while (stack.length) s += stack.pop();
    return s;
  }

  // Ensure all expected fields exist (truncated responses may be missing some)
  function withDefaults(obj) {
    return {
      is_job_post:      obj.is_job_post      ?? false,
      role:             obj.role             ?? null,
      company:          obj.company          ?? null,
      location:         obj.location         ?? "Not specified",
      work_mode:        obj.work_mode        ?? null,
      experience_years: obj.experience_years ?? null,
      skills:           Array.isArray(obj.skills) ? obj.skills : [],
      compensation:     obj.compensation     ?? null,
      apply_link:       obj.apply_link       ?? null,
      contact_email:    obj.contact_email    ?? null,
      summary:          obj.summary          ?? null,
    };
  }

  async function callOnce(key, postText) {
    const baseUrl = getBaseUrl(key);
    const url = `${baseUrl}/chat/completions`;

    // No response_format — causes 400 on Groq when tokens run out mid-object.
    // Our manual JSON extraction handles all providers uniformly.
    const body = {
      model: key.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: postText.slice(0, 3000) },
      ],
      temperature: 0,
      max_tokens: 4000,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key.apiKey}`,
        "HTTP-Referer": "chrome-extension://linkedin-feed-parser",
        "X-Title": "LinkedIn Feed Parser",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      // Parse retry-after header, fall back to 60s
      const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
      const waitMs = retryAfter * 1000;
      rateLimitedUntil[key.id] = Date.now() + waitMs;
      const err = new Error(`Rate limited (key …${key.apiKey.slice(-4)}). Retry in ${retryAfter}s`);
      err.isRateLimit = true;
      err.waitMs = waitMs;
      throw err;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      throw new Error(`API ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    let content = data.choices?.[0]?.message?.content || "";

    // Strip <think>…</think> chain-of-thought blocks (Qwen, DeepSeek, etc.)
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    // Strip markdown code fences if model still adds them
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    // Extract whatever JSON object we can find (may be truncated)
    const start = content.indexOf("{");
    if (start === -1) {
      console.error("[LLM] No JSON found. Raw response:", content);
      throw new Error("No JSON in response. Check DevTools Console for the raw output.");
    }

    const raw = repairJson(content.slice(start));

    try {
      const parsed = JSON.parse(raw);
      // Fill any fields the model didn't reach before truncation
      return withDefaults(parsed);
    } catch (e) {
      console.error("[LLM] JSON parse failed after repair. Repaired string:", raw);
      console.error("[LLM] Original content:", content);
      throw new Error("Couldn't parse LLM response. Check DevTools Console.");
    }
  }

  // Public: extract with retry + rate-limit awareness
  // onWait(secondsRemaining) called when sleeping for rate limits
  async function extractJobInfo(postText, keys, onWait) {
    if (!postText?.trim()) {
      return {
        is_job_post: false, role: null, company: null, location: null,
        work_mode: null, experience_years: null, skills: [],
        compensation: null, apply_link: null, contact_email: null, summary: null,
      };
    }

    const MAX_ATTEMPTS = keys.length + 2; // try each key + a couple retries after sleep

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const key = pickKey(keys);

      if (!key) {
        // All keys rate-limited — sleep until the soonest one recovers
        const waitMs = msUntilNextKey(keys);
        const waitSec = Math.ceil(waitMs / 1000);
        console.warn(`[LLM] All keys rate-limited. Sleeping ${waitSec}s…`);
        if (onWait) onWait(waitSec);
        await sleep(waitMs + 500);
        continue;
      }

      try {
        return await callOnce(key, postText);
      } catch (err) {
        if (err.isRateLimit) {
          // This key is now marked limited; loop will pick another
          console.warn("[LLM]", err.message);
          continue;
        }
        throw err; // non-rate-limit errors bubble up immediately
      }
    }

    throw new Error("All API keys are rate-limited. Try again later.");
  }

  async function generateEmail(jobInfo, userProfile, keys, extraInstruction = "") {
    const key = pickKey(keys);
    if (!key) throw new Error("No LLM keys configured.");

    const userName  = userProfile?.name  || "the applicant";
    const userBio   = userProfile?.bio   || "";
    const userExtra = userProfile?.extra || "";
    const userPhone = userProfile?.phone || "";

    const signature = [
      "Best Regards,",
      userName,
      userPhone,
    ].filter(Boolean).join("\\n");

    const prompt = `You are writing a cold outreach job application email.
Return ONLY a JSON object with exactly two string fields: "subject" and "body".
No markdown, no explanation, no <think> blocks. Just the JSON.

Job details:
- Role: ${jobInfo.role || "the advertised position"}
- Company: ${jobInfo.company || "the company"}
- Required skills: ${(jobInfo.skills || []).join(", ") || "not specified"}
- Experience needed: ${jobInfo.experience_years || "not specified"}
- Summary: ${jobInfo.summary || ""}

Applicant background (treat this as their resume summary):
- Name: ${userName}
- Profile: ${userBio}
${userExtra ? `- Additional context: ${userExtra}` : ""}
${extraInstruction ? `\nSpecial instructions: ${extraInstruction}` : ""}

Email rules:
- subject: concise and specific to the role and company
- body: 3 short paragraphs:
    1. Hook — why you're reaching out for THIS specific role at THIS company
    2. Why you fit — reference 1-2 skills from the JD that match the applicant's background
    3. Call to action — brief, confident close
- Address recruiter as "Hi" (name unknown)
- Max 160 words in the body (excluding signature)
- Use \\n for paragraph breaks and line breaks within the signature
- End the body with exactly this signature on its own lines: ${signature}
- Warm but professional, NOT generic corporate speak
- No placeholder text like [Your Name] or [Company]`;

    const res = await fetch(`${getBaseUrl(key)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key.apiKey}`,
        "HTTP-Referer": "chrome-extension://linkedin-feed-parser",
        "X-Title": "LinkedIn Feed Parser",
      },
      body: JSON.stringify({
        model: key.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 800,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`API ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    let content = (data.choices?.[0]?.message?.content || "").trim();
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    const start = content.indexOf("{");
    if (start === -1) throw new Error("No JSON in email response.");

    const parsed = JSON.parse(repairJson(content.slice(start)));
    return {
      subject: parsed.subject || "",
      body:    parsed.body    || "",
    };
  }

  return { extractJobInfo, generateEmail };
})();
