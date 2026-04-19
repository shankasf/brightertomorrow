import { NextResponse } from "next/server";

const GATEWAY = process.env.GATEWAY_URL || "http://127.0.0.1:8090";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const r = await fetch(`${GATEWAY}/v1/faqs`, {
      headers: { accept: "application/json" },
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return NextResponse.json({ error: "upstream" }, { status: 502 });
    const data = await r.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "upstream_timeout" }, { status: 504 });
  }
}
