/**
 * Default configuration for Smart News Radar
 *
 * NOTE: API keys are NEVER stored in this file.
 * Users enter their keys through the Settings page (options.html),
 * and those keys are persisted in chrome.storage.local.
 *
 * This file only holds non-sensitive defaults such as endpoints,
 * request parameters, and UI defaults.
 */

const CONFIG = {
  // GNews.io (Layer 1 — News Fetcher)
  GNEWS_ENDPOINT: "https://gnews.io/api/v4/search",
  GNEWS_LANG: "en",
  GNEWS_MAX_RESULTS: 10,

  // Google Gemini Flash (Layer 2 — AI Analysis)
  // We try a list of model names in order, falling back to the next if
  // the first one returns 404 (older or rotated model IDs). This avoids
  // hard-coding one that may be retired by Google.
  GEMINI_BASE: "https://generativelanguage.googleapis.com/v1beta/models/",
  GEMINI_MODELS: [
    "gemini-2.0-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash",
    "gemini-flash-latest"
  ],

  // Storage keys (chrome.storage.local)
  STORAGE_KEYS: {
    GNEWS_KEY: "gnews_api_key",
    GEMINI_KEY: "gemini_api_key",
    SAVED_TOPICS: "saved_topics",
    AI_TOGGLE: "ai_analysis_enabled",
    LAST_TOPIC: "last_topic"
  },

  // Limits
  MAX_SAVED_TOPICS: 8
};

// Make available in both extension contexts (popup/options)
if (typeof window !== "undefined") {
  window.CONFIG = CONFIG;
}
