import { NextResponse } from "next/server";

const GATEWAY = process.env.GATEWAY_URL || "http://127.0.0.1:8090";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  const cookie = req.headers.get("cookie") ?? "";

  try {
    const r = await fetch(`${GATEWAY}/v1/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body,
      signal: AbortSignal.timeout(25_000),
    });
    const text = await r.text();
    const res = new NextResponse(text, {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
    for (const cookie of r.headers.getSetCookie()) {
      res.headers.append("set-cookie", cookie);
    }
    return res;
  } catch (err) {
    console.error("chat proxy error", err);
    return NextResponse.json(
      {
        session_id: null,
        reply:
          "Thanks for reaching out! Our AI assistant is taking a quick break. " +
          "For immediate help, call 725-238-6990 or use our contact form.",
      },
      { status: 503 },
    );
  }
}
