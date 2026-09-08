# UI styling and interaction ownership

The frontend uses CSS Modules for feature styling and Radix Dialog for modal behavior. The Living Transit Atlas design, native form controls, routing, state models, and API contracts remain application-owned.

## Why this combination

The app already used CSS custom properties and CSS Modules in the original `/v1` assistant. Extending that approach preserves the precise route geometry without translating it into utility classes or overriding a component kit's theme. Radix's controlled dialog and composition APIs replace repeated focus traps and document-level Escape handlers while letting each feature retain its HTML and CSS. The initial dialog pilot was compared against screenshots captured before the migration at all three canonical viewports.

Base UI was the closest alternative. It offers the same unstyled approach, but the Radix pilot satisfied the required composition and dismissal behavior. Tailwind/shadcn would add another styling workflow and require adapting supplied styles; Mantine's larger styled catalog did not address the current app's primary maintenance problem. No second interaction library is needed.

## Where changes belong

- `src/styles/foundation.css`: shared palette, fonts, reset, focus, shell defaults, and animation tokens. The integrated assistant aliases shared palette values and retains its darker error red.
- `src/styles/*.module.css`: navigation, tracker, contributions, admin shell, schedule editor, invitation management, and trip requests. Responsive rules live with their owning feature.
- `components/*.module.css`: invitation sheet, confirmation, and notification appearance, including their responsive states.
- `components/ui/Button`: primary, ghost, and danger button styling. It forwards native props, including `type`, `disabled`, event handlers, and React 19 refs. It deliberately preserves native default submission behavior.
- `components/ui/Footer`: the explicit defaults previously applied to every `footer` element. Low-specificity defaults let feature rules override them regardless of import order.
- `components/ui/Dialog`: controlled modal behavior, portal, focus containment/restoration, background accessibility isolation, and pending dismissal veto. Features provide one ref-capable element as content, a `DialogTitle`, and their own styles. Use `DialogDescription` when descriptive content is provided.

The global entry point contains only foundation, shared feedback/animation definitions, and remaining cross-feature shell rules. Do not add feature styling there.

## Compatibility during incremental adoption

Migrated classes use CSS Modules' `composes: original-name from global` syntax. This retains existing DOM geometry/test hooks while declarations target local classes. `:global(...)` inside a local selector explicitly identifies a state or a cross-feature hook. It does not make the whole module global.

VS Code reads `.vscode/css-custom-data.json` through the workspace `css.customData` setting to recognize `composes`. Standard CSS validation remains enabled for other unknown properties.

Keep those hooks until all DOM queries, feature selectors, and E2E tests using them have migrated together. New components can use local classes directly. Do not depend on one module loading after another to win an equal-specificity conflict; express the actual relationship in the selector or pass a variant to the shared component.

The account disclosure retains link/button semantics and native Tab navigation. Native dates, times, selects, and details/summary controls remain native. The notification panel retains its measured desktop anchor and mobile composition; Radix owns its modal behavior, not its position calculation. Navigation from notifications suppresses modal focus return so the destination contribution can receive focus.

Confirmation and invitation dialogs veto Escape/backdrop dismissal while pending. The contribution composer and discard prompt retain their existing dismissal policy. Async action errors leave confirmation content mounted for retry. Keep these policies explicit rather than relying on library defaults.

## Verification and future changes

Run `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:e2e`, and `pnpm run build`. The responsive audit covers nine public/admin surfaces at 320×760, 1440×900, and 1920×1080. Feature tests cover expanded branches, schedule editing, permissions, draft restoration, and notification navigation.

Dialog behavior lives in the feature tests: `invitation-owner.spec.mjs` covers draft restoration, focus wrapping, and Escape; `notifications.spec.mjs` covers dismissal and focus restoration; `comment-permissions.spec.mjs` covers confirmation focus, pending dismissal, and error recovery. `maintenance-ui.spec.mjs` checks activity-description typography and alignment at all three canonical viewports. Migration-only screenshot baselines were retired after verification, so intentional design changes do not require updating those reference images.

When changing shared styling, inspect the complete screenshot matrix, batch fixes, and run one confirmation pass. Use real navigation in a production build to check CSS chunk ordering as well as development Fast Refresh. Keep future behavior changes separate from style moves, and keep feature components independent of Radix imports outside the shared UI adapter.

Management reads trips and itineraries from authoritative storage, so it does not open a cached trip deleted by another process. Public links check authoritative storage when an explicitly requested trip is absent from the cached list. Activity-specific browser checks use the isolated `itineraryTest` fixture instead of depending on the date-selected default trip. Empty trips retain navigation, invitations, notes, sources and saved places, with their own regression coverage; clearing generated caches is not a substitute for these checks.
