import { NextResponse } from "next/server";
import { getViewer } from "../../../lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Bạn cần đăng nhập bằng Google" }, { status: 401 });
  }
  return new Response(null, { status: 204 });
}
