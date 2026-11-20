import { NextResponse } from "next/server";
import { handlePropose } from "@/server/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One LLM call per request. 60 s fits the Vercel Hobby plan limit.
export const maxDuration = 60;

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, code: "bad_request", error: "Body must be JSON" }, { status: 400 });
  }
  const r = await handlePropose(json, req.headers.get("x-access-code"));
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
