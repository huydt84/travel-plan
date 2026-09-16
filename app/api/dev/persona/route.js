import { NextResponse } from "next/server";
import { LOCAL_PERSONA_COOKIE, localPersonaById } from "../../../../lib/local-personas.mjs";
import { resolveLocalPersonaSwitcher } from "../../../../lib/runtime-config.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

export async function POST(request) {
  if (!resolveLocalPersonaSwitcher()) return new NextResponse(null, { status: 404 });
  const target = new URL(request.url);
  let origin;
  try { origin = new URL(request.headers.get("origin") || ""); }
  catch { return NextResponse.json({ error: "Nguồn yêu cầu không hợp lệ" }, { status: 403 }); }
  const requestHost = request.headers.get("host");
  if (!loopbackHosts.has(target.hostname) || !loopbackHosts.has(origin.hostname) || origin.host !== requestHost) {
    return NextResponse.json({ error: "Nguồn yêu cầu không hợp lệ" }, { status: 403 });
  }
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Request body phải là JSON hợp lệ" }, { status: 400 }); }
  const persona = localPersonaById(body?.personaId);
  if (!persona) return NextResponse.json({ error: "Persona không hợp lệ" }, { status: 400 });
  const response = NextResponse.redirect(new URL("/", origin), 303);
  response.cookies.set(LOCAL_PERSONA_COOKIE, persona.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return response;
}
