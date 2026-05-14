import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let supabaseResponse = NextResponse.next({ request });

  // Supabase session refresh (only if configured)
  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });
    await supabase.auth.getUser();
  }

  // ---- Security headers ----
  const isProd = process.env.NODE_ENV === 'production';

  // Prevent clickjacking
  supabaseResponse.headers.set('X-Frame-Options', 'DENY');
  // Stop MIME-type sniffing
  supabaseResponse.headers.set('X-Content-Type-Options', 'nosniff');
  // Only send origin as referrer
  supabaseResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Disable browser features we don't use
  supabaseResponse.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Remove server fingerprint
  supabaseResponse.headers.delete('X-Powered-By');
  supabaseResponse.headers.delete('Server');

  // Build connect-src dynamically based on configured Supabase URL
  const connectSources = ["'self'"];
  if (url) {
    // Allow both the main URL and auth/realtime subdomains
    connectSources.push(url);
    try {
      const parsed = new URL(url);
      connectSources.push(`https://*.${parsed.hostname.split('.').slice(-2).join('.')}`);
      // Realtime uses wss://
      connectSources.push(`wss://*.${parsed.hostname.split('.').slice(-2).join('.')}`);
    } catch { /* ignore */ }
  }
  connectSources.push(
    'https://generativelanguage.googleapis.com',
    'https://api.groq.com',
    'https://api.openai.com',
    'https://api.anthropic.com'
  );

  // In development, allow localhost and HMR websocket connections
  if (!isProd) {
    connectSources.push('http://localhost:*', 'ws://localhost:*', 'wss://localhost:*');
  }

  // Content Security Policy
  supabaseResponse.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${!isProd ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      `connect-src ${connectSources.join(' ')}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );

  // Strict Transport Security (only meaningful in production with HTTPS)
  if (isProd) {
    supabaseResponse.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
