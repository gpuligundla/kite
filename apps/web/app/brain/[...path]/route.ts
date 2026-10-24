import type { NextRequest } from "next/server";
import { forward } from "@/lib/proxy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { path } = await params;
  return forward(req, `/${path.map(encodeURIComponent).join("/")}`);
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
