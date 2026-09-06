import { createContextService } from "./context.mjs";
import { createGoogleResearchAdapters } from "./research.mjs";
import { resolveAgenticV1Config } from "./config.mjs";
export function defaultContextService() {
  const config = resolveAgenticV1Config();
  return createContextService({ research: createGoogleResearchAdapters(config), maxChars: config.contextMaxChars });
}
