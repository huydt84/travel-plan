import { NextResponse } from "next/server";
import { getViewer, requireOwner } from "../../../../../lib/auth";
import { InvitationPermissionError } from "../../../../../lib/invitation-permission-store.mjs";
import { updateInvitationPermission } from "../../../../../lib/invitation-permission-repository";
import { readJsonBody, ValidationError } from "../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request, { params }) {
  const unauthorized = await requireOwner();
  if (unauthorized) return unauthorized;

  try {
    const { permissionId } = await params;
    if (!/^\d+$/.test(permissionId)) throw new ValidationError("Yêu cầu quyền không hợp lệ");
    const body = await readJsonBody(request);
    if (!["approve", "deny", "revoke"].includes(body?.action)) {
      throw new ValidationError("Hành động duyệt không hợp lệ");
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length > 300) throw new ValidationError("Lý do không được vượt quá 300 ký tự");
    const viewer = await getViewer();
    const permission = await updateInvitationPermission({
      id: permissionId,
      action: body.action,
      reviewerEmail: viewer.email,
      reason,
    });
    return NextResponse.json(permission);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof InvitationPermissionError && error.code === "PERMISSION_NOT_FOUND") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: "Không thể cập nhật quyền lúc này" }, { status: 500 });
  }
}

