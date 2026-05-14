const TENANT_TERMS = [
  'tenant',
  'landlord',
  'rent',
  'rental',
  'lease',
  'apartment',
  'unit',
  'eviction',
  'deposit',
  'repair',
  'habitability',
  'notice',
  'housing',
  'property manager',
  'roommate',
  'hot water',
  'heat',
  'mold',
  'pest',
  'lockout',
  'rent increase',
];

const BLOCKED_TERMS = [
  'ignore previous',
  'ignore all previous',
  'system prompt',
  'developer message',
  'jailbreak',
  'prompt injection',
  'api key',
  'steal',
  'hack',
  'exploit',
  'sql injection',
  'xss',
  'malware',
  'phishing',
  'bypass',
  'ddos',
  'weapon',
  'kill',
  'assault',
  'blackmail',
  'extort',
  'forge',
  'fake document',
  'break into',
  'disregard',
  'new instructions',
  'override',
  'pretend you are',
  'act as',
  'roleplay',
  'reveal your',
  'show me the prompt',
  'what is your system',
  'repeat the above',
  'print your instructions',
  'output your',
  'tell me the password',
  'access token',
  'bearer token',
  'authorization header',
  'curl command',
  'fetch the api',
  'execute code',
  'run script',
  'eval(',
  'subprocess',
  '<script',
];

export function validateTenantComplaint(input: string): { ok: true } | { ok: false; reason: string } {
  const text = input.trim();
  const lower = text.toLowerCase();

  if (text.length < 8) {
    return { ok: false, reason: 'Describe a real tenant or landlord issue with a little more detail.' };
  }

  const blocked = BLOCKED_TERMS.find((term) => lower.includes(term));
  if (blocked) {
    return {
      ok: false,
      reason:
        'This tool only accepts tenant-rights complaints. It cannot help with hacking, prompt injection, threats, fraud, or illegal activity.',
    };
  }

  const hasTenantContext = TENANT_TERMS.some((term) => lower.includes(term));
  if (!hasTenantContext) {
    return {
      ok: false,
      reason:
        'This does not look like a tenant or landlord complaint. Please describe a rental housing issue such as rent, repairs, deposits, notices, eviction, entry, or lease terms.',
    };
  }

  return { ok: true };
}
