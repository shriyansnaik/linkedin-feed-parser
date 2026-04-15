# LinkedIn Feed Parser

A Chrome extension that reads your LinkedIn feed, extracts job posts using an LLM, and displays them as clean flip-cards — with one-click email drafting and direct Gmail send with resume attached.

## Features

- **Auto-parses your feed** — no copy-pasting. Click Parse in the popup and every post is read directly from the page.
- **LLM extraction** — pulls out role, company, location, work mode, skills, experience, compensation, apply link, and contact email.
- **Flip-card UI** — front shows the summary; click to flip and see tech stack, details, and a full role description.
- **Multi-key round-robin** — add multiple API keys and the extension rotates between them, tracking rate limits per key automatically.
- **Email drafting** — generates a personalised cold-outreach email using your profile and the job details. Drafts are cached so you don't waste LLM calls.
- **Gmail send** — sends the email directly from the extension with your resume auto-attached (PDF stored locally).
- **Sent tracking** — once an email is sent, the card's email icon turns green and is disabled.

## Installation

1. Clone or download this repo.
2. Copy `extension/bundled_keys.example.js` → `extension/bundled_keys.js` (you can leave it empty and add keys via Settings instead).
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `extension/` folder.

## Adding LLM Keys

Open the extension popup → **Settings** → **API Keys** → add one or more keys.

Supported providers: OpenAI, Groq, Together AI, Mistral, OpenRouter, or any OpenAI-compatible endpoint (Ollama, etc.).

Recommended free option: [Groq](https://console.groq.com) with `llama-3.3-70b-versatile` or `qwen/qwen3-32b`.

## Profile Setup

Settings → **Profile** — add your name, phone number, a one-liner bio, and upload a PDF resume. These are used to personalise email drafts and auto-attach the resume when sending.

## Gmail Integration (optional)

Lets you send emails directly from the extension with resume attached, instead of opening a Gmail compose tab.

**One-time setup:**

1. Go to [Google Cloud Console → Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) and click **Enable**.
2. Go to [Credentials](https://console.cloud.google.com/apis/credentials) → **+ Create Credentials → OAuth 2.0 Client ID**.
   - Application type: **Chrome Extension**
   - Item ID: your extension's ID from `chrome://extensions`
3. Go to [OAuth consent screen → Audience](https://console.cloud.google.com/auth/audience) → **Test users** → add your Gmail address.
4. Copy the generated Client ID and paste it into `extension/manifest.json` under `oauth2.client_id`.
5. Reload the extension → Settings → **Email / Gmail** → **Connect Google Account**.

## Usage

1. Go to your LinkedIn feed and scroll to load posts.
2. Click the extension icon → **Parse Feed**.
3. The results page opens and processes each post in parallel.
4. Use the **Jobs only** toggle to filter non-job posts.
5. Click a card to flip it and see full details.
6. Click the email icon to open a draft — edit, regenerate with an instruction, or send directly.

## Sharing with a Friend

Settings → **API Keys** → **Generate bundled_keys.js** — exports your keys into a file. Paste it over `extension/bundled_keys.js` in the folder, zip the `extension/` folder, and send. Your friend loads it as an unpacked extension with keys pre-configured.

## Privacy

All data (API keys, profile, resume, parsed posts, email drafts) is stored locally in `chrome.storage.local`. Nothing is sent anywhere except the LLM provider you configure and the Gmail API if you connect it.
