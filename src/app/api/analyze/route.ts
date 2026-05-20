import { NextRequest, NextResponse } from 'next/server';
import type { AIProvider } from '@/lib/types';
import { getTag, parseCitation, parseDeadlines, parseOrgs, parseTimeline, parseCounterArguments, parseAgencyComplaint, parseCourtFiling } from '@/lib/xml-parser';
import {
  getMainAnalysisSystemPrompt,
  buildMainAnalysisUserPrompt,
  getNuclearSystemPrompt,
  buildNuclearUserPrompt,
  getOrgsFallbackSystemPrompt,
  buildOrgsFallbackUserPrompt,
  getCounterArgumentsSystemPrompt,
  buildCounterArgumentsUserPrompt,
  getAgencyComplaintSystemPrompt,
  buildAgencyComplaintUserPrompt,
  getCourtFilingSystemPrompt,
  buildCourtFilingUserPrompt,
} from '@/lib/prompts';
import { consumeAnalyzeRateLimit, getRequestIp } from '@/lib/rate-limit';
import { validateTenantComplaint } from '@/lib/safety';
import {
  CONFIG_COOKIE_MAX_AGE,
  CONFIG_COOKIE_NAME,
  encryptConfig,
  readEncryptedConfig,
} from '@/lib/secure-config';

const REFRESHED_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: CONFIG_COOKIE_MAX_AGE,
};

async function resolveAiConfig(req: NextRequest): Promise<{ apiKey: string; provider: AIProvider } | null> {
  const fromCookie = await readEncryptedConfig(req);
  if (fromCookie?.apiKey?.trim()) return fromCookie;
  return null;
}

async function callGemini(system: string, user: string, apiKey: string): Promise<string> {
  const models = [
    { model: 'gemini-2.0-flash', tools: [{ google_search: {} }] },
    { model: 'gemini-1.5-flash', tools: [{ googleSearchRetrieval: {} }] },
  ];
  let lastError = '';
  for (const { model, tools } of models) {
    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ parts: [{ text: user }] }],
            tools,
            generationConfig: { maxOutputTokens: 2048, temperature: 0.3 },
          }),
        }
      );
      if (res.status === 401) throw new Error('Invalid API key. Check your key at aistudio.google.com.');
      if (res.status === 429) throw new Error('Rate limited. Wait 60 seconds and try again.');
      if (!res.ok) {
        const err = await res.json();
        const msg = err.error?.message || 'Gemini error (' + res.status + ')';
        if (res.status === 404 || msg.includes('not found')) {
          lastError = msg;
          continue;
        }
        throw new Error(msg);
      }
      const data = await res.json();
      if (!data.candidates?.[0]?.content?.parts) throw new Error('Empty response from Gemini.');
      return data.candidates[0].content.parts
        .filter((p: { text?: string }) => p.text)
        .map((p: { text: string }) => p.text)
        .join('\n');
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Invalid API key') || msg.includes('Rate limited')) throw err;
      lastError = msg;
    }
  }
  throw new Error(lastError || 'Gemini request failed.');
}

async function callGroq(system: string, user: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });
  if (res.status === 401) throw new Error('Invalid Groq API key. Check at console.groq.com.');
  if (res.status === 429) throw new Error('Rate limited. Wait 60 seconds and try again.');
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.error?.message || 'Groq error');
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callClaude(system: string, user: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (res.status === 401) throw new Error('Invalid Claude API key. Check at console.anthropic.com.');
  if (res.status === 429) throw new Error('Rate limited. Wait 60 seconds and try again.');
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.error?.message || 'Claude error');
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function callOpenAI(system: string, user: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });
  if (res.status === 401) throw new Error('Invalid OpenAI API key.');
  if (res.status === 429) throw new Error('Rate limited. Wait 60 seconds and try again.');
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.error?.message || 'OpenAI error');
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function callProvider(provider: string, system: string, user: string, apiKey: string): Promise<string> {
  switch (provider) {
    case 'gemini':
      return callGemini(system, user, apiKey);
    case 'groq':
      return callGroq(system, user, apiKey);
    case 'claude':
      return callClaude(system, user, apiKey);
    case 'openai':
      return callOpenAI(system, user, apiKey);
    default:
      throw new Error('Unsupported provider: ' + provider);
  }
}

async function jsonWithRefreshedConfig(
  payload: Record<string, unknown>,
  config: { apiKey: string; provider: AIProvider }
) {
  const response = NextResponse.json(payload);
  const refreshed = await encryptConfig(config.apiKey, config.provider);
  response.cookies.set(CONFIG_COOKIE_NAME, refreshed, REFRESHED_COOKIE_OPTIONS);
  return response;
}

function sanitizeLawUrl(raw: string): string {
  const u = raw.trim();
  if (!u || !/^https:\/\//i.test(u)) return '';
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:') return '';
    if (isBlockedFetchHost(parsed.hostname)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function isBlockedFetchHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === 'metadata.google.internal' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    return true;
  }
  if (host === '::1' || host.startsWith('127.') || host.startsWith('10.') || host.startsWith('169.254.')) {
    return true;
  }
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part))) {
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  }
  return false;
}

function resolveRedirectUrl(currentUrl: string, location: string | null): string {
  if (!location) return '';
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    return '';
  }
}

async function fetchAllowedLawUrl(url: string, method: 'HEAD' | 'GET'): Promise<Response> {
  let currentUrl = url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== 'https:' || isBlockedFetchHost(parsed.hostname)) {
      throw new Error('Blocked citation URL destination.');
    }

    const res = await fetch(currentUrl, { method, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(res.status)) {
      return res;
    }

    const nextUrl = resolveRedirectUrl(currentUrl, res.headers.get('location'));
    if (!nextUrl) throw new Error('Invalid citation URL redirect.');
    currentUrl = nextUrl;
  }

  throw new Error('Too many citation URL redirects.');
}

async function verifyLawUrl(url: string): Promise<{ verified: boolean; note: string }> {
  if (!url) return { verified: false, note: 'No URL returned.' };
  try {
    const parsed = new URL(url);
    if (isBlockedFetchHost(parsed.hostname)) {
      return { verified: false, note: 'The source URL was not checked because the host is not allowed.' };
    }
    const res = await fetchAllowedLawUrl(url, 'HEAD');
    if (res.ok) return { verified: true, note: 'The source URL responded successfully.' };
    if (res.status === 405 || res.status === 403) {
      const getRes = await fetchAllowedLawUrl(url, 'GET');
      return {
        verified: getRes.ok,
        note: getRes.ok ? 'The source URL responded successfully.' : 'The source URL could not be confirmed.',
      };
    }
    return { verified: false, note: 'The source URL could not be confirmed.' };
  } catch {
    return { verified: false, note: 'The source URL could not be reached from the server.' };
  }
}

export async function POST(req: NextRequest) {
  try {
    // Rate limit by IP — applies to all users (logged in or not)
    const ip = getRequestIp(req);
    const rl = consumeAnalyzeRateLimit(ip);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a moment and try again.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const config = await resolveAiConfig(req);
    if (!config) {
      return NextResponse.json(
        { error: 'No API key found. Please add your API key first.' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { action, city, region, duration, situation, law, verdict: bodyVerdict } = body;
    if (!action || typeof action !== 'string') {
      return NextResponse.json({ error: 'Missing action field.' }, { status: 400 });
    }

    // Input type and length validation
    const sitStr = typeof situation === 'string' ? situation.trim() : '';
    const regionStr = typeof region === 'string' ? region.trim() : '';
    const cityStr = typeof city === 'string' ? city.trim() : '';
    if (sitStr.length > 5000) {
      return NextResponse.json({ error: 'Description is too long. Please keep it under 5000 characters.' }, { status: 400 });
    }
    if (regionStr.length > 100 || cityStr.length > 100) {
      return NextResponse.json({ error: 'Location fields are too long.' }, { status: 400 });
    }

    // Server-side safety gate for all actions that use situation text
    if (sitStr) {
      const safety = validateTenantComplaint(sitStr);
      if (!safety.ok) {
        return NextResponse.json({ error: safety.reason }, { status: 400 });
      }
    }

    const { apiKey, provider } = config;

    if (action === 'analyze') {
      const systemPrompt = getMainAnalysisSystemPrompt();
      const userPrompt = buildMainAnalysisUserPrompt(
        city || '',
        region || '',
        duration || '',
        situation || ''
      );
      const raw = await callProvider(provider, systemPrompt, userPrompt, apiKey);

      let verdict = getTag(raw, 'VERDICT')
        .toLowerCase()
        .replace(/\s+/g, '_');
      const explanation = getTag(raw, 'EXPLANATION');
      const parsedLaw = getTag(raw, 'LAW');
      const lawUrl = sanitizeLawUrl(getTag(raw, 'LAW_URL'));
      const citation = parseCitation(getTag(raw, 'CITATION'));
      const deadlines = parseDeadlines(getTag(raw, 'DEADLINES'));
      const timeline = parseTimeline(getTag(raw, 'TIMELINE'));
      const options = getTag(raw, 'OPTIONS');
      const email = getTag(raw, 'EMAIL');
      const orgsText = getTag(raw, 'ORGS');
      const lawyerNote = getTag(raw, 'LAWYER');
      const modelSafety = getTag(raw, 'SAFETY').toLowerCase();
      const modelSafetyReason = getTag(raw, 'SAFETY_REASON');

      if (modelSafety === 'blocked') {
        return NextResponse.json(
          { error: modelSafetyReason || 'This tool only accepts tenant-rights complaints.' },
          { status: 400 }
        );
      }

      if (!['illegal', 'grey_area', 'legal'].includes(verdict)) {
        verdict = 'grey_area';
      }

      let orgs = parseOrgs(orgsText);

      if (orgs.length === 0) {
        try {
          const orgPrompt = buildOrgsFallbackUserPrompt(city || '', region || '');
          const orgRaw = await callProvider(
            provider,
            getOrgsFallbackSystemPrompt(),
            orgPrompt,
            apiKey
          );
          orgs = parseOrgs(orgRaw);
        } catch {
          /* keep empty */
        }
      }

      const urlCheck = await verifyLawUrl(lawUrl);
      const mergedCitation = {
        ...citation,
        verified: citation.verified && urlCheck.verified ? true : urlCheck.verified,
        note: [citation.note, urlCheck.note].filter(Boolean).join(' '),
      };

      return jsonWithRefreshedConfig({
        verdict,
        explanation: explanation || 'Analysis complete. Review the details below.',
        law: parsedLaw,
        lawUrl: lawUrl || undefined,
        citation: mergedCitation,
        deadlines,
        timeline,
        options,
        email,
        orgs,
        lawyerNote,
      }, config);
    }

    if (action === 'demand-letter') {
      const systemPrompt = getNuclearSystemPrompt();
      const userPrompt = buildNuclearUserPrompt(
        city || '',
        region || '',
        duration || '',
        situation || '',
        law || ''
      );
      const letter = await callProvider(provider, systemPrompt, userPrompt, apiKey);
      return jsonWithRefreshedConfig({ letter }, config);
    }

    if (action === 'counter-arguments') {
      const systemPrompt = getCounterArgumentsSystemPrompt();
      const userPrompt = buildCounterArgumentsUserPrompt(
        city || '',
        region || '',
        situation || '',
        law || '',
        bodyVerdict || ''
      );
      const raw = await callProvider(provider, systemPrompt, userPrompt, apiKey);
      const counterArguments = parseCounterArguments(getTag(raw, 'COUNTERARGUMENTS'));
      return jsonWithRefreshedConfig({ counterArguments }, config);
    }

    if (action === 'agency-complaint') {
      const systemPrompt = getAgencyComplaintSystemPrompt();
      const userPrompt = buildAgencyComplaintUserPrompt(
        city || '',
        region || '',
        situation || '',
        law || ''
      );
      const raw = await callProvider(provider, systemPrompt, userPrompt, apiKey);
      const agencyComplaint = parseAgencyComplaint(getTag(raw, 'AGENCY_COMPLAINT'));
      return jsonWithRefreshedConfig({ agencyComplaint }, config);
    }

    if (action === 'court-filing') {
      const systemPrompt = getCourtFilingSystemPrompt();
      const userPrompt = buildCourtFilingUserPrompt(
        city || '',
        region || '',
        situation || '',
        law || ''
      );
      const raw = await callProvider(provider, systemPrompt, userPrompt, apiKey);
      const courtFiling = parseCourtFiling(getTag(raw, 'COURT_FILING'));
      return jsonWithRefreshedConfig({ courtFiling }, config);
    }

    return NextResponse.json({ error: 'Invalid action: ' + action }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred';
    const status = message.includes('Invalid')
      ? 401
      : message.includes('Rate limited')
        ? 429
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
