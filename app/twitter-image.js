import { renderSocialPreview, socialPreviewAlt, socialPreviewSize } from "../lib/social-preview";

export const alt = socialPreviewAlt;
export const size = socialPreviewSize;
export const contentType = "image/png";

export default function TwitterImage() {
  return renderSocialPreview();
}
