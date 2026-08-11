const sameEmail = (left, right) => (
  typeof left === "string"
  && typeof right === "string"
  && left.toLowerCase() === right.toLowerCase()
);

export function canManageSuggestion(viewer, suggestion) {
  if (!viewer || !suggestion) return false;
  if (viewer.isOwner) return true;
  return suggestion.kind === "comment" && sameEmail(viewer.email, suggestion.author_email);
}

export function canDeleteSuggestion(viewer, suggestion) {
  if (!viewer || !suggestion) return false;
  return viewer.isOwner || sameEmail(viewer.email, suggestion.author_email);
}

export function canSetSuggestionStatus(viewer, suggestion, status) {
  if (!canManageSuggestion(viewer, suggestion)) return false;
  return viewer.isOwner || status === "open" || status === "resolved";
}
