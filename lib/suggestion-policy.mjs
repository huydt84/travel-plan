const sameEmail = (left, right) => (
  typeof left === "string"
  && typeof right === "string"
  && left.toLowerCase() === right.toLowerCase()
);

const isAdmin = (viewer) => Boolean(viewer?.isAdmin || viewer?.isOwner);

export function canManageSuggestion(viewer, suggestion) {
  if (!viewer || !suggestion) return false;
  if (isAdmin(viewer)) return true;
  return suggestion.kind === "comment" && sameEmail(viewer.email, suggestion.author_email);
}

export function canDeleteSuggestion(viewer, suggestion) {
  if (!viewer || !suggestion) return false;
  return isAdmin(viewer) || sameEmail(viewer.email, suggestion.author_email);
}

export function canChangeSuggestionVisibility(viewer, suggestion) {
  if (!viewer || !suggestion) return false;
  return isAdmin(viewer) || sameEmail(viewer.email, suggestion.author_email);
}

export function canSetSuggestionStatus(viewer, suggestion, status) {
  if (!canManageSuggestion(viewer, suggestion)) return false;
  return isAdmin(viewer) || status === "open" || status === "resolved";
}
