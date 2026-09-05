import { reserveItemKey } from "../schedule-keys.mjs";
import { sourceDetailsFromUrl } from "../source-fields.mjs";
import { nextBackboneActivity, validateBranchTimeline } from "../schedule-branching.mjs";
import { AssistantFault } from "./errors.mjs";
import { planOperationsSchema, validateSchema } from "./schemas.mjs";
import { compareActivityDateTime, validateActivityInterval } from "../trip-dates.mjs";

const activityFields = ["startDate", "start", "endDate", "end", "displayEnd", "type", "icon", "title", "detail"];
const cloneActivity = (item) => ({ ...item, refs: [...(item.refs || [])] });
const visibleActivity = (item) => Object.fromEntries(["key", ...activityFields, "refs", "branchId"].map((field) => [field, item[field] ?? null]));

const assertTimeline = (snapshot, activities) => {
  const backbone = activities.filter((item) => item.branchId == null).sort(compareSchedule);
  validateBranchTimeline({ anchor: null, rejoin: null, itinerary: backbone });

  for (const group of snapshot.branchGroups) {
    const anchor = group.anchorActivityId == null ? null : backbone.find((item) => item.id === group.anchorActivityId);
    const rejoin = nextBackboneActivity(backbone, group.anchorActivityId);
    for (const branch of group.branches) {
      validateBranchTimeline({
        anchor,
        rejoin,
        itinerary: activities.filter((item) => String(item.branchId) === String(branch.id)).sort(compareSchedule),
      });
    }
  }
};

const compareSchedule = compareActivityDateTime;

export function compilePlanProposal(snapshot, proposedOperations) {
  validateSchema(planOperationsSchema, proposedOperations, "Danh sách thay đổi");
  const existingSourceNumbers = new Set(snapshot.sources.map((source) => Number(source.number)));
  const usedKeys = new Set([
    ...snapshot.backbone.map((item) => item.key),
    ...snapshot.branchGroups.flatMap((group) => group.branches.flatMap((branch) => branch.itinerary.map((item) => item.key))),
  ]);
  const branchByKey = new Map(snapshot.branchGroups.flatMap((group) => group.branches.map((branch) => [branch.key, branch])));
  const anchorKeys = new Set(snapshot.branchGroups
    .map((group) => snapshot.backbone.find((item) => item.id === group.anchorActivityId)?.key)
    .filter(Boolean));
  const activities = [
    ...snapshot.backbone.map(cloneActivity),
    ...snapshot.branchGroups.flatMap((group) => group.branches.flatMap((branch) => branch.itinerary.map(cloneActivity))),
  ];
  const activityByKey = new Map(activities.map((item) => [item.key, item]));
  const draftSources = new Map();
  let nextSourceNumber = Math.max(0, ...existingSourceNumbers) + 1;
  const operations = [];
  const changes = [];

  const resolveRefs = (refs = []) => [...new Set(refs.map((ref) => {
    if (ref.sourceNumber) {
      if (!existingSourceNumbers.has(ref.sourceNumber)) {
        throw new AssistantFault("PROPOSAL_INVALID", `Nguồn số ${ref.sourceNumber} không tồn tại`, { status: 400 });
      }
      return ref.sourceNumber;
    }
    const draft = draftSources.get(ref.draftId);
    if (!draft) throw new AssistantFault("PROPOSAL_INVALID", `Nguồn tạm ${ref.draftId} chưa được khai báo`, { status: 400 });
    return draft.sourceNumber;
  }))];

  for (const operation of proposedOperations) {
    if (operation.kind === "source.add") {
      if (draftSources.has(operation.draftId)) throw new AssistantFault("PROPOSAL_INVALID", `Nguồn tạm ${operation.draftId} bị trùng`, { status: 400 });
      const details = sourceDetailsFromUrl(operation.url);
      if (!details) throw new AssistantFault("PROPOSAL_INVALID", "URL nguồn không hợp lệ", { status: 400 });
      const duplicate = snapshot.sources.find((source) => source.url === details.url);
      const source = duplicate
        ? { sourceNumber: Number(duplicate.number), title: duplicate.title, host: duplicate.host, url: duplicate.url, existing: true }
        : { sourceNumber: nextSourceNumber++, title: operation.title.trim(), ...details, existing: false };
      draftSources.set(operation.draftId, source);
      if (!source.existing) {
        existingSourceNumbers.add(source.sourceNumber);
        operations.push({ kind: "source.add", ...source });
        changes.push({ kind: "source.add", title: source.title, targetKey: `source-${source.sourceNumber}`, before: null, after: source });
      }
      continue;
    }

    if (operation.kind === "activity.add") {
      if (activityByKey.has(operation.draftId)) throw new AssistantFault("PROPOSAL_INVALID", `Mã tạm ${operation.draftId} bị trùng`, { status: 400 });
      const branch = operation.lane.kind === "branch" ? branchByKey.get(operation.lane.branchKey) : null;
      if (operation.lane.kind === "branch" && !branch) throw new AssistantFault("PROPOSAL_INVALID", `Không tìm thấy nhánh ${operation.lane.branchKey}`, { status: 400 });
      const item = {
        id: null,
        key: reserveItemKey(operation.value.title, usedKeys),
        branchId: branch ? String(branch.id) : null,
        ...Object.fromEntries(activityFields.map((field) => [field, operation.value[field] ?? (field === "displayEnd" ? null : "")])),
        refs: resolveRefs(operation.value.refs || []),
      };
      try { validateActivityInterval(item, { trip: snapshot.trip }); }
      catch (error) { throw new AssistantFault("PROPOSAL_INVALID", `“${item.title}”: ${error.message}`, { status: 400 }); }
      activities.push(item);
      activityByKey.set(item.key, item);
      const canonical = { kind: "activity.add", itemKey: item.key, branchId: item.branchId, value: visibleActivity(item) };
      operations.push(canonical);
      changes.push({ kind: "activity.add", title: item.title, targetKey: item.key, before: null, after: visibleActivity(item) });
      continue;
    }

    const item = activityByKey.get(operation.itemKey);
    if (!item) throw new AssistantFault("PROPOSAL_INVALID", `Không tìm thấy activity ${operation.itemKey}`, { status: 400 });

    if (operation.kind === "activity.remove") {
      if (anchorKeys.has(item.key)) throw new AssistantFault("PROPOSAL_INVALID", `Không thể xoá activity neo “${item.title}”`, { status: 400 });
      activityByKey.delete(item.key);
      activities.splice(activities.indexOf(item), 1);
      operations.push({ kind: "activity.remove", itemKey: item.key });
      changes.push({ kind: "activity.remove", title: item.title, targetKey: item.key, before: visibleActivity(item), after: null, destructive: true });
      continue;
    }

    if (operation.kind === "activity.setSources") {
      const before = visibleActivity(item);
      item.refs = resolveRefs(operation.refs);
      operations.push({ kind: "activity.setSources", itemKey: item.key, refs: item.refs });
      changes.push({ kind: "activity.update", title: item.title, targetKey: item.key, before, after: visibleActivity(item) });
      continue;
    }

    const before = visibleActivity(item);
    for (const field of activityFields) {
      if (Object.hasOwn(operation.set, field)) item[field] = operation.set[field];
    }
    if (Object.hasOwn(operation.set, "refs")) item.refs = resolveRefs(operation.set.refs);
    try { validateActivityInterval(item, { trip: snapshot.trip }); }
    catch (error) { throw new AssistantFault("PROPOSAL_INVALID", `“${item.title}”: ${error.message}`, { status: 400 }); }
    const set = Object.fromEntries(Object.keys(operation.set).map((field) => [field, field === "refs" ? item.refs : item[field]]));
    operations.push({ kind: "activity.update", itemKey: item.key, set });
    changes.push({ kind: "activity.update", title: item.title, targetKey: item.key, before, after: visibleActivity(item) });
  }

  try { assertTimeline(snapshot, activities); }
  catch (error) { throw new AssistantFault("PROPOSAL_INVALID", error.message, { status: 400 }); }

  return {
    operations,
    preview: {
      summary: `${changes.length} thay đổi được đề xuất`,
      changes,
      warnings: changes.some((change) => change.destructive)
        ? ["Đề xuất có xoá activity. Góp ý gắn với activity sẽ được giữ lại ở cấp chuyến đi."]
        : [],
    },
  };
}
