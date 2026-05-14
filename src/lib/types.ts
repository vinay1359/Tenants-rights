export type AIProvider = 'gemini' | 'groq' | 'openai' | 'claude';

export type Verdict = 'illegal' | 'grey_area' | 'legal';

export type Screen = 0 | 1 | 2 | 3 | 4;

export type Duration = 'Under 6 months' | '6-12 months' | '1-3 years' | '3+ years' | '';

export interface TenantOrg {
  name: string;
  url: string;
  phone?: string;
  note: string;
  type?: 'legal_aid' | 'housing_agency' | 'court_self_help' | 'hotline' | 'tenant_union' | 'other';
  rank?: number;
  matchReason?: string;
}

export interface DeadlineItem {
  title: string;
  dateOrWindow: string;
  basis: string;
  priority: 'high' | 'medium' | 'low';
}

export interface TimelineEvent {
  label: string;
  dateOrOrder: string;
  note: string;
}

export interface CitationCheck {
  sourceType: 'official' | 'legal_aid' | 'general_web' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  verified: boolean;
  note: string;
}

export interface CounterArgument {
  landlordArgument: string;
  whyItFails: string;
  evidenceNeeded: string;
}

export interface AgencyComplaint {
  agencyName: string;
  agencyUrl: string;
  filingMethod: string;
  timeline: string;
  complaintText: string;
}

export interface CourtFiling {
  isSmallClaims: boolean;
  courtName: string;
  courtUrl: string;
  filingFee: string;
  claimsLimit: string;
  whatToBring: string[];
  statementOfClaim: string;
}

export type DisputeType = 'deposit' | 'repairs' | 'entry' | 'eviction' | 'rent_increase' | 'retaliation' | 'general';

export interface EvidenceItem {
  item: string;
  critical: boolean;
}

export interface SavedChat {
  id: string;
  title: string;
  timestamp: number;
  situation: string;
  city: string;
  region: string;
  duration: Duration;
  verdict: Verdict | '';
  explanation: string;
  law: string;
  options: string;
  email: string;
  orgs: TenantOrg[];
  lawyerNote: string;
  deadlines?: DeadlineItem[];
  timeline?: TimelineEvent[];
  citation?: CitationCheck;
  demandLetter?: string;
  /** Official or primary statute URL when the model returned one */
  lawUrl?: string;
  /** Counter-arguments: what the landlord will argue */
  counterArguments?: CounterArgument[];
  /** Agency complaint (escalation level 3) */
  agencyComplaint?: AgencyComplaint;
  /** Court filing guide (escalation level 4) */
  courtFiling?: CourtFiling;
}

export interface AnalysisResult {
  verdict: Verdict;
  explanation: string;
  law: string;
  options: string;
  email: string;
  orgs: TenantOrg[];
  lawyerNote: string;
  deadlines?: DeadlineItem[];
  timeline?: TimelineEvent[];
  citation?: CitationCheck;
}

export interface DemandLetterResult {
  letter: string;
}

export interface OrgsResult {
  orgs: TenantOrg[];
}
