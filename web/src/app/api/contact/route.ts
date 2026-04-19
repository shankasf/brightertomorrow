import { NextResponse } from "next/server";

const GATEWAY = process.env.GATEWAY_URL || "http://127.0.0.1:8090";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const ua = req.headers.get("user-agent") ?? "";

  try {
    const r = await fetch(`${GATEWAY}/v1/contact`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": xff,
        "user-agent": ua,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = await r.json().catch(() => ({}));
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json({ error: "upstream_timeout" }, { status: 504 });
  }
}
