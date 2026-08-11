import { NextResponse } from "next/server";
import { auth, ownerEmail } from "../auth";
import { resolveLocalAdminViewer } from "./runtime-config.mjs";

export async function getViewer() {
  const localAdminViewer = resolveLocalAdminViewer();
  if (localAdminViewer) return localAdminViewer;

  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  return {
    email,
    name: session.user.name || email.split("@")[0],
    image: session.user.image || null,
    isOwner: email === ownerEmail(),
    authMode: "google",
  };
}

export async function requireAuthenticated() {
  const viewer = await getViewer();
  return viewer
    ? { viewer, response: null }
    : {
        viewer: null,
        response: NextResponse.json({ error: "Bạn cần đăng nhập bằng Google" }, { status: 401 }),
      };
}

export async function requireOwner() {
  const viewer = await getViewer();
  return viewer?.isOwner
    ? null
    : NextResponse.json({ error: "Chỉ chủ lịch mới có quyền chỉnh sửa" }, { status: 403 });
}
