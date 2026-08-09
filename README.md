# SKONGA AI — Multi-Provider Backend

A single backend that unifies **Groq, OpenRouter, AIMLAPI, BazaarLink, and Gemini** under
one AI service (`generateAIResponse`), with automatic fallback,
rate limiting, retry logic, and usage statistics.

## Folder Structure

```
skonga-backend/
├── server.js                     # Entry point (Express app)
├── package.json
├── .env.example                  # Copy as .env and fill in your API keys
├── stats-snapshot.json           # (auto-created) usage stats snapshot
└── src/
    ├── config/
    │   └── index.js              # API keys, capability matrix, model IDs
    ├── providers/
    │   ├── _openaiCompatible.js  # Shared helper (chat/completions + streaming)
    │   ├── groqProvider.js
    │   ├── openrouterProvider.js
    │   ├── aimlapiProvider.js
    │   ├── bazaarlinkProvider.js
    │   └── geminiProvider.js     # Google AI Studio — free tier
    ├── services/
    │   ├── aiService.js          # generateAIResponse() — the fallback "brain"
    │   ├── statsService.js       # requests/failures/avg time/provider usage
    │   └── tavilyService.js      # Live Search (web search)
    ├── utils/
    │   ├── intentDetection.js    # auto-detect search/image-gen intent
    │   └── personalize.js        # injects userName/lang/style into the prompt
    ├── middleware/
    │   └── rateLimiter.js
    └── routes/
        ├── chat.js               # POST /api/chat, /api/chat/stream
        ├── chatSearch.js         # POST /api/chat-search (Live Search)
        ├── vision.js             # POST /api/vision
        ├── image.js              # POST /api/image (Educational only)
        ├── trending.js           # GET  /api/trending
        ├── feedback.js           # POST /api/feedback
        └── stats.js              # GET  /api/stats
```

## Getting Started (Termux, current testing)

```bash
cd skonga-backend
cp .env.example .env
nano .env          # fill in GROQ_API_KEY, OPENROUTER_API_KEY, AIMLAPI_KEY, BAZAARLINK_API_KEY, GEMINI_API_KEY, TAVILY_API_KEY
npm install
npm start          # or: node server.js
```

The server starts at `http://localhost:3000`. In the frontend, set
`API_BASE = "http://<phone-ip-or-localhost>:3000"`.

## Moving to Render (later)

1. Push this code to GitHub.
2. Render → New Web Service → connect the repo.
3. Build command: `npm install`  |  Start command: `node server.js`.
4. Add all the Environment Variables from `.env` in the Render dashboard.
5. Render will give you a URL like `https://xxxx.onrender.com` — that's your new `API_BASE`.

## Unified API

```
POST /api/chat
{
  "provider": "auto | groq | openrouter | aimlapi | bazaarlink | gemini",
  "task": "chat | reasoning | longContext",   // optional, default "chat"
  "message": "...",
  "history": [{ "role": "user"|"assistant", "content": "..." }],
  "systemPrompt": "...",
  "images": ["data:image/png;base64,...."],   // optional
  "userName": "...",                          // optional, personalizes replies
  "lang": "...",                               // optional
  "style": "..."                               // optional
}
```

Standardized response (from `generateAIResponse`):

```json
{
  "reply": "...",
  "providerUsed": "groq",
  "modelUsed": "llama-3.3-70b-versatile",
  "tokens": 512,
  "error": null
}
```

Other endpoints: `POST /api/vision`, `POST /api/image`, `POST /api/chat-search`
(Live Search with sources), `POST /api/chat/stream` (Server-Sent Events),
`GET /api/trending`, `POST /api/feedback`, `GET /api/stats`, `GET /health`.

## Which provider for which task?

| Task                        | First Choice | Why |
|------------------------------|--------------|-----|
| Regular chat                 | **Groq**     | Very high speed (LPU), low cost, plenty for everyday school questions |
| Vision / Image OCR            | **AIMLAPI** (or OpenRouter as backup) | Both have solid vision models; AIMLAPI is cheaper for high-volume OCR |
| Math solving                  | **Groq** (reasoning model) or **AIMLAPI o3-mini** for very hard problems | Groq is fast and cheap for everyday math; AIMLAPI's reasoning model handles tough NECTA/A-level problems |
| Image generation              | **AIMLAPI** (backups: **Pollinations** - free, no key; **Gemini** - free, needs billing enabled) | AIMLAPI is the primary; Pollinations.ai requires **zero setup** (no API key at all) and kicks in automatically if AIMLAPI credit runs out; Gemini is a further backup |
| Long-context conversations    | **OpenRouter** (Gemini 2.0 Flash / large context) | Many OpenRouter models have a much larger context window than Groq |
| Fallback / last resort        | **BazaarLink** | Only used if Groq, OpenRouter, and AIMLAPI have all failed |

`auto` mode order (changeable in `.env` → `PROVIDER_FALLBACK_ORDER`):

```
Groq → OpenRouter → AIMLAPI → Pollinations → BazaarLink → Gemini
```

> 💡 **Pollinations.ai needs zero setup** — no signup, no API key, no payment card. It just works out of the box as soon as AIMLAPI runs out of credit. For higher rate limits and no watermark, you can optionally register a free account at `https://pollinations.ai` and set `POLLINATIONS_API_KEY` in `.env`.

> 💡 **Gemini is completely free** — go to `https://aistudio.google.com/apikey`, sign in with a Google account, click "Create API Key", copy it, and set it in `.env` as `GEMINI_API_KEY=...`. No payment card required for chat/vision; note that image generation specifically may require billing to be enabled on the Google Cloud project even on the free tier. For image generation, the system tries AIMLAPI first, then Pollinations, then BazaarLink, then Gemini.

For every task, the system skips providers that lack the relevant capability
(e.g. vision) — so if you choose `provider:"auto"` and the task is vision,
Groq (no vision support) is skipped straight to AIMLAPI/OpenRouter.

## Cost-effective strategy (Bonus)

For an education app with many students and a tight budget:

1. **Make Groq the default for 80%+ of requests** (regular chat, short
   questions) — it's fast and its per-token cost is much lower than the others.
2. **Use OpenRouter only as a backup + for vision/long-context**, not the
   default — this keeps costs down since some OpenRouter models
   (especially from big-name labs) cost more per token.
3. **Reserve AIMLAPI for vision (OCR) and image generation only** — these
   are tasks Groq simply can't do at all, so the cost only kicks in
   when it's genuinely needed, not on every message.
4. **Keep BazaarLink as a "reserve tank"** — don't route regular traffic
   to it; it'll save the day on days when the other three providers all
   have downtime.
5. **Add simple caching** (e.g. cache answers to frequently repeated
   questions like "what is the NECTA syllabus?") to cut down on direct
   requests to providers.
6. **Check `/api/stats` weekly** — if a provider shows a high
   `avgTimeMs` or lots of `fails`, adjust the
   `PROVIDER_FALLBACK_ORDER` in `.env` without touching any code.
7. **Set a reasonable per-user rate limit** (already wired up via middleware)
   so a single user can't burn through everyone's budget in one day.

## Scaling to thousands of students

- The current `statsService` is in-memory + a JSON snapshot — for real
  production, swap it for Redis (for real-time stats) and Postgres
  (for long-term history / billing).
- Use a process manager (PM2) or Render's autoscaling instead of running
  `node server.js` alone.
- Consider a queue (BullMQ + Redis) for image generation since it takes
  noticeably longer than regular chat.
