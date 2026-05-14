import type { DisputeType, EvidenceItem } from './types';

/** Detect dispute type from the situation text using keyword matching */
export function detectDisputeType(situation: string): DisputeType {
  const s = situation.toLowerCase();
  if (s.includes('deposit') || s.includes('security')) return 'deposit';
  if (s.includes('repair') || s.includes('fix') || s.includes('heat') || s.includes('hot water') || s.includes('leak') || s.includes('mold')) return 'repairs';
  if (s.includes('entry') || s.includes('enter') || s.includes('access') || s.includes('notice')) return 'entry';
  if (s.includes('evict') || s.includes('eviction') || s.includes('vacate') || s.includes('leave')) return 'eviction';
  if (s.includes('rent') && (s.includes('increas') || s.includes('rais') || s.includes('hike'))) return 'rent_increase';
  if (s.includes('retali') || s.includes('complain')) return 'retaliation';
  return 'general';
}

export const EVIDENCE_CHECKLISTS: Record<DisputeType, EvidenceItem[]> = {
  deposit: [
    { item: "Move-in inspection report signed by both parties", critical: true },
    { item: "Move-out inspection report (request one if not done)", critical: true },
    { item: "Photos or video from move-in day showing condition", critical: true },
    { item: "Photos or video from move-out day", critical: true },
    { item: "Bank statement showing deposit payment", critical: true },
    { item: "All written communication with landlord about the deposit", critical: false },
    { item: "Your lease showing deposit amount and return terms", critical: false },
    { item: "Receipts for any professional cleaning you paid for", critical: false },
  ],
  repairs: [
    { item: "Written repair request (email or letter with date)", critical: true },
    { item: "Photos/video of the defect with timestamps", critical: true },
    { item: "Record of how long the issue has existed", critical: true },
    { item: "Any health symptoms caused by the issue (written note)", critical: false },
    { item: "Local housing code section for habitability (we found it above)", critical: false },
    { item: "Neighbor statements if shared issue", critical: false },
    { item: "Repair quotes from contractors if self-repair is your option", critical: false },
  ],
  entry: [
    { item: "Text/email logs — was any notice given? Save them.", critical: true },
    { item: "Note the exact date, time, and who entered", critical: true },
    { item: "Witness statement if someone was with you", critical: false },
    { item: "Any items disturbed, missing, or damaged — photograph them", critical: false },
    { item: "Your lease — check if it specifies notice terms", critical: true },
    { item: "Prior pattern of unannounced entries if this is repeated", critical: false },
  ],
  eviction: [
    { item: "The eviction notice — photograph it, note date received", critical: true },
    { item: "Your lease — check termination and notice clauses", critical: true },
    { item: "Proof of rent payments (bank statements, receipts)", critical: true },
    { item: "All recent landlord communication", critical: true },
    { item: "Local court filing deadline (see deadlines above)", critical: true },
    { item: "Any protected class status if retaliation is suspected", critical: false },
  ],
  rent_increase: [
    { item: "The rent increase notice — check if legally required notice period was given", critical: true },
    { item: "Your current lease showing rent amount and increase terms", critical: true },
    { item: "Local rent control ordinance (check if your city has one)", critical: true },
    { item: "Prior rent payment records", critical: false },
    { item: "Date you moved in — rent control often protects long-term tenants more", critical: false },
  ],
  retaliation: [
    { item: "Your complaint to the landlord or housing authority — with date", critical: true },
    { item: "Timing: the landlord's action must follow your complaint closely", critical: true },
    { item: "All written communication before and after your complaint", critical: true },
    { item: "Record of any other tenants with similar complaints", critical: false },
    { item: "Document any pattern: inspections, noise complaints filed against you, etc.", critical: false },
  ],
  general: [
    { item: "Your signed lease", critical: true },
    { item: "All written communication with your landlord", critical: true },
    { item: "Photos/video documenting the issue with timestamps", critical: true },
    { item: "Your rent payment records for the past 12 months", critical: false },
    { item: "Names and contact info of any witnesses", critical: false },
  ]
};
