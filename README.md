# Tenant Rights Checker

A free tool that helps renters figure out if their landlord is breaking the law.

You describe your problem, tell us where you live, and get back a clear answer with the exact law that applies, a ready-to-send email to your landlord, a formal demand letter, local resources, and a downloadable PDF of everything.

---

## What problem does this solve?

Most renters have no idea what their rights are. When something goes wrong (landlord keeps the deposit, enters without notice, ignores repairs), the first instinct is to Google it or ask ChatGPT. But:

- Google gives you generic articles, not the specific law for your state.
- ChatGPT gives you a long paragraph that might be wrong, and you lose it in your chat history.
- Neither gives you an email you can actually send, a demand letter, or a way to escalate step by step.

This tool fixes that. It asks the right questions, finds the right law, and gives you everything you need to take action, all in one page you can save and download as a PDF.

---

## How is this different from ChatGPT or Claude?

| Feature | ChatGPT / Claude | Tenant Rights Checker |
|---|---|---|
| Asks for your state before answering | No | Yes, required first step |
| Checks if the cited law URL actually exists | No | Yes, verifies every URL |
| Gives you a ready-to-send email | Sometimes, if you ask | Yes, automatically |
| Formal demand letter | Only if you prompt it right | One click |
| Escalation path (email, letter, agency complaint, court filing) | No | Built-in 4-step ladder |
| Shows what your landlord will argue back | No | Yes, with rebuttals |
| Evidence checklist for your specific problem | No | Yes, auto-detected |
| Downloadable PDF of everything | No | Yes |
| Saves your results to come back later | Gets lost in chat | Yes, with optional sign-in |
| Blocks off-topic and dangerous prompts | No | Yes, safety gate |

---

## Can this work as a plugin or app for ChatGPT and Claude?

Yes. The backend API routes (`/api/analyze`) accept JSON and return structured JSON. This means:

- You can wrap the API as a **Custom GPT Action** in OpenAI's GPT Builder.
- You can expose it as a **Claude Tool** (function calling) in the Anthropic API.
- You can build a small **MCP server** (Model Context Protocol) that forwards payloads to this API.
- You can integrate it into any chatbot, Slack bot, or internal tool.

The key benefit of using this as a plugin is that the tenant-law workflow (jurisdiction check, safety gate, citation verification, structured output) is handled by this tool, while the general AI handles conversation and follow-up questions.

---

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## How to use it

1. Open the app.
2. Pick an AI provider (Groq is free) and paste your API key.
3. Describe your problem in plain English.
4. Tell us your state or country, and optionally your city.
5. Review and hit "Run check."
6. Get your results: verdict, law, email draft, demand letter, escalation steps, local resources, and PDF.

You do not need to sign in. Login is optional and only needed if you want to save your results and come back later.

---

## Your API key is safe

This is the most important part. We never store your API key on any server or database. Here is exactly what happens:

1. You paste your key in the browser.
2. It is encrypted and saved in a **secure browser cookie** (httpOnly, sameSite strict, HTTPS-only in production).
3. The cookie auto-expires after **30 minutes** of inactivity.
4. JavaScript on the page **cannot read** the cookie (httpOnly flag).
5. The key is only sent to **our server** when you run a check, and the server uses it to call your AI provider (Groq, OpenAI, etc.) on your behalf.
6. The key is **never** stored in Supabase, localStorage, or any database.
7. On a shared computer, you can remove the key from Settings, or use incognito mode.

Even if someone intercepts the browser traffic, the cookie is:
- Not readable by client-side JavaScript (prevents XSS attacks)
- Locked to this site only (sameSite strict prevents CSRF)
- Encrypted in transit (HTTPS in production via HSTS)
- Time-limited (30-minute auto-expiry)

---

## Environment variables

Copy `.env.example` to `.env.local`.

| Variable | Required | What it does |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | For login/save only | Supabase project URL. Not needed if you just want to use the tool without saving. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | For login/save only | Supabase anon key. Row-level security protects user data. |
| `RATE_LIMIT_AI_PER_MINUTE` | No | Max API requests per IP per minute. Default is 24. |
| `CONFIG_ENCRYPTION_KEY` | Production only | Long random secret used to encrypt short-lived API key cookies. Production rejects key saving if this is missing. |

---

## Supabase setup (optional, for login and saved results)

You only need Supabase if you want users to sign in and save their results. The tool works without it.

1. Create a project at [supabase.com](https://supabase.com).
2. Run `supabase/migrations/001_saved_chats.sql` in the SQL editor.
3. Go to Authentication > Providers and enable **Email** magic link.
4. Go to Authentication > URL Configuration:
   - Site URL: `http://localhost:3000`
   - Redirect URL: `http://localhost:3000/auth/callback`
5. Copy the project URL and anon key to `.env.local`.

---

## Security measures

This project takes security seriously. Here is what is implemented:

**API key protection:**
- httpOnly cookie (JS cannot read it)
- AES-GCM encryption before the key is written to the cookie
- sameSite strict (prevents CSRF)
- Secure flag in production (HTTPS only)
- 30-minute auto-expiry
- Never stored in any database
- Provider whitelist validation (only groq, gemini, openai, claude)
- Key length validation (rejects obviously invalid keys)

**Input safety:**
- 48 blocked terms for prompt injection, social engineering, and abuse
- Tenant-topic requirement (rejects off-topic prompts)
- Input length limits (situation max 5000 chars, location max 100 chars)
- Server-side validation on every API request (not just client-side)

**Network security:**
- IP-based rate limiting (24 requests per minute default)
- Content Security Policy header (restricts what can load)
- X-Frame-Options DENY (prevents clickjacking)
- X-Content-Type-Options nosniff
- Strict-Transport-Security (forces HTTPS)
- Referrer-Policy strict-origin-when-cross-origin
- Permissions-Policy (disables camera, microphone, geolocation)
- Server fingerprint headers removed

**Application security:**
- No user API keys stored on the server
- All AI calls go through server-side route handlers (client never calls AI directly)
- URL verification on every cited law source
- Unsafe AI-generated links are filtered to HTTPS links before rendering
- Citation verification blocks localhost, private-network, and metadata hosts
- Supabase Row Level Security on all user data

---

## Features

- Verdict with governing statute and source link
- Ready-to-send email template
- Formal demand letter (generated on demand)
- What your landlord will argue (with rebuttals and evidence needed)
- Evidence checklist (auto-detected by dispute type)
- 4-level escalation ladder (email, demand letter, agency complaint, court filing)
- Citation verification with inline badges (Verified, Official, General web, Unverified)
- Deadlines and response windows
- Case timeline
- Local tenant resources (legal aid, housing agencies, hotlines)
- PDF export of everything
- Dark and light mode
- Mobile responsive
- Optional sign-in to save results

---

## Project structure

```
src/
  app/
    page.tsx              Main UI (single-page app)
    globals.css           All styles
    api/
      analyze/route.ts    AI analysis endpoint (all 5 actions)
      config/route.ts     API key cookie management
    auth/
      callback/route.ts   Magic link callback
  components/
    JurisdictionField.tsx  Location autocomplete
  lib/
    ai-providers.ts       Provider config (Groq, Gemini, OpenAI, Claude)
    chat-storage.ts       Supabase CRUD for saved results
    evidence-checklists.ts Evidence items by dispute type
    pdf-generator.ts      Custom jsPDF report builder
    prompts.ts            All AI system and user prompts
    rate-limit.ts         IP-based sliding window limiter
    safety.ts             Input validation and blocked terms
    strings.ts            All UI text (single source of truth)
    types.ts              TypeScript interfaces
    xml-parser.ts         Parse structured AI responses
  middleware.ts           Security headers and Supabase session refresh
```

---

## License

MIT
