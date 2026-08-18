export function resolveActiveItinerary(backbone = [], branchGroups = []) {
  const decorateSelectedBranch = (group) => {
    const selected = group?.branches.find((branch) => String(branch.id) === String(group.selectedBranchId))
      || group?.branches.find((branch) => branch.isDefault)
      || group?.branches[0];
    return (selected?.itinerary || []).map((item) => ({
      ...item,
      branchId: String(selected.id),
      branchGroupId: String(group.id),
      branchLabel: selected.label,
    }));
  };
  const startGroup = branchGroups.find((group) => group.anchorActivityId == null);
  const groupByAnchor = new Map(branchGroups
    .filter((group) => group.anchorActivityId != null)
    .map((group) => [String(group.anchorActivityId), group]));
  const sharedRoute = backbone.flatMap((activity) => {
    const group = groupByAnchor.get(String(activity.id));
    if (!group) return [activity];
    return [activity, ...decorateSelectedBranch(group)];
  });
  return [...decorateSelectedBranch(startGroup), ...sharedRoute];
}

export function nextBackboneActivity(backbone, anchorActivityId) {
  if (anchorActivityId == null) return backbone[0] || null;
  const index = backbone.findIndex((item) => String(item.id) === String(anchorActivityId));
  return index >= 0 ? backbone[index + 1] || null : null;
}

export function validateBranchTimeline({ anchor, rejoin, itinerary }) {
  let previousEnd = anchor?.end || null;
  for (const item of itinerary) {
    if (previousEnd && item.start < previousEnd) {
      throw new Error(`Hoạt động “${item.title}” bắt đầu trước khi hoạt động trước kết thúc`);
    }
    previousEnd = item.end;
  }
  if (rejoin && previousEnd > rejoin.start) {
    throw new Error(`Phương án kết thúc sau mốc hội nhập “${rejoin.title}”`);
  }
}

export function groupBranchesByAnchor(branchGroups = []) {
  return new Map(branchGroups
    .filter((group) => group.anchorActivityId != null)
    .map((group) => [String(group.anchorActivityId), group]));
}
