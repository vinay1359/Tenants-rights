'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { AIProvider, AgencyComplaint, CitationCheck, CourtFiling, CounterArgument, DeadlineItem, Duration, SavedChat, TenantOrg, TimelineEvent, Verdict } from '@/lib/types';
import { PROVIDER_INFO } from '@/lib/ai-providers';
import { generatePDF } from '@/lib/pdf-generator';
import { createSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';
import {
  fetchCloudChats,
  upsertCloudChat,
  deleteCloudChat,
} from '@/lib/chat-storage';
import { JurisdictionField } from '@/components/JurisdictionField';
import { t } from '@/lib/strings';
import { validateTenantComplaint } from '@/lib/safety';
import { detectDisputeType, EVIDENCE_CHECKLISTS } from '@/lib/evidence-checklists';

const SCENARIO_CHIPS = [
  'My landlord entered my home without notice',
  'My landlord will not return my deposit',
  'My rent is being increased during my lease',
  'I have no heat or hot water',
  'My landlord will not fix a leak or broken pipe',
  'My landlord is punishing me for complaining',
  'I am being told to leave without proper notice',
  'I was charged surprise fees',
];

const DURATION_OPTIONS: Duration[] = ['Under 6 months', '6-12 months', '1-3 years', '3+ years'];

const LOADING_MESSAGES = [
  "Finding the tenant laws for your location...",
  "Checking the law links...",
  "Looking for free help near you...",
  "Finding deadlines and next steps...",
  "Preparing your plain-English result..."
];

function copyText(text: string, btn: HTMLButtonElement) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = 'Copied';
    btn.classList.add('btn-copy-flash');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('btn-copy-flash');
    }, 2000);
  });
}

export default function TenantRightsChecker() {
  // Core view state
  const [screen, setScreen] = useState(0); // 0=setup, 1=situation, 2=location, 3=confirm, 4=results
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pdfFeedback, setPdfFeedback] = useState('');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile overlay
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('trc_sidebar_collapsed') === '1'
  ); // desktop collapse

  // Saved chat history state
  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);

  // Modals state
  const [guideOpen, setGuideOpen] = useState(false);
  const [securityGuideOpen, setSecurityGuideOpen] = useState(false);
  const [pluginGuideOpen, setPluginGuideOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient>>(null);

  // Setup and authentication state
  const [provider, setProvider] = useState<AIProvider>('groq');
  const [apiKey, setApiKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [keyHint, setKeyHint] = useState('');

  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [authEmailInput, setAuthEmailInput] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState('');

  // Case inputs
  const [situation, setSituation] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [duration, setDuration] = useState<Duration>('');

  // Analysis results
  const [verdict, setVerdict] = useState<Verdict | ''>('');
  const [explanation, setExplanation] = useState('');
  const [law, setLaw] = useState('');
  const [lawUrl, setLawUrl] = useState('');
  const [citation, setCitation] = useState<CitationCheck | null>(null);
  const [deadlines, setDeadlines] = useState<DeadlineItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [options, setOptions] = useState('');
  const [email, setEmail] = useState('');
  const [orgs, setOrgs] = useState<TenantOrg[]>([]);
  const [lawyerNote, setLawyerNote] = useState('');

  // Demand letter state
  const [demandLetter, setDemandLetter] = useState('');
  const [nuclearLoading, setNuclearLoading] = useState(false);
  const [nuclearGenerated, setNuclearGenerated] = useState(false);

  // Feature 1: Counter-arguments
  const [counterArguments, setCounterArguments] = useState<CounterArgument[]>([]);
  const [counterLoading, setCounterLoading] = useState(false);
  const [counterError, setCounterError] = useState(false);

  // Feature 2: Evidence checklist
  const [evidenceChecked, setEvidenceChecked] = useState<boolean[]>([]);

  // Feature 3: Escalation ladder
  const [agencyComplaint, setAgencyComplaint] = useState<AgencyComplaint | null>(null);
  const [agencyLoading, setAgencyLoading] = useState(false);
  const [courtFiling, setCourtFiling] = useState<CourtFiling | null>(null);
  const [courtLoading, setCourtLoading] = useState(false);

  // UI Fix 1: Loading messages
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);

  // UI Fix 2: Safety banner
  const [showSafetyBanner, setShowSafetyBanner] = useState(false);

  // UI Fix 3: ChatGPT callout
  const [showChatGPTCallout, setShowChatGPTCallout] = useState(() =>
    typeof window === 'undefined' || localStorage.getItem('trc_chatgpt_dismissed') !== '1'
  );

  // Feature 4: URL check banner
  const [showUrlBanner, setShowUrlBanner] = useState(() =>
    typeof window === 'undefined' || sessionStorage.getItem('trc_url_banner_dismissed') !== '1'
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load configuration, auth session, and cloud history.
  useEffect(() => {
    let unsubscribeAuth: (() => void) | undefined;

    queueMicrotask(() => {
      const client = createSupabaseBrowserClient();
      supabaseRef.current = client;

      const clearSessionState = () => {
        setSavedChats([]);
        setSessionEmail(null);
      };

      const syncCloud = async () => {
        if (!client) {
          clearSessionState();
          return;
        }
        const {
          data: { user },
        } = await client.auth.getUser();
        setSessionEmail(user?.email ?? null);

        if (!user) {
          setSavedChats([]);
          return;
        }

        try {
          const remote = await fetchCloudChats(client);
          setSavedChats(remote);
        } catch {
          setSavedChats([]);
        }
      };

      if (!isSupabaseConfigured() || !client) {
        clearSessionState();
      } else {
        void syncCloud();
        const { data } = client.auth.onAuthStateChange((_event, session) => {
          setSessionEmail(session?.user?.email ?? null);
          if (session) {
            void syncCloud();
          } else {
            setSavedChats([]);
            setActiveChatId(null);
            setScreen(0);
          }
        });
        unsubscribeAuth = () => data.subscription.unsubscribe();
      }

      fetch('/api/config')
        .then((r) => r.json())
        .then((data) => {
          if (data.configured) {
            setConfigured(true);
            setProvider(data.provider || 'groq');
            setKeyHint(data.keyHint || '');
            setScreen(1);
          } else {
            setConfigured(false);
            setKeyHint('');
          }
          setConfigLoaded(true);
        })
        .catch(() => setConfigLoaded(true));
    });

    return () => {
      unsubscribeAuth?.();
    };
  }, []);

  // Loading message cycling
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setLoadingMsgIdx(prev => (prev + 1) % LOADING_MESSAGES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [loading]);

  // Toggle sidebar collapse (desktop) or close overlay (mobile)
  const toggleSidebar = useCallback(() => {
    if (window.innerWidth <= 768) {
      // Mobile: close the overlay
      setSidebarOpen(false);
    } else {
      // Desktop: collapse the sidebar
      setSidebarCollapsed(prev => {
        const next = !prev;
        localStorage.setItem('trc_sidebar_collapsed', next ? '1' : '0');
        return next;
      });
    }
  }, []);

  const handleMagicLink = useCallback(async () => {
    const sb = supabaseRef.current;
    if (!sb || !authEmailInput.trim()) return;
    setAuthBusy(true);
    setAuthMessage('');
    const { error } = await sb.auth.signInWithOtp({
      email: authEmailInput.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setAuthBusy(false);
    if (error) setAuthMessage(error.message);
    else setAuthMessage(t('auth.checkEmail'));
  }, [authEmailInput]);

  const handleSignOut = useCallback(async () => {
    const sb = supabaseRef.current;
    setAuthBusy(true);
    await sb?.auth.signOut();
    setAuthBusy(false);
    setAuthMessage('');
  }, []);

  // Save Secure HTTP-only Cookie Configuration
  const handleSaveConfig = useCallback(async (customKey?: string, customProv?: AIProvider) => {
    const k = customKey ?? apiKey;
    const p = customProv ?? provider;
    if (!k.trim()) return;

    setError('');
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: k.trim(), provider: p }),
      });

      if (res.ok) {
        setConfigured(true);
        setProvider(p);
        setKeyHint('****' + k.trim().slice(-4));
        setApiKey('');
        setSettingsOpen(false);
        if (screen === 0) setScreen(1);
      } else {
        const d = await res.json();
        setError(d.error || 'Failed to save configuration.');
      }
    } catch {
      setError('Network error saving configuration.');
    }
  }, [apiKey, provider, screen]);

  // Clear HTTP-only Cookie
  const handleClearConfig = useCallback(async () => {
    await fetch('/api/config', { method: 'DELETE' });
    try {
      const r = await fetch('/api/config');
      const d = await r.json();
      setConfigured(!!d.configured);
      setProvider(d.provider || 'groq');
      setKeyHint(d.keyHint || '');
      setScreen(d.configured ? 1 : 0);
    } catch {
      setConfigured(false);
      setKeyHint('');
      setScreen(0);
    }
    setApiKey('');
    setSettingsOpen(false);
  }, []);

  // Reset to create a new case analysis
  const handleNewCase = useCallback(() => {
    setActiveChatId(null);
    setSituation('');
    setCity('');
    setRegion('');
    setDuration('');
    setVerdict('');
    setExplanation('');
    setLaw('');
    setLawUrl('');
    setCitation(null);
    setDeadlines([]);
    setTimeline([]);
    setOptions('');
    setEmail('');
    setOrgs([]);
    setLawyerNote('');
    setDemandLetter('');
    setNuclearGenerated(false);
    setCounterArguments([]);
    setCounterLoading(false);
    setCounterError(false);
    setEvidenceChecked([]);
    setAgencyComplaint(null);
    setAgencyLoading(false);
    setCourtFiling(null);
    setCourtLoading(false);
    setShowSafetyBanner(false);
    setError('');
    setPdfFeedback('');
    setScreen(configured ? 1 : 0);
    setSidebarOpen(false);
  }, [configured]);

  // Save/Update current session into savedChats list
  const persistChatSession = useCallback((
    currentSituation: string,
    currentCity: string,
    currentRegion: string,
    currentDuration: Duration,
    resVerdict: Verdict | '',
    resExplanation: string,
    resLaw: string,
    resOptions: string,
    resEmail: string,
    resOrgs: TenantOrg[],
    resLawyerNote: string,
    resDeadlines?: DeadlineItem[],
    resTimeline?: TimelineEvent[],
    resCitation?: CitationCheck | null,
    resDemandLetter?: string,
    resLawUrl?: string
  ) => {
    setSavedChats((prev) => {
      let updated: SavedChat[];
      const targetId = activeChatId;
      let persisted: SavedChat;

      if (targetId) {
        updated = prev.map((c) =>
          c.id === targetId
            ? {
                ...c,
                situation: currentSituation,
                city: currentCity,
                region: currentRegion,
                duration: currentDuration,
                verdict: resVerdict,
                explanation: resExplanation,
                law: resLaw,
                lawUrl: resLawUrl !== undefined ? resLawUrl : c.lawUrl,
                options: resOptions,
                email: resEmail,
                orgs: resOrgs,
                lawyerNote: resLawyerNote,
                deadlines: resDeadlines || c.deadlines,
                timeline: resTimeline || c.timeline,
                citation: resCitation !== undefined ? resCitation || undefined : c.citation,
                demandLetter: resDemandLetter || c.demandLetter,
              }
            : c
        );
        const found = updated.find((c) => c.id === targetId);
        if (!found) return prev;
        persisted = found;
      } else {
        const newChat: SavedChat = {
          id: 'chat_' + Date.now(),
          title: currentSituation.slice(0, 42) + (currentSituation.length > 42 ? '...' : ''),
          timestamp: Date.now(),
          situation: currentSituation,
          city: currentCity,
          region: currentRegion,
          duration: currentDuration,
          verdict: resVerdict,
          explanation: resExplanation,
          law: resLaw,
          lawUrl: resLawUrl,
          options: resOptions,
          email: resEmail,
          orgs: resOrgs,
          lawyerNote: resLawyerNote,
          deadlines: resDeadlines || [],
          timeline: resTimeline || [],
          citation: resCitation || undefined,
          demandLetter: resDemandLetter,
        };
        setActiveChatId(newChat.id);
        persisted = newChat;
        updated = [newChat, ...prev];
      }

      persisted = {
        ...persisted,
        situation: currentSituation,
        city: currentCity,
        region: currentRegion,
        duration: currentDuration,
        verdict: resVerdict,
        explanation: resExplanation,
        law: resLaw,
        lawUrl: resLawUrl !== undefined ? resLawUrl : persisted.lawUrl,
        options: resOptions,
        email: resEmail,
        orgs: resOrgs,
        lawyerNote: resLawyerNote,
        deadlines: resDeadlines ?? persisted.deadlines,
        timeline: resTimeline ?? persisted.timeline,
        citation: resCitation !== undefined ? resCitation || undefined : persisted.citation,
        demandLetter: resDemandLetter ?? persisted.demandLetter,
      };

      const sb = supabaseRef.current;
      if (sb && sessionEmail) {
        void upsertCloudChat(sb, persisted);
      }

      return updated;
    });
  }, [activeChatId, sessionEmail]);

  // Load a previously saved chat session context
  const handleLoadSavedChat = useCallback((chat: SavedChat) => {
    setActiveChatId(chat.id);
    setSituation(chat.situation || '');
    setCity(chat.city || '');
    setRegion(chat.region || '');
    setDuration((chat.duration || '') as Duration);
    setVerdict(chat.verdict || '');
    setExplanation(chat.explanation || '');
    setLaw(chat.law || '');
    setLawUrl(chat.lawUrl || '');
    setCitation(chat.citation || null);
    setDeadlines(chat.deadlines || []);
    setTimeline(chat.timeline || []);
    setOptions(chat.options || '');
    setEmail(chat.email || '');
    setOrgs(Array.isArray(chat.orgs) ? chat.orgs : []);
    setLawyerNote(chat.lawyerNote || '');
    setDemandLetter(chat.demandLetter || '');
    setNuclearGenerated(!!chat.demandLetter);
    setCounterArguments(chat.counterArguments || []);
    setCounterError(false);
    setCounterLoading(false);
    setAgencyComplaint(chat.agencyComplaint || null);
    setAgencyLoading(false);
    setCourtFiling(chat.courtFiling || null);
    setCourtLoading(false);
    // Reset evidence checklist based on loaded situation
    const disputeType = detectDisputeType(chat.situation || '');
    setEvidenceChecked(new Array(EVIDENCE_CHECKLISTS[disputeType].length).fill(false));
    setShowSafetyBanner(false);
    setError('');
    setPdfFeedback('');
    setScreen(chat.verdict ? 4 : 1);
    setSidebarOpen(false);
  }, []);

  // Delete an individual saved chat history item
  const handleDeleteChat = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSavedChats((prev) => {
      const remaining = prev.filter((c) => c.id !== id);
      const sb = supabaseRef.current;
      if (sb && sessionEmail) {
        void deleteCloudChat(sb, id);
      }
      return remaining;
    });
    if (activeChatId === id) {
      handleNewCase();
    }
  }, [activeChatId, handleNewCase, sessionEmail]);

  // Stringent Validation & Safe State transitions
  const validateAndGoToLocation = useCallback(() => {
    const trimmed = situation.trim();
    if (!trimmed) {
      setError(t('val.situation'));
      return;
    }
    if (trimmed.length < 8) {
      setError(t('val.detail'));
      return;
    }
    const safety = validateTenantComplaint(trimmed);
    if (!safety.ok) {
      setError(safety.reason);
      return;
    }
    setError('');
    setSituation(trimmed); // sanitize state
    setScreen(2);
  }, [situation]);

  // Execute Main AI Analysis
  const handleAnalyze = useCallback(async () => {
    const trimmedRegion = region.trim();
    if (!trimmedRegion) {
      setError(t('val.region'));
      return;
    }

    setLoadingMsgIdx(0);
    setLoading(true);
    setError('');
    setPdfFeedback('');
    setCounterArguments([]);
    setCounterError(false);
    setAgencyComplaint(null);
    setCourtFiling(null);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'analyze',
          city: city.trim(),
          region: trimmedRegion,
          duration,
          situation: situation.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Something went wrong during analysis.');
      }

      const resVerdict = (data.verdict || 'grey_area') as Verdict;
      const resExplanation = data.explanation || 'Review standard jurisdictional statutes.';
      const resLaw = data.law || 'Refer to local state civil codes.';
      const resOptions = data.options || '1. Submit formal written notice.\n2. Request code compliance review.';
      const resEmail = data.email || '';
      const resOrgs = Array.isArray(data.orgs) ? data.orgs : [];
      const resLawyerNote = data.lawyerNote || '';
      const resLawUrl = typeof data.lawUrl === 'string' ? data.lawUrl : '';
      const resDeadlines = Array.isArray(data.deadlines) ? data.deadlines : [];
      const resTimeline = Array.isArray(data.timeline) ? data.timeline : [];
      const resCitation = data.citation || null;

      setVerdict(resVerdict);
      setExplanation(resExplanation);
      setLaw(resLaw);
      setLawUrl(resLawUrl);
      setCitation(resCitation);
      setDeadlines(resDeadlines);
      setTimeline(resTimeline);
      setOptions(resOptions);
      setEmail(resEmail);
      setOrgs(resOrgs);
      setLawyerNote(resLawyerNote);

      // Initialize evidence checklist
      const disputeType = detectDisputeType(situation.trim());
      setEvidenceChecked(new Array(EVIDENCE_CHECKLISTS[disputeType].length).fill(false));

      // Show safety banner
      setShowSafetyBanner(true);
      setTimeout(() => setShowSafetyBanner(false), 3000);

      // Persist to user session history array
      persistChatSession(
        situation.trim(),
        city.trim(),
        trimmedRegion,
        duration,
        resVerdict,
        resExplanation,
        resLaw,
        resOptions,
        resEmail,
        resOrgs,
        resLawyerNote,
        resDeadlines,
        resTimeline,
        resCitation,
        undefined,
        resLawUrl
      );

      setScreen(4);
      window.scrollTo(0, 0);

      // Fire counter-arguments async (after main results show)
      setCounterLoading(true);
      fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'counter-arguments',
          city: city.trim(),
          region: trimmedRegion,
          situation: situation.trim(),
          law: resLaw,
          verdict: resVerdict,
        }),
      })
        .then(r => r.json())
        .then(d => {
          const args = Array.isArray(d.counterArguments) ? d.counterArguments : [];
          setCounterArguments(args);
          setCounterLoading(false);
          // Persist counter-arguments to cloud
          setSavedChats(prev => {
            const updated = prev.map(c => {
              if (c.id === activeChatId || (!activeChatId && prev[0]?.id === c.id)) {
                const patched = { ...c, counterArguments: args };
                const sb = supabaseRef.current;
                if (sb && sessionEmail) void upsertCloudChat(sb, patched);
                return patched;
              }
              return c;
            });
            return updated;
          });
        })
        .catch(() => { setCounterError(true); setCounterLoading(false); });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [city, region, duration, situation, persistChatSession, activeChatId, sessionEmail]);

  // Generate Demand Letter Block
  const handleNuclear = useCallback(async () => {
    setNuclearLoading(true);
    setError('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'demand-letter',
          city: city.trim(),
          region: region.trim(),
          duration,
          situation: situation.trim(),
          law,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to craft demand letter.');
      
      const draftLetter = data.letter || '';
      setDemandLetter(draftLetter);
      setNuclearGenerated(true);

      // Update persisted storage block
      persistChatSession(
        situation.trim(),
        city.trim(),
        region.trim(),
        duration,
        verdict as Verdict,
        explanation,
        law,
        options,
        email,
        orgs,
        lawyerNote,
        deadlines,
        timeline,
        citation,
        draftLetter,
        undefined
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setNuclearLoading(false);
    }
  }, [city, region, duration, situation, law, verdict, explanation, options, email, orgs, lawyerNote, deadlines, timeline, citation, persistChatSession]);

  // Escalation Level 3: Agency complaint
  const handleAgencyComplaint = useCallback(async () => {
    setAgencyLoading(true);
    setError('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'agency-complaint', city: city.trim(), region: region.trim(), situation: situation.trim(), law }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate agency complaint.');
      const complaint = data.agencyComplaint || null;
      setAgencyComplaint(complaint);
      // Persist
      setSavedChats(prev => prev.map(c => {
        if (c.id === activeChatId) {
          const patched = { ...c, agencyComplaint: complaint };
          const sb = supabaseRef.current;
          if (sb && sessionEmail) void upsertCloudChat(sb, patched);
          return patched;
        }
        return c;
      }));
    } catch (err) { setError((err as Error).message); }
    finally { setAgencyLoading(false); }
  }, [city, region, situation, law, activeChatId, sessionEmail]);

  // Escalation Level 4: Court filing
  const handleCourtFiling = useCallback(async () => {
    setCourtLoading(true);
    setError('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'court-filing', city: city.trim(), region: region.trim(), situation: situation.trim(), law }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate court filing guide.');
      const filing = data.courtFiling || null;
      setCourtFiling(filing);
      // Persist
      setSavedChats(prev => prev.map(c => {
        if (c.id === activeChatId) {
          const patched = { ...c, courtFiling: filing };
          const sb = supabaseRef.current;
          if (sb && sessionEmail) void upsertCloudChat(sb, patched);
          return patched;
        }
        return c;
      }));
    } catch (err) { setError((err as Error).message); }
    finally { setCourtLoading(false); }
  }, [city, region, situation, law, activeChatId, sessionEmail]);

  // Counter-arguments retry
  const handleRetryCounter = useCallback(() => {
    setCounterError(false);
    setCounterLoading(true);
    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'counter-arguments', city: city.trim(), region: region.trim(), situation: situation.trim(), law, verdict }),
    })
      .then(r => r.json())
      .then(d => { setCounterArguments(Array.isArray(d.counterArguments) ? d.counterArguments : []); setCounterLoading(false); })
      .catch(() => { setCounterError(true); setCounterLoading(false); });
  }, [city, region, situation, law, verdict]);

  // Trigger Dedicated Custom jsPDF generation
  const handlePDF = useCallback(() => {
    setPdfFeedback('');
    const locationStr = city ? `${city}, ${region}` : region;
    const labels: Record<string, string> = {
      illegal: 'Likely illegal',
      grey_area: 'Legal grey area',
      legal: 'Likely allowed',
    };

    const disputeType = detectDisputeType(situation);
    const evidenceItems = EVIDENCE_CHECKLISTS[disputeType];

    const success = generatePDF({
      location: locationStr,
      verdict: verdict as Verdict,
      verdictLabel: labels[verdict] || verdict,
      explanation,
      law,
      lawUrl: lawUrl || undefined,
      options,
      email,
      demandLetter: nuclearGenerated ? demandLetter : undefined,
      orgs,
      deadlines,
      timeline,
      citation: citation || undefined,
      counterArguments: counterArguments.length > 0 ? counterArguments : undefined,
      evidenceChecklist: evidenceItems.length > 0 ? { items: evidenceItems, checked: evidenceChecked } : undefined,
      agencyComplaint: agencyComplaint || undefined,
      courtFiling: courtFiling || undefined,
    });

    if (success) {
      setPdfFeedback(t('pdf.downloaded'));
    } else {
      setPdfFeedback(t('pdf.error'));
    }
  }, [verdict, explanation, law, lawUrl, options, email, demandLetter, nuclearGenerated, orgs, deadlines, timeline, citation, city, region, situation, counterArguments, evidenceChecked, agencyComplaint, courtFiling]);

  if (!configLoaded) {
    return (
      <div className="app-layout" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="loader-panel">
          <div className="spinner-ring" />
          <div className="loader-title">{t('loading.title')}</div>
          <p className="loader-desc">{t('loading.sub')}</p>
        </div>
      </div>
    );
  }

  // Modal rendering
  const renderGuideModal = guideOpen && (
    <div className="modal-overlay" onClick={() => setGuideOpen(false)}>
      <div className="modal-card learn-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{t('modal.guideTitle')}</span>
          <button type="button" className="btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setGuideOpen(false)}>{t('modal.close')}</button>
        </div>
        <div className="learn-hero">
          <div className="learn-hero-title">Simple renter basics.</div>
          <p className="learn-hero-copy">
            Laws are different everywhere, but these ideas help most renters know what to check first.
          </p>
        </div>
        <div className="modal-body">
          <div className="learn-grid">
            <div className="learn-card">
              <div className="guide-subtitle">Entry usually needs notice</div>
              <p>Your landlord usually must tell you before entering your home. A real emergency can be different.</p>
            </div>
            <div className="learn-card">
              <div className="guide-subtitle">Your home must be livable</div>
              <p>Heat, water, working locks, and safe conditions matter. If something serious is broken, your landlord usually has to fix it.</p>
            </div>
            <div className="learn-card">
              <div className="guide-subtitle">Complaining should not get you punished</div>
              <p>If you report a housing problem, your landlord usually cannot raise rent, threaten eviction, or harass you because of that complaint.</p>
            </div>
            <div className="learn-card">
              <div className="guide-subtitle">You have rights to your deposit</div>
              <p>When you move out, your landlord usually has a deadline to return your deposit. They can normally keep money only for real damage or unpaid rent.</p>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-primary" style={{ padding: '8px 16px', fontSize: 14 }} onClick={() => setGuideOpen(false)}>{t('modal.done')}</button>
        </div>
      </div>
    </div>
  );

  const renderSecurityModal = securityGuideOpen && (
    <div className="modal-overlay" onClick={() => setSecurityGuideOpen(false)}>
      <div className="modal-card learn-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{t('modal.securityTitle')}</span>
          <button type="button" className="btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setSecurityGuideOpen(false)}>{t('modal.close')}</button>
        </div>
        <div className="learn-hero">
          <div className="learn-hero-title">Your key and results stay under your control.</div>
          <p className="learn-hero-copy">
            You can use the checker without logging in. Login is only for saving results.
          </p>
        </div>
        <div className="modal-body">
          <div className="guide-section">
            <div className="guide-subtitle">Your AI key</div>
            <p>Your API key is encrypted in a secure browser cookie that page JavaScript cannot read. It expires after 30 minutes and is never saved in the database.</p>
          </div>
          <div className="guide-section">
            <div className="guide-subtitle">Your saved results</div>
            <p>If you sign in (optional), your results are saved to your account so you can come back later. If you do not sign in, nothing is saved — your session disappears when you close the tab.</p>
          </div>
          <div className="guide-section">
            <div className="guide-subtitle">On shared computers</div>
            <p>If you are using a shared or public computer, remove your key from Settings when you are done. Or use a private/incognito window.</p>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-primary" style={{ padding: '8px 16px', fontSize: 14 }} onClick={() => setSecurityGuideOpen(false)}>{t('modal.securityOk')}</button>
        </div>
      </div>
    </div>
  );

  const renderPluginModal = pluginGuideOpen && (
    <div className="modal-overlay" onClick={() => setPluginGuideOpen(false)}>
      <div className="modal-card learn-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{t('modal.whyTitle')}</span>
          <button type="button" className="btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setPluginGuideOpen(false)}>{t('modal.close')}</button>
        </div>
        <div className="learn-hero">
          <div className="learn-hero-title">This is a guided tenant-rights checker.</div>
          <p className="learn-hero-copy">
            It asks the right questions, checks your location, and turns the answer into actions you can use.
          </p>
        </div>
        <div className="modal-body">
          <div className="guide-section">
            <div className="guide-subtitle">Built for one job</div>
            <p>This tool helps renters understand a housing problem. It asks for your location, finds the law, writes an email, and gives next steps.</p>
          </div>
          <div className="guide-section">
            <div className="guide-subtitle">Use it alongside ChatGPT or Claude</div>
            <p>You can keep using your favorite AI for research. Use this tool when you need a structured result — email draft, demand letter, PDF, and local resources — in one place.</p>
          </div>
          <div className="guide-section">
            <div className="guide-subtitle">Not legal advice</div>
            <p>This tool gives you helpful information, but it is not a lawyer. Laws are different in every city and state. Always double-check the law and talk to a real lawyer if your situation is serious.</p>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-primary" style={{ padding: '8px 16px', fontSize: 14 }} onClick={() => setPluginGuideOpen(false)}>{t('modal.close')}</button>
        </div>
      </div>
    </div>
  );

  const renderSettingsModal = settingsOpen && (
    <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{t('modal.settingsTitle')}</span>
          <button type="button" className="btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setSettingsOpen(false)}>{t('modal.close')}</button>
        </div>
        <div className="modal-body">
          {configured && (
            <div className="settings-banner">
              {t('modal.connected', { provider: PROVIDER_INFO[provider]?.name ?? '', hint: keyHint })}
            </div>
          )}

          <label className="form-label">{t('modal.provider')}</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', marginBottom: '20px' }}>
            {(Object.keys(PROVIDER_INFO) as AIProvider[]).map((k) => {
              const info = PROVIDER_INFO[k];
              return (
                <button
                  type="button"
                  key={k}
                  className={`provider-card ${provider === k ? 'selected' : ''}`}
                  style={{ padding: '12px 16px', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}
                  onClick={() => setProvider(k)}
                  suppressHydrationWarning
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>
                      {info.name}
                      {info.free && <span className="badge-tag badge-free" style={{ marginLeft: 8 }}>Free tier</span>}
                      {info.recommended && <span className="badge-tag badge-best">Search</span>}
                    </div>
                    <div className="muted-hint" style={{ marginTop: 2 }}>{info.description}</div>
                  </div>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid var(--text-main)', background: provider === k ? 'var(--text-main)' : 'transparent', flexShrink: 0 }} aria-hidden />
                </button>
              );
            })}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handleSaveConfig(); }}>
            <label className="form-label">{t('modal.keyLabel')}</label>
            <a href={PROVIDER_INFO[provider]?.keyUrl} target="_blank" rel="noopener noreferrer" className="muted-hint" style={{ fontWeight: 500, color: 'var(--accent)', display: 'inline-block', marginBottom: '8px' }}>
              {PROVIDER_INFO[provider]?.keyLabel}
            </a>
            <input
              type="password"
              className="input-text"
              placeholder={`Paste ${PROVIDER_INFO[provider]?.name} API key`}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              suppressHydrationWarning
            />
            <p className="muted-hint" style={{ marginBottom: '16px' }}>
              {t('modal.keyHelp')}
            </p>

            <button type="submit" className="btn-primary" style={{ width: '100%', marginBottom: '12px' }} disabled={!apiKey.trim()}>
              {t('modal.saveKey')}
            </button>
          </form>

          {configured && (
            <button
              type="button"
              className="btn-secondary"
              style={{ width: '100%', borderColor: 'var(--red-border)', color: 'var(--red-text)' }}
              onClick={handleClearConfig}
            >
              {t('modal.removeKey')}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const supabaseReady = isSupabaseConfigured();
  const canUseApp = configured;
  const effectiveScreen = canUseApp ? screen : 0;

  // Sidebar and main layout
  return (
    <div className="app-layout" suppressHydrationWarning>
      {renderGuideModal}
      {renderSecurityModal}
      {renderPluginModal}
      {renderSettingsModal}

      {/* Mobile sidebar overlay backdrop */}
      <div className={`sidebar-backdrop ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)} />

      {/* SIDEBAR */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`} suppressHydrationWarning>
        <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button type="button" className="brand" onClick={handleNewCase}>
            <div className="brand-mark">TR</div>
            <div>
              <div className="brand-title">{t('nav.brandTitle')}</div>
              <div className="brand-subtitle">{t('nav.brandSub')}</div>
            </div>
          </button>
          <button type="button" className="btn-collapse-sidebar" onClick={toggleSidebar} aria-label="Collapse sidebar" title="Collapse sidebar">
            ‹
          </button>
        </div>

        <button type="button" className="btn-new-case" onClick={handleNewCase} suppressHydrationWarning>
          {t('nav.new')}
        </button>

        <div className="sidebar-scrollContent">
          <div className="nav-section" style={{ marginBottom: 16 }}>
            <div className="section-label">{t('auth.title')}</div>
            {sessionEmail ? (
              <div style={{ padding: '0 10px' }}>
                <p className="muted-hint" style={{ marginBottom: 8, fontSize: 12 }}>
                  {t('auth.signedIn')}: {sessionEmail}
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ width: '100%', fontSize: 13 }}
                  onClick={handleSignOut}
                  disabled={authBusy}
                >
                  {t('auth.signOut')}
                </button>
              </div>
            ) : (
              <div style={{ padding: '0 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p className="muted-hint" style={{ fontSize: 12 }}>
                  {supabaseReady ? t('auth.syncHint') : 'Add Supabase env vars to enable sign-in.'}
                </p>
                <input
                  type="email"
                  className="input-text"
                  style={{ marginBottom: 0 }}
                  placeholder={t('auth.email')}
                  value={authEmailInput}
                  onChange={(e) => setAuthEmailInput(e.target.value)}
                  autoComplete="email"
                  disabled={!supabaseReady}
                />
                <button
                  type="button"
                  className="btn-primary"
                  style={{ width: '100%', fontSize: 13 }}
                  disabled={!supabaseReady || authBusy || !authEmailInput.trim()}
                  onClick={handleMagicLink}
                >
                  {t('auth.magic')}
                </button>
                {authMessage ? <p className="muted-hint" style={{ fontSize: 12 }}>{authMessage}</p> : null}
              </div>
            )}
          </div>

          <div className="nav-section">
            <div className="section-label">
              <span>{t('nav.history')}</span>
              <span className={`cloud-pill ${sessionEmail ? 'on' : ''}`}>
                {sessionEmail ? t('cloud.cloud') : 'Sign in'}
              </span>
            </div>
            {savedChats.length > 0 ? (
              savedChats.map((sc) => (
                <div
                  key={sc.id}
                  className={`chat-history-item ${activeChatId === sc.id ? 'active' : ''}`}
                  onClick={() => handleLoadSavedChat(sc)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleLoadSavedChat(sc);
                    }
                  }}
                  title={sc.situation}
                  role="button"
                  tabIndex={0}
                >
                  <span className="chat-title-text">{sc.title}</span>
                  <button
                    type="button"
                    className="btn-del-chat"
                    onClick={(e) => handleDeleteChat(sc.id, e)}
                    aria-label="Delete"
                    title="Delete"
                  >
                    x
                  </button>
                </div>
              ))
            ) : (
              <p className="muted-hint" style={{ padding: '8px 12px' }}>
                {t('nav.noSaved')}
              </p>
            )}
          </div>

          <div className="nav-section">
            <div className="section-label">{t('nav.learn')}</div>
            <button type="button" className="nav-item" onClick={() => { setGuideOpen(true); setSidebarOpen(false); }}>
              {t('nav.guide')}
            </button>
            <button type="button" className="nav-item" onClick={() => { setSecurityGuideOpen(true); setSidebarOpen(false); }}>
              {t('nav.privacy')}
            </button>
            <button type="button" className="nav-item" onClick={() => { setPluginGuideOpen(true); setSidebarOpen(false); }}>
              {t('nav.why')}
            </button>
          </div>
        </div>

        <div className="sidebar-footer">
          <button type="button" className="provider-pill" onClick={() => setSettingsOpen(true)}>
            <div className="provider-pill-left">
              <span className={`provider-dot ${configured ? '' : 'offline'}`} />
              <div>
                <div className="provider-pill-title">
                  {!configured ? t('nav.addKey') : PROVIDER_INFO[provider]?.name}
                </div>
                <div className="provider-pill-subtitle">
                  {configured ? `Active token ${keyHint}` : t('nav.keyRequired')}
                </div>
              </div>
            </div>
            <span className="muted-hint" style={{ fontSize: 12 }}>{t('nav.settings')}</span>
          </button>
        </div>
      </aside>

      {/* MAIN WORKSPACE */}
      <div className="main-wrapper" suppressHydrationWarning>
        {/* TOP BAR */}
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="btn-sidebar-toggle" onClick={() => {
              // On mobile: toggle overlay. On desktop: expand sidebar.
              if (window.innerWidth <= 768) {
                setSidebarOpen(prev => !prev);
              } else {
                setSidebarCollapsed(false);
                localStorage.setItem('trc_sidebar_collapsed', '0');
              }
            }} aria-label="Toggle sidebar" title={sidebarCollapsed ? 'Show sidebar' : 'Menu'}>
              <span className="sidebar-toggle-icon" aria-hidden>{sidebarCollapsed ? '›' : '☰'}</span>
            </button>
            <span className="view-title">
              {effectiveScreen === 0 && t('top.connect')}
              {effectiveScreen === 1 && t('top.describe')}
              {effectiveScreen === 2 && t('top.jurisdiction')}
              {effectiveScreen === 3 && t('top.review')}
              {effectiveScreen === 4 && t('top.results')}
            </span>
          </div>
        </header>

        {/* MAIN SCROLLABLE AREA */}
        <main className="workspace-scrollArea">
          <div className="workspace-container">
            {error && (
              <div className="error-notice">
                <div><strong>{t('err.prefix')}</strong> {error}</div>
              </div>
            )}

            {/* Screen 0: startup setup */}
            {effectiveScreen === 0 && (
              <div className="hero-box">
                <p className="hero-kicker">{t('s0.kicker')}</p>
                <h1 className="hero-title">{t('s0.title')}</h1>
                <p className="hero-subtitle">{t('s0.sub')}</p>

                <div className="home-steps" aria-label="How Tenant Rights Checker works">
                  <div className="home-step">
                    <span>1</span>
                    <strong>Tell us what happened</strong>
                    <p>Use normal words. You do not need legal terms.</p>
                  </div>
                  <div className="home-step">
                    <span>2</span>
                    <strong>Add your location</strong>
                    <p>Tenant rules change by state, province, city, and country.</p>
                  </div>
                  <div className="home-step">
                    <span>3</span>
                    <strong>Get a plan</strong>
                    <p>See the law, a simple answer, an email, evidence to collect, and next steps.</p>
                  </div>
                </div>

                <div className="privacy-strip">
                  <span>No account needed</span>
                  <strong>Paste your AI key only when you want to run a check. It is encrypted in a private browser cookie, cannot be read by page JavaScript, and expires after 30 minutes. Sign in only if you want to save results and come back later.</strong>
                </div>

                <div className="provider-card-grid">
                  {(Object.keys(PROVIDER_INFO) as AIProvider[]).map((k) => {
                    const pi = PROVIDER_INFO[k];
                    return (
                      <button
                        type="button"
                        key={k}
                        className={`provider-card ${provider === k ? 'selected' : ''}`}
                        onClick={() => setProvider(k)}
                        suppressHydrationWarning
                      >
                        <div>
                          <div className="provider-card-top">
                            <span className="provider-card-title">
                              {pi.name}
                              {pi.recommended && <span className="badge-tag badge-best">Search</span>}
                            </span>
                            {pi.free ? <span className="badge-tag badge-free">Free</span> : <span className="badge-tag badge-pro">Paid</span>}
                          </div>
                          <p className="provider-card-desc">{pi.description}</p>
                        </div>
                        <span className="muted-hint" style={{ fontWeight: 600, color: 'var(--text-main)' }}>{t('s0.select')}</span>
                      </button>
                    );
                  })}
                </div>

                <form className="key-input-box" onSubmit={(e) => { e.preventDefault(); handleSaveConfig(); }}>
                  <label className="form-label" style={{ marginBottom: 4 }}>{t('s0.apiKey')}</label>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                    <span className="muted-hint">{t('s0.keyHint')}</span>
                    <a href={PROVIDER_INFO[provider]?.keyUrl} target="_blank" rel="noopener noreferrer" className="muted-hint" style={{ fontWeight: 500, color: 'var(--accent)' }}>
                      {PROVIDER_INFO[provider]?.keyLabel}
                    </a>
                  </div>
                  <input
                    type="password"
                    className="input-text"
                    style={{ marginBottom: 16 }}
                    placeholder={`${PROVIDER_INFO[provider]?.name} API key`}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    suppressHydrationWarning
                  />
                  <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={!apiKey.trim()}>
                    {t('s0.saveContinue')}
                  </button>
                  <p className="muted-hint" style={{ marginTop: 14, textAlign: 'center' }}>
                    Login is optional. Use the app without login, or sign in from the sidebar to save and reload your results later.
                  </p>
                </form>
              </div>
            )}

            {/* Screen 1: incident */}
            {effectiveScreen === 1 && (
              <div className="panel-card">
                <h2 className="panel-title">{t('s1.title')}</h2>
                <p className="panel-desc">{t('s1.sub')}</p>

                <textarea
                  ref={textareaRef}
                  className="chat-textarea"
                  placeholder="e.g. My landlord sent a text message claiming they are keeping my $1500 deposit for routine carpet cleaning..."
                  value={situation}
                  onChange={(e) => setSituation(e.target.value)}
                />

                <label className="form-label" style={{ marginBottom: 12 }}>
                  {t('s1.quick')}
                </label>
                <div className="chip-list">
                  {SCENARIO_CHIPS.map((chip, idx) => (
                    <button key={idx} type="button" className="scenario-chip" onClick={() => setSituation(chip)}>
                      {chip}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button type="button" className="btn-primary" onClick={validateAndGoToLocation}>
                    {t('s1.continue')}
                  </button>
                </div>
              </div>
            )}

            {/* Screen 2: jurisdiction */}
            {effectiveScreen === 2 && (
              <div className="panel-card">
                <h2 className="panel-title">{t('s2.title')}</h2>
                <p className="panel-desc">{t('s2.sub')}</p>

                <label className="form-label" htmlFor="trc-region-field">
                  {t('s2.region')} *
                </label>
                <JurisdictionField
                  id="trc-region-field"
                  value={region}
                  onChange={setRegion}
                  placeholder={t('s2.regionPh')}
                />

                <label className="form-label" htmlFor="trc-city-field">
                  {t('s2.city')}
                </label>
                <input
                  id="trc-city-field"
                  type="text"
                  className="input-text"
                  placeholder={t('s2.cityPh')}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />

                <label className="form-label">{t('s2.duration')}</label>
                <div className="chip-list">
                  {DURATION_OPTIONS.map((dur, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`scenario-chip ${duration === dur ? 'active' : ''}`}
                      onClick={() => setDuration(dur)}
                    >
                      {dur || 'Unspecified'}
                    </button>
                  ))}
                </div>

                <div className="btn-group">
                  <button type="button" className="btn-secondary" onClick={() => setScreen(1)}>{t('s2.back')}</button>
                  <button type="button" className="btn-primary" style={{ flex: 1 }} disabled={!region.trim()} onClick={() => setScreen(3)}>
                    {t('s2.next')}
                  </button>
                </div>
              </div>
            )}

            {/* Screen 3: confirmation summary */}
            {effectiveScreen === 3 && (
              <div className="panel-card">
                {!loading ? (
                  <>
                    <h2 className="panel-title">{t('s3.title')}</h2>
                    <p className="panel-desc">{t('s3.sub')}</p>

                    <div style={{ background: 'var(--bg-surface-hover)', borderRadius: '12px', padding: '20px', marginBottom: '24px', border: '1px solid var(--border-color)' }}>
                      <div style={{ paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', marginBottom: '12px' }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{t('s3.dispute').toUpperCase()}</span>
                        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-main)' }}>{situation}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <div>
                          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>{t('s3.jurisdiction').toUpperCase()}</span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)' }}>{city ? `${city}, ${region}` : region}</span>
                        </div>
                        <div>
                          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>{t('s3.duration').toUpperCase()}</span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)' }}>{duration || 'N/A'}</span>
                        </div>
                      </div>
                    </div>

                    <p className="muted-hint" style={{ marginBottom: 24 }}>
                      {t('s3.keyNote')}
                    </p>

                    <div className="btn-group">
                      <button type="button" className="btn-secondary" onClick={() => setScreen(2)}>{t('s3.back')}</button>
                      <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={handleAnalyze}>
                        {t('s3.run')}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="loader-panel">
                    <div className="spinner-ring" />
                    <h3 className="loader-title">{t('s3.running')}</h3>
                    <p className="loader-desc">{t('s3.runningSub', { region })}</p>
                    <div className="loading-message" key={loadingMsgIdx}>{LOADING_MESSAGES[loadingMsgIdx]}</div>
                  </div>
                )}
              </div>
            )}

            {/* Screen 4: full analysis workspace */}
            {effectiveScreen === 4 && (
              <div>
                {/* UI Fix 2: Safety gate confirmation */}
                {showSafetyBanner && (
                  <div className="session-banner safety-confirm-banner">
                    <span>&#10003; Verified: This is a tenant-landlord housing dispute. Searching laws for {city ? `${city}, ${region}` : region}...</span>
                  </div>
                )}

                {/* UI Fix 3: Why this beats ChatGPT */}
                {showChatGPTCallout && (
                  <div className="chatgpt-callout">
                    <div className="chatgpt-callout-header">
                      <div className="chatgpt-callout-title">Why this gives better answers than asking ChatGPT</div>
                      <button type="button" className="session-banner-dismiss" onClick={() => { setShowChatGPTCallout(false); localStorage.setItem('trc_chatgpt_dismissed', '1'); }}>&#10005;</button>
                    </div>
                    <ul className="chatgpt-callout-list">
                      <li>Forces your jurisdiction first — not generic national advice</li>
                      <li>Checks every cited law URL before showing it</li>
                      <li>Output is structured for action — not a conversation you lose</li>
                      <li>Tenant-only scope means every answer is grounded in housing law</li>
                    </ul>
                  </div>
                )}

                {/* Verdict Highlight */}
                <div className={`result-header-card verdict-box-${verdict}`}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div className="verdict-label">
                      {verdict === 'illegal' && t('s4.verdictIllegal')}
                      {verdict === 'grey_area' && t('s4.verdictGrey')}
                      {verdict === 'legal' && t('s4.verdictLegal')}
                    </div>
                    <div className="verdict-desc">{explanation}</div>
                  </div>
                </div>

                {/* Feature 4: URL check session banner */}
                {showUrlBanner && (
                  <div className="session-banner">
                    <span className="url-check-banner">Unlike a general AI chatbot, this app checks whether every cited law URL actually exists before showing it to you.</span>
                    <button type="button" className="session-banner-dismiss" onClick={() => { setShowUrlBanner(false); sessionStorage.setItem('trc_url_banner_dismissed', '1'); }}>&#10005;</button>
                  </div>
                )}

                {/* Statutory Reference with inline citation badge */}
                {law && (
                  <div className="law-quote">
                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', color: 'var(--text-muted)', marginBottom: 4 }}>
                      {t('s4.lawCite')}
                    </span>
                    <div className="citation-inline">
                      <span>&ldquo;{law}&rdquo;</span>
                      {citation && (() => {
                        const isGov = lawUrl && (lawUrl.includes('.gov') || lawUrl.includes('.legislature'));
                        if (citation.verified && lawUrl) return <span className="citation-badge citation-badge-verified">Verified &#10003;</span>;
                        if (isGov) return <span className="citation-badge citation-badge-official">Official source</span>;
                        if (citation.sourceType === 'general_web') return <span className="citation-badge citation-badge-general">General web</span>;
                        return <span className="citation-badge citation-badge-unverified">Unverified</span>;
                      })()}
                    </div>
                    {citation && (
                      <div className="citation-tooltip">
                        {citation.verified
                          ? "We checked this URL — it's live and matches the law cited."
                          : `We could not verify this URL. Search "${law}" on your state's official legislature website to confirm.`}
                      </div>
                    )}
                    {lawUrl ? (
                      <div style={{ marginTop: 12 }}>
                        <span className="muted-hint" style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>{t('s4.lawLink')}</span>
                        <a href={lawUrl} target="_blank" rel="noopener noreferrer" className="org-link" style={{ wordBreak: 'break-all' }}>
                          {lawUrl}
                        </a>
                      </div>
                    ) : null}
                  </div>
                )}

                {citation && (
                  <div className="content-block">
                    <div className="block-header"><span>Citation confidence</span></div>
                    <div className="block-body">
                      <div className="insight-grid">
                        <div className="insight-item">
                          <span>Source</span>
                          <strong>{citation.sourceType.replaceAll('_', ' ')}</strong>
                        </div>
                        <div className="insight-item">
                          <span>Confidence</span>
                          <strong>{citation.confidence}</strong>
                        </div>
                        <div className="insight-item">
                          <span>URL verified</span>
                          <strong>{citation.verified ? 'Yes' : 'No'}</strong>
                        </div>
                      </div>
                      <p className="muted-hint" style={{ marginTop: 12 }}>{citation.note}</p>
                    </div>
                  </div>
                )}

                {deadlines.length > 0 && (
                  <div className="content-block">
                    <div className="block-header"><span>Deadlines and response windows</span></div>
                    <div className="block-body">
                      {deadlines.map((item, idx) => (
                        <div key={`${item.title}-${idx}`} className="org-row">
                          <div className="org-link">{item.title}</div>
                          <div className="org-phone">{item.dateOrWindow} - {item.priority} priority</div>
                          <div className="org-note">{item.basis}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {timeline.length > 0 && (
                  <div className="content-block">
                    <div className="block-header"><span>Case timeline</span></div>
                    <div className="block-body">
                      {timeline.map((item, idx) => (
                        <div key={`${item.label}-${idx}`} className="org-row">
                          <div className="org-link">{item.dateOrOrder}. {item.label}</div>
                          <div className="org-note">{item.note}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Feature 1: Counter-arguments */}
                {counterLoading && (
                  <div className="counter-skeleton">
                    <div className="spinner-ring" style={{ width: 24, height: 24, borderWidth: 2, marginBottom: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div className="skeleton-pulse" style={{ width: '60%', marginBottom: 6 }} />
                      <div className="skeleton-pulse" style={{ width: '40%' }} />
                    </div>
                  </div>
                )}
                {counterError && (
                  <div className="counter-section">
                    <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Unable to load counter-arguments.</p>
                    <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '6px 14px' }} onClick={handleRetryCounter}>Retry</button>
                  </div>
                )}
                {counterArguments.length > 0 && (
                  <div className="counter-section">
                    <div className="counter-section-title">What your landlord will argue</div>
                    <div className="counter-section-subtitle">Be ready. Here&apos;s what they&apos;ll say — and how to respond.</div>
                    {counterArguments.map((arg, idx) => (
                      <div key={idx} className="counter-card">
                        <div className="counter-row counter-row-red">
                          <span className="counter-label counter-label-red">They&apos;ll say:</span>
                          <span className="counter-text-italic">{arg.landlordArgument}</span>
                        </div>
                        <div className="counter-row counter-row-green">
                          <span className="counter-label counter-label-green">Why it fails:</span>
                          <span className="counter-text">{arg.whyItFails}</span>
                        </div>
                        <div className="counter-row counter-row-amber">
                          <span className="counter-label counter-label-amber">Have this ready:</span>
                          <span className="counter-text">{arg.evidenceNeeded}</span>
                        </div>
                      </div>
                    ))}
                    <p className="counter-disclaimer">Based on how courts in your jurisdiction have interpreted this law.</p>
                  </div>
                )}

                {/* Feature 2: Evidence checklist (above email) */}
                {(() => {
                  const disputeType = detectDisputeType(situation);
                  const items = EVIDENCE_CHECKLISTS[disputeType];
                  const essentialTotal = items.filter(i => i.critical).length;
                  const essentialChecked = items.filter((item, idx) => item.critical && evidenceChecked[idx]).length;
                  return (
                    <div className="evidence-section">
                      <div className="evidence-header">
                        <div className="evidence-title">Evidence to gather before you send anything</div>
                        <div className="evidence-subtitle">The stronger your paper trail, the stronger your position.</div>
                      </div>
                      <div className="evidence-progress">
                        You have {essentialChecked} of {essentialTotal} essential items
                      </div>
                      <div className="evidence-list">
                        {items.map((item, idx) => (
                          <div key={idx} className="evidence-item" onClick={() => setEvidenceChecked(prev => { const n = [...prev]; n[idx] = !n[idx]; return n; })}>
                            <div className={`evidence-checkbox ${evidenceChecked[idx] ? 'checked' : ''}`}>
                              {evidenceChecked[idx] && <span className="evidence-checkbox-mark">&#10003;</span>}
                            </div>
                            <div className={`evidence-dot ${item.critical ? 'evidence-dot-critical' : 'evidence-dot-helpful'}`} />
                            <div>
                              <span className={`evidence-label-type ${item.critical ? 'evidence-label-critical' : 'evidence-label-helpful'}`}>
                                {item.critical ? 'essential' : 'helpful'}
                              </span>
                              <div className="evidence-item-text">{item.item}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="evidence-footer">
                        Once you have the essential items, your email will be much harder for your landlord to dismiss.
                      </div>
                    </div>
                  );
                })()}

                {/* Critical Reminder Banner for editable blocks */}
                <div className="action-alert">
                  <div>
                    <div className="action-alert-title">{t('s4.placeholderTitle')}</div>
                    <div className="action-alert-text">{t('s4.placeholderSub')}</div>
                  </div>
                </div>

                {/* Email Response Box */}
                {email && (
                  <div className="content-block">
                    <div className="block-header">
                      <span>{t('s4.emailTitle')}</span>
                      <button type="button" className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={(e) => copyText(email, e.currentTarget)}>
                        {t('s4.copyEmail')}
                      </button>
                    </div>
                    <div className="block-body mono-draft">{email}</div>
                  </div>
                )}

                {/* Feature 3: Escalation Ladder */}
                <div className="escalation-section">
                  <div className="escalation-header">
                    <div className="escalation-title">Escalation path</div>
                    <div className="escalation-subtitle">Start here. Only escalate if the previous step is ignored.</div>
                  </div>
                  <div className="escalation-ladder">
                    {/* Level 1: Polite Email */}
                    <div className="escalation-step">
                      <div className="escalation-connector"><span className="escalation-badge escalation-badge-done">1</span><div className="escalation-line" /></div>
                      <div className="escalation-content">
                        <div className="escalation-step-title">Polite email</div>
                        <div className="escalation-step-status escalation-status-generated">{email ? 'Generated' : 'Available'}</div>
                        {email && <div className="escalation-result"><div className="mono-draft" style={{ maxHeight: 120, overflow: 'auto', fontSize: 12 }}>{email}</div><div style={{ marginTop: 8 }}><button type="button" className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={(e) => copyText(email, e.currentTarget)}>Copy email</button></div></div>}
                      </div>
                    </div>
                    {/* Level 2: Demand Letter */}
                    <div className="escalation-step">
                      <div className="escalation-connector"><span className={`escalation-badge ${nuclearGenerated ? 'escalation-badge-done' : 'escalation-badge-available'}`}>2</span><div className="escalation-line" /></div>
                      <div className="escalation-content">
                        <div className="escalation-step-title">Formal demand letter</div>
                        <div className={`escalation-step-status ${nuclearGenerated ? 'escalation-status-generated' : 'escalation-status-available'}`}>{nuclearGenerated ? 'Generated' : 'Available'}</div>
                        {!nuclearGenerated ? (
                          <button type="button" className="btn-primary escalation-btn" disabled={nuclearLoading} onClick={handleNuclear}>{nuclearLoading ? 'Drafting...' : 'Generate demand letter'}</button>
                        ) : (
                          <div className="escalation-result"><div className="mono-draft" style={{ maxHeight: 120, overflow: 'auto', fontSize: 12 }}>{demandLetter}</div><div style={{ marginTop: 8 }}><button type="button" className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={(e) => copyText(demandLetter, e.currentTarget)}>Copy letter</button></div></div>
                        )}
                      </div>
                    </div>
                    {/* Level 3: Agency Complaint */}
                    <div className="escalation-step">
                      <div className="escalation-connector"><span className={`escalation-badge ${agencyComplaint ? 'escalation-badge-done' : 'escalation-badge-available'}`}>3</span><div className="escalation-line" /></div>
                      <div className="escalation-content">
                        <div className="escalation-step-title">Housing authority / agency complaint</div>
                        <div className={`escalation-step-status ${agencyComplaint ? 'escalation-status-generated' : 'escalation-status-available'}`}>{agencyComplaint ? 'Generated' : 'Available'}</div>
                        {!agencyComplaint ? (
                          <button type="button" className="btn-primary escalation-btn" disabled={agencyLoading} onClick={handleAgencyComplaint}>{agencyLoading ? 'Generating...' : 'Generate agency complaint'}</button>
                        ) : (
                          <div className="escalation-result">
                            <div className="escalation-result-row"><span className="escalation-result-label">Agency</span>{agencyComplaint.agencyName}</div>
                            <div className="escalation-result-row"><span className="escalation-result-label">URL</span><a href={agencyComplaint.agencyUrl} target="_blank" rel="noopener noreferrer" className="org-link" style={{ fontSize: 13 }}>{agencyComplaint.agencyUrl}</a></div>
                            <div className="escalation-result-row"><span className="escalation-result-label">How to file</span>{agencyComplaint.filingMethod}</div>
                            <div className="escalation-result-row"><span className="escalation-result-label">Timeline</span>{agencyComplaint.timeline}</div>
                            <div className="escalation-result-row"><span className="escalation-result-label">Complaint text</span><div className="mono-draft" style={{ marginTop: 4, fontSize: 12 }}>{agencyComplaint.complaintText}</div></div>
                            <div style={{ marginTop: 8 }}><button type="button" className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={(e) => copyText(agencyComplaint.complaintText, e.currentTarget)}>Copy complaint</button></div>
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Level 4: Court Filing */}
                    <div className="escalation-step">
                      <div className="escalation-connector"><span className={`escalation-badge ${courtFiling ? 'escalation-badge-done' : 'escalation-badge-available'}`}>4</span></div>
                      <div className="escalation-content">
                        <div className="escalation-step-title">Small claims / housing court filing</div>
                        <div className={`escalation-step-status ${courtFiling ? 'escalation-status-generated' : 'escalation-status-available'}`}>{courtFiling ? 'Generated' : 'Available'}</div>
                        {!courtFiling ? (
                          <button type="button" className="btn-primary escalation-btn" disabled={courtLoading} onClick={handleCourtFiling}>{courtLoading ? 'Generating...' : 'Get court filing guide'}</button>
                        ) : (
                          <div className="escalation-result">
                            <div className="escalation-result-row"><span className="escalation-result-label">Court</span>{courtFiling.courtName}</div>
                            <div className="escalation-result-row"><span className="escalation-result-label">URL</span><a href={courtFiling.courtUrl} target="_blank" rel="noopener noreferrer" className="org-link" style={{ fontSize: 13 }}>{courtFiling.courtUrl}</a></div>
                            <div className="escalation-result-row"><span className="escalation-result-label">Small claims?</span>{courtFiling.isSmallClaims ? 'Yes' : 'No'}</div>
                            <div className="escalation-result-row"><span className="escalation-result-label">Filing fee</span>{courtFiling.filingFee}</div>
                            <div className="escalation-result-row"><span className="escalation-result-label">Claims limit</span>{courtFiling.claimsLimit}</div>
                            {courtFiling.whatToBring.length > 0 && <div className="escalation-result-row"><span className="escalation-result-label">What to bring</span><ul style={{ margin: '4px 0 0 16px', fontSize: 13 }}>{courtFiling.whatToBring.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
                            <div className="escalation-result-row"><span className="escalation-result-label">Statement of claim</span><div className="mono-draft" style={{ marginTop: 4, fontSize: 12 }}>{courtFiling.statementOfClaim}</div></div>
                            <div style={{ marginTop: 8 }}><button type="button" className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={(e) => copyText(courtFiling.statementOfClaim, e.currentTarget)}>Copy statement</button></div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Options Layout */}
                {options && (
                  <div className="content-block">
                    <div className="block-header"><span>{t('s4.optionsTitle')}</span></div>
                    <div className="block-body" style={{ whiteSpace: 'pre-line', color: 'var(--text-main)' }}>{options}</div>
                  </div>
                )}

                {/* Local Organization Groundings */}
                <div className="content-block">
                  <div className="block-header"><span>{t('s4.orgsTitle', { region })}</span></div>
                  <div className="block-body" style={{ padding: '8px 24px' }}>
                    {orgs && orgs.length > 0 ? (
                      orgs.map((org, idx) => (
                        <div key={idx} className="org-row">
                          <a href={org.url} target="_blank" rel="noopener noreferrer" className="org-link">
                            {org.rank ? `${org.rank}. ` : ''}{org.name || 'Tenant resource'}
                          </a>
                          {org.type && <div className="org-phone">{org.type.replaceAll('_', ' ')}</div>}
                          {org.phone && <div className="org-phone">{org.phone}</div>}
                          <div className="org-note">{org.note}</div>
                          {org.matchReason && <div className="org-note">Match: {org.matchReason}</div>}
                        </div>
                      ))
                    ) : (
                      <p style={{ fontSize: 14, color: 'var(--text-muted)', padding: '16px 0' }}>
                        {t('s4.orgsEmpty')}
                      </p>
                    )}
                  </div>
                </div>

                {lawyerNote && (
                  <div className="content-block">
                    <div className="block-header"><span>{t('s4.lawyerTitle')}</span></div>
                    <div className="block-body" style={{ fontSize: 14, color: 'var(--text-main)' }}>{lawyerNote}</div>
                  </div>
                )}

                <div className="content-block" style={{ padding: 24, background: 'var(--bg-surface-2)' }}>
                  <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{t('s4.pdfTitle')}</h4>
                  <p className="muted-hint" style={{ marginBottom: 18 }}>
                    {t('s4.pdfSub')}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <button type="button" className="btn-primary" style={{ padding: '12px 22px', fontSize: 14 }} onClick={handlePDF}>
                      {t('s4.pdfBtn')}
                    </button>
                  </div>
                  {pdfFeedback && (
                    <p className="muted-hint" style={{ marginTop: 14, fontWeight: 500, color: pdfFeedback === t('pdf.downloaded') ? 'var(--green-text)' : 'var(--red-text)' }}>
                      {pdfFeedback}
                    </p>
                  )}
                </div>

                <div style={{ padding: '12px 0 32px' }}>
                  <button type="button" className="btn-ghost" onClick={handleNewCase}>
                    {t('s4.another')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
