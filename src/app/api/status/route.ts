import { NextResponse } from "next/server";
import { statusPayload } from "@/server/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(statusPayload(), { headers: { "Cache-Control": "no-store" } });
}
