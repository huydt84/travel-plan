import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth, ownerEmail } from "../auth";
import { resolveLocalAdminViewer } from "./runtime-config.mjs";
import { getStoredUser, recordUserActivity, resolveUserRole } from "./user-repository";

async function withRecordedActivity(viewer) {
  if (!viewer) return null;
  const activity = recordUserActivity(viewer).catch(() => {
    console.error("Unable to record authenticated user activity");
    return null;
  });
  const storedUser = activity.then((user) => user || getStoredUser(viewer.email)).catch(() => null);
  if (viewer.isOwner) {
    const stored = await storedUser;
    const displayName = stored?.displayName || viewer.name;
    return { ...viewer, name: displayName, displayName, role: "owner", isAdmin: true };
  }
  let role = "member";
  let stored = null;
  try {
    [stored, role] = await Promise.all([storedUser, resolveUserRole(viewer.email)]);
  } catch {
    console.error("Unable to resolve authenticated user role");
  }
  const displayName = stored?.displayName || viewer.name;
  return { ...viewer, name: displayName, displayName, role, isAdmin: role === "admin" };
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

export async function requireAdmin() {
  const viewer = await getViewer();
  return viewer?.isAdmin
    ? null
    : NextResponse.json({ error: "Chỉ admin mới có quyền chỉnh sửa" }, { status: 403 });
}
