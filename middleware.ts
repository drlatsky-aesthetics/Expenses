import { NextRequest, NextResponse } from "next/server";

/**
 * Optional HTTP Basic auth for the whole app.
 * Set APP_PASSWORD (and optionally APP_USER, default "admin") on Vercel to enable it.
 * Vercel Cron calls to /api/sync pass through when they carry the CRON_SECRET bearer token.
 */
export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const auth = req.headers.get("authorization") ?? "";

  const cronSecret = process.env.CRON_SECRET;
  if (
    cronSecret &&
    req.nextUrl.pathname === "/api/sync" &&
    auth === `Bearer ${cronSecret}`
  ) {
    return NextResponse.next();
  }

  if (auth.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6));
      const idx = decoded.indexOf(":");
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);
      const expectedUser = process.env.APP_USER || "admin";
      if (user === expectedUser && pass === password) return NextResponse.next();
    } catch {
      // fall through to 401
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Expenses", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|apple-icon.png|manifest.webmanifest).*)"],
};
