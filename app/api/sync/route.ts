import { NextRequest, NextResponse } from "next/server";
import { mailConfigured } from "@/lib/mail";
import { syncMailbox } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.headers.get("authorization") === `Bearer ${secret}`;
  // Without a CRON_SECRET, accept Vercel's cron user agent (deployment protection still applies).
  return (req.headers.get("user-agent") ?? "").startsWith("vercel-cron/");
}

async function run(req: NextRequest) {
  if (!mailConfigured()) {
    return NextResponse.json({ error: "GOOGLE_PASSWORD is not set; the mailbox cannot be scanned." }, { status: 400 });
  }
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "");
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 60) : 20;
  const info = await syncMailbox({ limit });
  return NextResponse.json(info, { status: info.error ? 500 : 200 });
}

/** Vercel Cron (GET). */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run(req);
}

/** "Scan inbox" button (POST, behind the app's own auth). */
export async function POST(req: NextRequest) {
  return run(req);
}
