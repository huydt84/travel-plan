import { notFound, redirect } from "next/navigation";
import { resolveAgenticV1Config } from "../../lib/v1/config.mjs";
export const dynamic = "force-dynamic";
export default async function LegacyAssistantPage({ searchParams }) {
  if (!resolveAgenticV1Config().enabled) notFound();
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["trip", "conversation"]) if (typeof params[key] === "string") query.set(key, params[key]);
  redirect(`/assistant${query.size ? `?${query}` : ""}`);
}
