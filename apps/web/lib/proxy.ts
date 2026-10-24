import type { NextRequest } from "next/server";

const BRAIN_URL = (process.env.BRAIN_URL ?? "http://localhost:8000").replace(/\/$/, "");
// Hop-by-hop headers, plus the ones fetch sets itself.
const DROP = new Set(["connection", "keep-alive", "transfer-encoding", "host", "content-length", "accept-encoding"]);

/**
 * Forwards one request to the brain and streams the answer back unbuffered: the event stream stays open
 * as long as the browser holds it, uploads stream through, and the brain's headers (the game page's
 * Content-Security-Policy, Content-Type) arrive as sent. The kite_token cookie travels in the Cookie header.
 */
export async function forward(req: NextRequest, path: string): Promise<Response> {
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!DROP.has(key)) headers.set(key, value);
  });
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const upstream = await fetch(`${BRAIN_URL}${path}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    // Required by Node's fetch to stream a request body.
    ...(hasBody ? { duplex: "half" } : {}),
    redirect: "manual",
    signal: req.signal,
  } as RequestInit);
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP.has(key) && key !== "content-encoding") out.set(key, value);
  });
  if (out.get("content-type")?.startsWith("text/event-stream")) out.set("X-Accel-Buffering", "no");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
