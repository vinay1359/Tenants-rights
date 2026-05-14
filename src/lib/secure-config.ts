import { NextRequest } from 'next/server';
import type { AIProvider } from '@/lib/types';

export const CONFIG_COOKIE_NAME = 'trc_config';
export const CONFIG_COOKIE_MAX_AGE = 60 * 30;

const ALLOWED_PROVIDERS = new Set<AIProvider>(['groq', 'gemini', 'openai', 'claude']);

type StoredConfig = {
  apiKey: string;
  provider: AIProvider;
  exp: number;
};

function getCryptoKeyMaterial(): string {
  return (
    process.env.CONFIG_ENCRYPTION_KEY ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_JWT_SECRET ||
    ''
  );
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

async function deriveKey(secret: string) {
  const source = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode('tenant-rights-checker-config-v1'),
      iterations: 210000,
      hash: 'SHA-256',
    },
    source,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function toBase64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(value: string) {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

export function validateProvider(provider: unknown): provider is AIProvider {
  return typeof provider === 'string' && ALLOWED_PROVIDERS.has(provider as AIProvider);
}

export function validateApiKey(apiKey: unknown): string | null {
  if (typeof apiKey !== 'string') return null;
  const trimmed = apiKey.trim();
  if (trimmed.length < 10 || trimmed.length > 256) return null;
  if (/[\r\n\t]/.test(trimmed)) return null;
  return trimmed;
}

export async function encryptConfig(apiKey: string, provider: AIProvider): Promise<string> {
  const secret = getCryptoKeyMaterial();
  if (!secret && isProduction()) {
    throw new Error('CONFIG_ENCRYPTION_KEY is required in production.');
  }

  const key = await deriveKey(secret || 'development-only-change-me');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload: StoredConfig = {
    apiKey,
    provider,
    exp: Date.now() + CONFIG_COOKIE_MAX_AGE * 1000,
  };
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload))
  );

  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

export async function readEncryptedConfig(req: NextRequest): Promise<{ apiKey: string; provider: AIProvider } | null> {
  const raw = req.cookies.get(CONFIG_COOKIE_NAME)?.value;
  if (!raw) return null;

  const [version, ivRaw, dataRaw] = raw.split('.');
  if (version !== 'v1' || !ivRaw || !dataRaw) return null;

  try {
    const secret = getCryptoKeyMaterial();
    if (!secret && isProduction()) return null;

    const key = await deriveKey(secret || 'development-only-change-me');
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(ivRaw) },
      key,
      fromBase64Url(dataRaw)
    );
    const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as StoredConfig;
    const cleanKey = validateApiKey(parsed.apiKey);
    if (!cleanKey || !validateProvider(parsed.provider) || parsed.exp < Date.now()) {
      return null;
    }
    return { apiKey: cleanKey, provider: parsed.provider };
  } catch {
    return null;
  }
}
