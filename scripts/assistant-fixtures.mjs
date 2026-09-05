export const activity = {
  id: "1", key: "museum", branchId: null, startDate: "2030-01-01", endDate: "2030-01-01",
  start: "09:00", end: "10:00", displayEnd: null, type: "Visit", icon: "pin",
  title: "Museum", detail: "Original", refs: [],
};
export const snapshot = {
  revision: 1, tripId: "1",
  trip: { slug: "harness", title: "Harness", startDate: "2030-01-01", endDate: "2030-01-01", timezone: "Asia/Tokyo", location: "Tokyo" },
  sources: [], backbone: [activity], branchGroups: [], itinerary: [activity],
};
export const call = (name, args, id = name) => ({ type: "function_call", name, arguments: args, id });
export function scriptedClient(steps, { deleteError = false } = {}) {
  const requests = [], deleted = [];
  return { requests, deleted, interactions: {
    async create(request) {
      requests.push(request);
      const step = steps.shift();
      if (step instanceof Error) throw step;
      const result = typeof step === "function" ? await step(request) : step;
      return { id: `interaction-${requests.length}`, status: result.steps?.length ? "requires_action" : "completed", ...result };
    },
    async delete(id) { deleted.push(id); if (deleteError) throw new Error("cleanup failed"); },
  } };
}
