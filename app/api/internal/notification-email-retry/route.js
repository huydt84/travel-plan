import { NextResponse } from "next/server";
import { processAdminNotificationOutbox } from "../../../../lib/admin-notification-outbox";
import { processAssistantHandoffOutbox } from "../../../../lib/assistant-handoff-outbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const configuredSecret = () => process.env.CRON_SECRET?.trim() || "";

export async function GET(request) {
  const secret = configuredSecret();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [contributions, handoffs] = await Promise.all([
    processAdminNotificationOutbox({ limit: 20 }),
    processAssistantHandoffOutbox({ limit: 20 }),
  ]);
  const deliveries = [...contributions, ...handoffs];
  return NextResponse.json({
    processed: deliveries.length,
    sent: deliveries.filter((delivery) => delivery.status === "sent").length,
    failed: deliveries.filter((delivery) => delivery.status === "failed").length,
  });
}
