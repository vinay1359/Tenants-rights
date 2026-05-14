import { NextRequest, NextResponse } from 'next/server';
import {
  CONFIG_COOKIE_MAX_AGE,
  CONFIG_COOKIE_NAME,
  encryptConfig,
  readEncryptedConfig,
  validateApiKey,
  validateProvider,
} from '@/lib/secure-config';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: CONFIG_COOKIE_MAX_AGE,
};

export async function GET(req: NextRequest) {
  const cookieCfg = await readEncryptedConfig(req);

  if (cookieCfg?.apiKey?.trim()) {
    return NextResponse.json({
      configured: true,
      provider: cookieCfg.provider,
    });
  }

  return NextResponse.json({ configured: false, provider: null });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, provider } = body;

    if (!validateProvider(provider)) {
      return NextResponse.json({ error: 'Pick a supported AI provider.' }, { status: 400 });
    }

    const trimmedKey = validateApiKey(apiKey);
    if (!trimmedKey) {
      return NextResponse.json({ error: 'API key looks invalid. Check the key and try again.' }, { status: 400 });
    }

    const encoded = await encryptConfig(trimmedKey, provider);
    const response = NextResponse.json({
      success: true,
      provider,
    });
    response.cookies.set(CONFIG_COOKIE_NAME, encoded, COOKIE_OPTIONS);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid request.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(CONFIG_COOKIE_NAME, '', { ...COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
