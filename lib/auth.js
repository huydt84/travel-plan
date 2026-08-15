import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth, ownerEmail } from "../auth";
import { resolveLocalAdminViewer } from "./runtime-config.mjs";
import { recordUserActivity } from "./user-repository";

async function withRecordedActivity(viewer) {
  if (!viewer) return null;
  try {
    await recordUserActivity(viewer);
  } catch {
    console.error("Unable to record authenticated user activity");
  }
  return viewer;
}

export async function getViewer() {
  const localAdminViewer = resolveLocalAdminViewer();
  if (localAdminViewer) {
    const requestHeaders = await headers();
    const localEmail = requestHeaders.get("x-local-viewer-email")?.trim().toLowerCase();
    if (!localEmail) return withRecordedActivity(localAdminViewer);
    const localName = requestHeaders.get("x-local-viewer-name")?.trim() || localEmail.split("@")[0];
    return withRecordedActivity({
      email: localEmail,
      name: localName,
      image: null,
      isOwner: localEmail === localAdminViewer.email,
      authMode: "local-dev",
    });
  }

  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  return withRecordedActivity({
    email,
    name: session.user.name || email.split("@")[0],
    image: session.user.image || null,
    isOwner: email === ownerEmail(),
    authMode: "google",
  });
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
