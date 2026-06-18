import { NextRequest, NextResponse } from "next/server";

/**
 * API-only: session required for all /api/* except auth, telemetry, and
 * /api/template (server-to-server template layout for FastAPI fallback).
 * Page routes are protected in server layouts (unknown URLs still 404; login uses relative redirects).
 */
function getFastApiBaseUrl(): string {
  const internal = process.env.FAST_API_INTERNAL_URL?.trim();
  if (internal) {
    return internal.replace(/\/+$/, "");
  }
  const configured = process.env.NEXT_PUBLIC_FAST_API?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  if (process.env.NODE_ENV === "development") {
    return "http://127.0.0.1:8000";
  }
  return "http://127.0.0.1:8000";
}

type AuthStatus = {
  configured: boolean;
  authenticated: boolean;
};

function isAuthDisabled(): boolean {
  const raw = process.env.DISABLE_AUTH?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

const SESSION_COOKIE_NAME = "presenton_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PDF_MAKER_OFFLINE_CSP = [
  "default-src 'self' data: blob:",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
].join("; ");

async function getAuthStatus(request: NextRequest): Promise<AuthStatus> {
  const cookieHeader = request.headers.get("cookie");
  const authStatusUrl = `${getFastApiBaseUrl()}/api/v1/auth/status`;
  try {
    const response = await fetch(authStatusUrl, {
      method: "GET",
      headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
      cache: "no-store",
    });
    if (!response.ok) {
      return { configured: true, authenticated: false };
    }
    const payload = (await response.json()) as Partial<AuthStatus>;
    return {
      configured: Boolean(payload.configured),
      authenticated: Boolean(payload.authenticated),
    };
  } catch {
    return { configured: true, authenticated: false };
  }
}

function isApiAuthExempt(pathname: string): boolean {
  return (
    pathname.startsWith("/api/v1/auth/") ||
    pathname === "/api/telemetry-status" ||
    /** FastAPI `get_layout_by_name` fallback (no browser cookie in Docker). */
    pathname === "/api/template" ||
    pathname.startsWith("/api/export-presentation-data/") ||
    pathname.startsWith("/api/export-template-layouts/")
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/pdf-maker") {
    const exportSession = request.nextUrl.searchParams.get("exportSession");
    if (exportSession) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.searchParams.delete("exportSession");

      const response = NextResponse.redirect(redirectUrl);
      response.headers.set("Content-Security-Policy", PDF_MAKER_OFFLINE_CSP);
      response.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: exportSession,
        maxAge: SESSION_TTL_SECONDS,
        httpOnly: true,
        secure:
          request.headers.get("x-forwarded-proto")?.toLowerCase() === "https" ||
          request.nextUrl.protocol === "https:",
        sameSite: "lax",
        path: "/",
      });
      return response;
    }

    const response = NextResponse.next();
    response.headers.set("Content-Security-Policy", PDF_MAKER_OFFLINE_CSP);
    return response;
  }

  if (isAuthDisabled()) {
    return NextResponse.next();
  }

  if (request.method === "OPTIONS" || isApiAuthExempt(pathname)) {
    return NextResponse.next();
  }

  const authStatus = await getAuthStatus(request);
  if (authStatus.authenticated) {
    return NextResponse.next();
  }
  if (!authStatus.configured) {
    return NextResponse.json(
      { detail: "Login setup is required", setup_required: true },
      { status: 428, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(
    { detail: "Unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );
}

export const config = {
  matcher: ["/api/:path*", "/pdf-maker"],
};
