import { NextResponse } from "next/server";
import { processAdminNotificationOutbox } from "../../../../lib/admin-notification-outbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const configuredSecret = () => process.env.CRON_SECRET?.trim() || "";

export async function GET(request) {
  const secret = configuredSecret();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deliveries = await processAdminNotificationOutbox({ limit: 20 });
  return NextResponse.json({
    processed: deliveries.length,
    sent: deliveries.filter((delivery) => delivery.status === "sent").length,
    failed: deliveries.filter((delivery) => delivery.status === "failed").length,
  });
}
