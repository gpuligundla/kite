import { NextResponse, type NextRequest } from "next/server";

const HOME: Record<string, string> = { os: "/os", handheld: "/os?device=handheld", parent: "/parent", counselor: "/counselor" };

/**
 * Pairs this browser with a device token: /setup?token=…&to=os|handheld|parent|counselor.
 * The token becomes an httpOnly cookie and the redirect drops it from the address bar at once,
 * so it never reaches the brain's logs or the browser history entry that stays.
 */
export function GET(req: NextRequest): NextResponse {
  const token = req.nextUrl.searchParams.get("token");
  const to = HOME[req.nextUrl.searchParams.get("to") ?? "os"] ?? HOME.os;
  if (!token) return NextResponse.json({ error: "Add ?token= with this device's token from the seed." }, { status: 400 });
  // A relative Location: behind Azure's ingress req.url names the container (https://0.0.0.0:3000), not the
  // public host, so an absolute redirect sent every paired browser nowhere.
  const res = new NextResponse(null, { status: 303, headers: { Location: to } });
  res.cookies.set("kite_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
