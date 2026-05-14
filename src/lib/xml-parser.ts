import { AgencyComplaint, CitationCheck, CourtFiling, CounterArgument, DeadlineItem, TenantOrg, TimelineEvent } from './types';

function cleanText(raw: unknown, maxLength = 2000): string {
  return String(raw || '').replace(/\u0000/g, '').slice(0, maxLength);
}

function sanitizeHttpsUrl(raw: unknown): string {
  const value = cleanText(raw, 500).trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

/**
 * Parse XML-style tags from AI response text.
 * Handles extra whitespace, newlines, etc.
 */
export function getTag(text: string, tag: string): string {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

/**
 * Parse the ORGS JSON array from AI response.
 * Returns empty array if parsing fails.
 */
export function parseOrgs(orgsText: string): TenantOrg[] {
  if (!orgsText) return [];

  try {
    // Try to extract JSON array from the text
    const jsonMatch = orgsText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.map((org: Record<string, string>) => ({
          name: cleanText(org.name, 160) || 'Unknown Organization',
          url: sanitizeHttpsUrl(org.url),
          phone: cleanText(org.phone, 80) || undefined,
          note: cleanText(org.note, 500),
          type: normalizeOrgType(org.type),
          rank: Number(org.rank) || undefined,
          matchReason: cleanText(org.matchReason, 500) || undefined,
        }));
      }
    }
  } catch {
    // JSON parse failed
  }

  return [];
}

function parseJsonArray<T>(raw: string, mapper: (row: Record<string, unknown>, index: number) => T): T[] {
  if (!raw) return [];
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row, index) => mapper((row || {}) as Record<string, unknown>, index));
  } catch {
    return [];
  }
}

function normalizePriority(raw: unknown): DeadlineItem['priority'] {
  const v = String(raw || '').toLowerCase();
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  return 'medium';
}

function normalizeOrgType(raw: unknown): TenantOrg['type'] {
  const v = String(raw || '').toLowerCase();
  if (
    v === 'legal_aid' ||
    v === 'housing_agency' ||
    v === 'court_self_help' ||
    v === 'hotline' ||
    v === 'tenant_union' ||
    v === 'other'
  ) {
    return v;
  }
  return undefined;
}

export function parseDeadlines(raw: string): DeadlineItem[] {
  return parseJsonArray(raw, (row) => ({
    title: cleanText(row.title, 160) || 'Deadline',
    dateOrWindow: cleanText(row.dateOrWindow || row.window, 160) || 'Verify locally',
    basis: cleanText(row.basis, 500),
    priority: normalizePriority(row.priority),
  }));
}

export function parseTimeline(raw: string): TimelineEvent[] {
  return parseJsonArray(raw, (row, index) => ({
    label: cleanText(row.label, 160) || 'Event',
    dateOrOrder: cleanText(row.dateOrOrder || row.date, 80) || String(index + 1),
    note: cleanText(row.note, 500),
  }));
}

export function parseCitation(raw: string): CitationCheck {
  const fallback: CitationCheck = {
    sourceType: 'unknown',
    confidence: 'low',
    verified: false,
    note: 'No citation check returned.',
  };
  if (!raw) return fallback;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const sourceType = String(parsed.sourceType || '').toLowerCase();
    const confidence = String(parsed.confidence || '').toLowerCase();
    return {
      sourceType:
        sourceType === 'official' || sourceType === 'legal_aid' || sourceType === 'general_web'
          ? sourceType
          : 'unknown',
      confidence: confidence === 'high' || confidence === 'medium' || confidence === 'low' ? confidence : 'low',
      verified: Boolean(parsed.verified),
      note: cleanText(parsed.note, 500) || fallback.note,
    };
  } catch {
    return fallback;
  }
}

/** Parse counter-arguments from the COUNTERARGUMENTS XML tag */
export function parseCounterArguments(raw: string): CounterArgument[] {
  return parseJsonArray(raw, (row) => ({
    landlordArgument: cleanText(row.landlordArgument, 700),
    whyItFails: cleanText(row.whyItFails, 700),
    evidenceNeeded: cleanText(row.evidenceNeeded, 700),
  }));
}

/** Parse agency complaint from the AGENCY_COMPLAINT XML tag */
export function parseAgencyComplaint(raw: string): AgencyComplaint | null {
  if (!raw) return null;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      agencyName: cleanText(parsed.agencyName, 200),
      agencyUrl: sanitizeHttpsUrl(parsed.agencyUrl),
      filingMethod: cleanText(parsed.filingMethod, 500),
      timeline: cleanText(parsed.timeline, 500),
      complaintText: cleanText(parsed.complaintText, 2000),
    };
  } catch {
    return null;
  }
}

/** Parse court filing guide from the COURT_FILING XML tag */
export function parseCourtFiling(raw: string): CourtFiling | null {
  if (!raw) return null;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      isSmallClaims: Boolean(parsed.isSmallClaims),
      courtName: cleanText(parsed.courtName, 200),
      courtUrl: sanitizeHttpsUrl(parsed.courtUrl),
      filingFee: cleanText(parsed.filingFee, 120),
      claimsLimit: cleanText(parsed.claimsLimit, 120),
      whatToBring: Array.isArray(parsed.whatToBring)
        ? parsed.whatToBring.map((i: unknown) => cleanText(i, 200)).slice(0, 10)
        : [],
      statementOfClaim: cleanText(parsed.statementOfClaim, 2000),
    };
  } catch {
    return null;
  }
}
