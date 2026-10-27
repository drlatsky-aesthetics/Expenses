import { NextRequest, NextResponse } from "next/server";

/**
 * Optional HTTP Basic auth for the whole app.
 * Set APP_PASSWORD on Vercel to enable it. Allowed usernames come from APP_USERS
 * (comma-separated, e.g. "jlatsky,dbudning"), else APP_USER, else "admin"; all share the password.
 * Vercel Cron calls to /api/sync pass through when they carry the CRON_SECRET bearer token.
 */
function allowedUsers(): string[] {
  const list = (process.env.APP_USERS || process.env.APP_USER || "admin")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : ["admin"];
}
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
      if (allowedUsers().includes(user.trim().toLowerCase()) && pass === password) return NextResponse.next();
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
