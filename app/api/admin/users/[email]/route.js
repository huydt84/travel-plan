import { NextResponse } from "next/server";
import { ownerEmail } from "../../../../../auth";
import { apiError } from "../../../../../lib/api-response";
import { getViewer } from "../../../../../lib/auth";
import { updateUserRole } from "../../../../../lib/user-repository";
import { parseUserRole, readJsonBody, ValidationError } from "../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const emailFrom = (value) => {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!email || !email.includes("@") || email.length > 320) throw new ValidationError("Email người dùng không hợp lệ");
  return email;
};

export async function PATCH(request, context) {
  const viewer = await getViewer();
  if (!viewer?.isOwner) {
    return NextResponse.json({ error: "Chỉ owner mới có quyền thay đổi phân quyền" }, { status: 403 });
  }
  try {
    const { email } = await context.params;
    const { role } = parseUserRole(await readJsonBody(request));
    return NextResponse.json(await updateUserRole({
      email: emailFrom(email),
      role,
      ownerEmail: ownerEmail(),
    }));
  } catch (error) {
    return apiError(error);
  }
}
