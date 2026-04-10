# 📡 Smart News Radar

A lightweight Chrome Extension that fetches the latest news on any topic, with an optional AI-powered analysis layer.

![Smart News Radar preview](screenshot-placeholder.png)

> _Screenshot / GIF placeholder — add a real capture of the popup here._

---

## ✨ Features

**Layer 1 — News Fetcher (always on, no AI required)**

- Search bar for any keyword or topic (e.g. "AI agents", "NIFTY 50", "US-Iran conflict", "IPL 2026")
- Save up to **8 favorite topics** as quick-access chips
- **10 latest headline cards** per search with title, source, relative time, and thumbnail
- Clicking a headline opens the article in a new tab
- Refresh button to re-fetch the current topic
- All saved topics persist across browser sessions via `chrome.storage.local`

**Layer 2 — AI Analysis (toggle on/off, optional)**

- Toggle switch in the popup header — **off by default**
- When enabled, the 10 fetched headlines are sent to **Google Gemini Flash** which returns:
  - A 2–3 line executive summary
  - An overall sentiment (Positive / Negative / Mixed / Neutral) shown as a colored badge
  - One key insight or trend across the headlines
- The AI card is shown in a highlighted box above the news cards
- If the AI call fails or no Gemini key is set, Layer 1 still works normally

**Other niceties**

- Dark, minimal, modern UI (system fonts only)
- Skeleton loading cards while fetching
- Friendly error states for missing keys, rate limits, no results, and network errors
- Settings page for API keys — keys are **never hardcoded**

---

## 🛠 Installation

1. **Clone or download** this repository:
   ```bash
   git clone https://github.com/<your-username>/smart-news-radar.git
   ```
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer Mode** (top-right toggle).
4. Click **Load Unpacked** and select the `smart-news-radar/` folder.
5. Click the extension icon in the toolbar → click the ⚙️ gear → **Settings**.
6. Paste your **GNews API key** (required). Optionally paste your **Gemini API key** (for AI Analysis).
7. Click **Save**, open the popup again, type a topic, and hit Search.

---

## 🔑 How to get free API keys

- **GNews (required)** — sign up at [gnews.io](https://gnews.io/) and grab your API key from the dashboard. The free tier gives you **100 requests/day**.
- **Gemini (optional, for AI Analysis)** — generate a free key at [Google AI Studio](https://aistudio.google.com/app/apikey). The free tier of `gemini-1.5-flash` is more than enough for occasional news analysis.

Both keys are stored **only on your device** via `chrome.storage.local` and are sent only to the respective APIs.

---

## 🧱 Tech stack

- Chrome Extension **Manifest V3**
- Vanilla **HTML / CSS / JavaScript** — no frameworks, no build tools, no npm
- **GNews.io** REST API for headlines
- **Google Gemini Flash** (`gemini-1.5-flash-latest`) for optional analysis
- `chrome.storage.local` for persisting keys, saved topics, and UI state

---

## 📁 Project structure

```
smart-news-radar/
├── manifest.json     # Manifest V3 definition
├── popup.html        # Extension popup UI
├── popup.css         # Popup styles (dark theme)
├── popup.js          # Popup logic — API calls, rendering, storage
├── options.html      # Settings page
├── options.css       # Settings styles
├── options.js        # Settings logic (saves API keys)
├── config.js         # Non-sensitive defaults (endpoints, limits)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## 🚦 Error handling

| Situation | What you see |
|-----------|--------------|
| No GNews key set | Friendly "Set up your GNews API key in Settings" message with a link to open Settings |
| Daily rate limit hit | "Daily limit reached. Try again tomorrow." |
| Network error | "Can't connect. Check your internet." |
| Invalid API key | "Your GNews API key looks invalid. Open Settings to update it." |
| Empty search box | "Enter a topic to search" |
| No articles found | "No news found for this topic. Try different keywords." |
| Gemini fails while AI toggle is on | Silently falls back — only the headlines are shown |

---

## 🔮 Future improvements

- **Topic-specific push notifications** for breaking news in saved topics
- **Multi-language support** using the GNews `lang` parameter
- **Country filter** chips (IN, US, GB, etc.)
- **Bookmark / save article** so users can build their own reading list
- **Historical trend view** by caching past analyses and charting sentiment over time
- **Share card** — export the AI analysis as an image
- **Keyboard shortcuts** to open the popup and re-run last search
- **Pluggable AI provider** (Claude, Gemini, local LLM via Ollama)

---

## 📄 License

MIT — use it, fork it, remix it.
