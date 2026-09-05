---
name: "Lịch trình chuyến đi"
description: "A live trip day and its integrated planning companion in one transit-atlas world."
colors:
  navy: "#10243d"
  navy-soft: "#32445a"
  paper: "#f4f1e8"
  paper-bright: "#fffdf7"
  paper-deep: "#e7e1d3"
  green: "#008f68"
  green-dark: "#006e52"
  green-soft: "#d7ebe2"
  yellow: "#ffbf3f"
  yellow-soft: "#fff0bf"
  red: "#d9473f"
  red-soft: "#f9ded9"
  line: "#a8aa9f"
  muted: "#586473"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(44px, 6vw, 80px)"
    fontWeight: 700
    lineHeight: 0.86
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(35px, 5vw, 56px)"
    fontWeight: 700
    lineHeight: 0.95
  title:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.05
  body:
    fontFamily: "Noto Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.62
  conversation-body:
    fontFamily: "Noto Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  conversation-response:
    fontFamily: "Noto Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.75
  conversation-response-compact:
    fontFamily: "Noto Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.75
  assistant-title:
    fontFamily: "Noto Sans, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
  assistant-title-compact:
    fontFamily: "Noto Sans, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  assistant-welcome:
    fontFamily: "Noto Sans, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.35
  assistant-drawer-title:
    fontFamily: "Noto Sans, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.35
  assistant-subtitle:
    fontFamily: "Noto Sans, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.4
  assistant-entry:
    fontFamily: "Noto Sans, system-ui, sans-serif"
    fontSize: "16px"
    lineHeight: 1.5
  assistant-detail:
    fontFamily: "Noto Sans, system-ui, sans-serif"
    fontSize: "14px"
  label:
    fontFamily: "Noto Sans, system-ui, sans-serif"
    fontSize: "9px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.08em"
rounded:
  field: "3px"
  control: "4px"
  composer: "8px"
  round: "50%"
spacing:
  micro: "7px"
  control: "10px"
  compact: "14px"
  panel: "18px"
  section: "26px"
  shell: "40px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.paper-bright}"
    typography: "{typography.label}"
    rounded: "{rounded.field}"
    padding: "10px 14px"
  button-primary-hover:
    backgroundColor: "{colors.green-dark}"
    textColor: "{colors.paper-bright}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.navy}"
    typography: "{typography.label}"
    rounded: "{rounded.field}"
    padding: "10px 14px"
  button-ghost-hover:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.paper-bright}"
  button-danger:
    backgroundColor: "{colors.red-soft}"
    textColor: "{colors.red}"
    typography: "{typography.label}"
    rounded: "{rounded.field}"
    padding: "10px 14px"
  field:
    backgroundColor: "white"
    textColor: "{colors.navy}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "11px 12px"
  station-active:
    backgroundColor: "{colors.paper-bright}"
    textColor: "{colors.navy}"
    padding: "clamp(22px, 4vw, 42px)"
  conversation-user:
    backgroundColor: "{colors.green-soft}"
    textColor: "{colors.navy}"
    typography: "{typography.conversation-body}"
    rounded: "{rounded.control}"
    padding: "14px 18px"
  assistant-composer:
    backgroundColor: "{colors.paper-bright}"
    textColor: "{colors.navy}"
    typography: "{typography.assistant-entry}"
    rounded: "{rounded.composer}"
    padding: "8px"
  assistant-icon:
    backgroundColor: "transparent"
    textColor: "{colors.navy}"
    rounded: "{rounded.control}"
    width: "44px"
    height: "44px"
  next-fascia:
    backgroundColor: "{colors.yellow-soft}"
    textColor: "{colors.navy}"
    padding: "14px 18px 14px 42px"
---

# Design System: Lịch trình chuyến đi

## Overview

**Creative North Star: "The Living Transit Atlas"**

The interface treats a day trip as one piece of transit infrastructure. Every activity is a station on a continuous route, the current activity opens from that route as a foldout station board, the next activity is an attached transfer fascia, and contributions remain anchored to the stop or whole-day region they affect. The public tracker tells the whole-day/current/next/contribution story; the owner control room edits the same underlying line instead of becoming a visually unrelated dashboard.

The world is warm paper printed with navy station ink, route green, and transfer yellow. Compressed headings, tabular time, clipped enamel-like panels, timetable rules, and route-node geometry create authority without luxury styling. Density is intentional but calm: large status and time are readable under interrupted attention, while details and provenance remain available in place.

The integrated assistant extends this same world with a ruled reading column, a compact composer, and contextual inspection drawers. Its calmer conversational density preserves paper, ink, and route signals while giving long Vietnamese responses room to breathe.

**Key Characteristics:**

- One continuous route is the organizing geometry on every itinerary surface.
- Warm, lightly layered paper carries crisp railway-signage contrast.
- Route green means current, completed, progress, or constructive action; transfer yellow means next or pending attention.
- Compressed display type carries stations and time; neutral sans carries explanation and forms.
- Square, ruled, clipped construction replaces detached rounded travel cards.
- Public, owner, and assistant views share the same paper and timetable grammar at different reading densities.

## Colors

The palette is deliberately small and operational: navy establishes station authority, paper keeps long sessions warm, and state colors are reserved for route meaning.

### Primary

- **Route Green:** The main state and action color. Use it for the active rail, current nodes, progress, constructive primary actions, and activity-type pictograms.
- **Deep Route Green:** Use for green text on light fields and stronger hover states where the brighter route green would lose contrast.
- **Washed Route Green:** Use as an attached current-state field, editor field, or accepted comment field; it never floats independently of the route or editing context.

### Secondary

- **Transfer Yellow:** A rare signal for focus, selection, source interaction, and the next transfer.
- **Transfer Paper:** The quieter yellow field behind next-stop fascias and suggestions awaiting attention.

### Tertiary

- **Service Red:** Reserved for destructive actions, rejected states, and errors.
- **Service Red Paper:** The supporting field for error and destructive affordances; pair it with text and labels, never color alone.

### Neutral

- **Station Navy:** Primary ink, structural borders, dark information fields, and high-authority hover states.
- **Soft Station Navy:** Long-form detail copy and completed-state text.
- **Warm Paper:** The page field and route-node fill.
- **Bright Timetable Paper:** The high-contrast face of boards, panels, and editable surfaces.
- **Deep Paper:** Progress tracks, code chips, and loading skeletons.
- **Rail Grey:** Inactive rails, dividers, and row rules.
- **Muted Ink:** Metadata, units, secondary labels, and help text.

### Named Rules

**The State-Signal Rule.** Green communicates current/progress/constructive action, yellow communicates next/attention, and red communicates destructive/error; every state also carries text, geometry, or an icon.

**The Paper Majority Rule.** Warm and bright paper occupy most of the screen. Solid color fields are compact operational signals, not decoration.

## Typography

**Display Font:** Barlow Condensed (with Arial Narrow and sans-serif fallbacks)  
**Body Font:** Noto Sans (with system UI and sans-serif fallbacks)

**Character:** Barlow Condensed brings the urgency and space efficiency of platform signage; Noto Sans keeps Vietnamese detail, forms, and provenance quiet and legible. The contrast between them is part of the navigation system, not merely branding.

### Hierarchy

- **Display** (700, fluid 44–80px, 0.86 line-height): Active station names, primary countdowns, and the largest admin headings. Display text may wrap tightly but stays balanced and uppercase when it represents a station-board declaration.
- **Headline** (700, fluid 35–56px, 0.95 line-height): Major public sections and plan summaries.
- **Title** (600, 24px, 1.05 line-height): Timetable rows, editor sections, and compact station names.
- **Body** (400, 12px, 1.62 line-height): Existing compact itinerary detail and explanatory copy; this incumbent scale does not govern conversation prose.
- **Conversation:** The conversation-body role governs user messages and the workspace. Dedicated-page replies retain conversation-response sizing even at 320px; only companion replies use conversation-response-compact. Responses stay within 72ch. Assistant structure uses neutral sans throughout: assistant-title for the header, assistant-title-compact at container widths up to 600px, assistant-welcome for welcome and access headings, assistant-drawer-title for drawer headings, and assistant-subtitle for evidence and change headings. Composer entry uses assistant-entry; source and change body details use assistant-detail, with secondary drawer metadata at 12px. Headings inside Markdown remain neutral sans for continuous reading.
- **Label** (700, 9px, 0.08em letter-spacing): Types, statuses, control labels, and metadata. Uppercase is used for compact operational labels, not full paragraphs.
- **Timing:** All clocks, ranges, countdowns, and schedule columns use tabular numerals. Timing may scale to display size but remains in the condensed family.

### Named Rules

**The Platform Voice Rule.** Use condensed type for destinations, status, and time; use the neutral sans for explanation, provenance, authorship, form entry, and conversation structure.

**The Vietnamese Legibility Rule.** Never tighten Noto Sans body copy to mimic the condensed display face; preserve generous line-height and complete diacritics.

## Layout

The public shell is centered with a 1380px ceiling and 40px desktop gutters. A slim trip-control band sits above the main live board. At desktop widths the board is a true 30/70 Foldout Spine: a minimum 280px route overview on the left and the active station stage on the right, separated by a 2px seam. The active route segment crosses that seam into the station board; the relationship must remain physically visible. Lower sections narrow to 1120px and continue the same time/rail/content columns.

At 900px and below, the live board remains two-column but the route grows to 34% with a 245px minimum. The active station's countdown moves below the title, and the control band wraps its live clock into a full-width lower row. This is a compression state, not yet the mobile composition.

At 680px and below, the desktop live board disappears and the itinerary becomes one vertical route. The current stop's foldout is attached to the right of its node, with its next-stop strip attached inside the foldout. A fixed compact now/next dock provides one-handed recovery while the page scrolls. The admin control room changes from a 285px sticky trip rail plus content to a single column; trip selection becomes a horizontal rail, form grids become single-column, and row actions remain attached to their schedule item.

Spacing follows compact operational increments rather than airy marketing rhythm. Controls cluster around 7–18px gaps; panels use 18–40px padding; public section breaks may reach 58–76px where a new timetable region begins. Safe-area insets are honored at the top and bottom.

**The Attached-Seam Rule.** The current node, active rail, foldout, and next fascia must read as one connected object in the first viewport and on mobile.

**The Route-Persistence Rule.** Responsive adaptation may reflow or replace the desktop composition, but it may not turn itinerary stations into a stack of detached cards.

The assistant has one scrollable message column between a nonshrinking header/toolbar and composer. The message and composer content share a centered 760px reading column. At assistant container widths up to 600px, the title and window actions occupy the first header row; the trip picker, history, and new-conversation controls share the second row. Wider containers place conversation actions beside the title and give trip selection the second row. On the tracker, the companion sits beside the itinerary at viewport widths of 1200px and above. Its default width is 480px, or 600px from 1800px; a saved user preference overrides the default. The left edge resizes the companion from 360px to the smaller of 960px or viewport width minus 640px. The tracker gives up exactly the current panel width and responds to its remaining container width. At 1100px and below, its control band reflows, station title and countdown stack, and station type and padding compact. At 800px and below, the current station sits above the ruled route overview, whose list scrolls within 400px. These companion-scoped rules prevent overlap without changing the standalone tracker layout. Below 1200px, the companion becomes a full-screen dialog; the dedicated `/assistant` page uses the full viewport at every size. History, sources, and proposal review share an on-demand right-side drawer, capped at 600px and filling narrower screens. The current implementation supersedes the former `/v1` three-column workspace; conversation, evidence, and review are not permanent parallel columns.

**The Reading-First Rule.** Keep trip selection, history, and new conversation above the message column, the compact composer below it, and detailed evidence and proposal review in focus-restoring drawers. Preserve the first-viewport controls at 320px without squeezing the message type.

## Elevation & Depth

The system is flat by construction. There are no ambient card shadows. Depth comes from 1px timetable rules, 2px structural outlines, 6px inactive/completed rails, 10px active route segments, solid status fields, clipping, and the paper-to-bright-paper tonal shift. The only shadow-like treatments are functional: an inset ring inside completed nodes, a 3px translucent green field focus halo, the live-dot pulse, and the navy modal scrim with 4px backdrop blur.

The assistant inspection drawer uses a plain translucent navy scrim (`rgb(16 36 61 / .35)`) without added blur or a floating shadow; its fixed companion uses a single navy seam against the tracker.

### Named Rules

**The Infrastructure, Not Furniture Rule.** Establish hierarchy with line weight, attached geometry, and solid fields; never lift route sections into floating cards.

**The Functional Depth Rule.** Blur, glow, or shadow appears only for focus, live status, loading, or modal separation.

## Shapes

The default silhouette is square and architectural. Borders are usually 1px for timetable rules and 2px for structural enclosures. Small controls and fields use only 3–4px corner radii. Major surfaces use clipped corners rather than rounded rectangles: editors clip at 10px, current timeline panels at 12px, contribution panels and contribution composers at 14px, login boards at 16px, and the desktop active station at 18px with a route-facing notch. Next-stop fascias use directional polygon ends.

The assistant composer uses the scoped composer radius around one shared input-and-action frame; its other controls retain the small control radius. This exception supports conversational entry without changing itinerary panel geometry.

Circles are semantic and scarce: route nodes, live indicators, and user avatars only. Code-native line icons use rounded strokes, but their containers stay square.

**The Enamel Fascia Rule.** A clipped surface must behave like a sign attached to infrastructure; clipping is never applied as generic decoration.

**The Circle Permission Rule.** If an element is not a node, live dot, or avatar, it does not become circular or pill-shaped.

## Components

### Buttons

- **Shape:** Compact outlined or filled controls with gently eased 3px corners; public utility buttons may use 4px.
- **Primary:** Route-green fill, bright-paper text, 1px matching border, and compact 10px by 14px padding. Small admin actions reduce to 8px by 10px.
- **Hover / Focus:** Primary darkens to deep route green. Ghost controls invert to navy with bright-paper text. All controls inherit the global 3px transfer-yellow focus outline with 3px offset.
- **Danger:** Service-red text on service-red paper with a red outline; hover becomes solid red with white text.
- **Behavior:** Disabled saving controls reduce opacity and use a wait cursor. Button text names the operation or state; icon-only close controls retain an accessible label.

### Chips

- **Style:** Citation chips and suggestion statuses are tiny rectangular labels with a 1px semantic border, 3px corners, and bold 9px text.
- **State:** Citation chips invert to route green on hover. Rejected statuses use service red plus a red-paper field. Avoid free-floating decorative tags.

### Cards / Containers

- **Corner Style:** Large operating surfaces are square or polygon-clipped, never softly rounded.
- **Background:** Bright timetable paper is the normal panel face; green or yellow washes communicate an attached state.
- **Shadow Strategy:** Flat at rest; use structural rules and color fields as described in Elevation & Depth.
- **Border:** 2px navy for shells and major enclosures, 2px green for active/editing panels, 1px grey or navy for internal timetable rules.
- **Internal Padding:** 18–42px according to hierarchy and viewport.

### Inputs / Fields

- **Style:** White fill, 1px navy stroke, 3px corners, navy text, and 11px by 12px padding. Labels are compact and bold; help text uses muted ink.
- **Focus:** Stroke changes to route green and receives a 3px translucent green halo. The global yellow keyboard outline remains available.
- **Error / Disabled:** Errors use service-red text and an alert field with a red border. Busy states keep their content stable and communicate waiting in text, opacity, and cursor.

### Navigation

The trip-control band is one ruled strip containing product mark, trip selector, viewer actions, and JST clock. Desktop cells are separated by 1px navy rules. At compact widths the product wordmark may hide, while the icon, trip identity, auth action, and clock remain. The owner trip list is a vertical timetable rail on desktop and a horizontally scrollable selection rail on mobile; the active trip becomes a solid route-green field.

### Route Spine and Nodes

The route spine is the product's primary navigation and status component. Inactive rail is 6px rail grey, completed rail becomes 6px route green, and the current segment expands to 10px. Standard nodes are 16–17px circles; the current node grows to 24–25px with a 7px green ring. Completed nodes fill green and retain an inset paper ring. Every node is aligned with a time column and an attached station label.

### Active Station Foldout

The active station is the dominant operating panel. Its green status fascia, square activity pictogram, oversized destination, tabular time range, countdown, progress track, detail, citations, contribution action, and attached next transfer all live within one connected construction. Before, active, gap, and completed modes change factual text and route state without changing the component grammar.

### Next-Stop Fascia

The next stop is a directional yellow-paper strip with a navy label block, green type icon, condensed title, metadata, and arrow. It overlaps or sits inside the active foldout so "next" cannot be mistaken for a separate recommendation card. Hover inverts the strip to navy and turns supporting elements yellow.

### Timetable Rows

Public and owner rows share time/rail/content alignment, thin separators, condensed titles, type pictograms, and restrained body detail. The public current row opens into a clipped green-wash panel. Owner rows add edit/delete controls but keep the route node and time column intact. Suggestion moderation uses a compact metadata/copy/control grid beneath the same plan, not a separate application shell.

### Integrated Assistant

The trip launcher is a small outlined, deep-green action with a line-SVG conversation icon and a rectangular unread count. The dedicated page has separate Back and Thu nhỏ controls: Back returns to the trip with chat hidden; Thu nhỏ preserves the selected trip and conversation and opens chat beside the tracker (or full screen below 1200px). Mở rộng preserves that context when entering the dedicated page. User messages align right on washed green with 4px corners; assistant responses remain on the paper field. Authorship labels, spacing, and content distinguish the two speakers. Markdown links are underlined deep green; tables scroll within their own region, and long text wraps without widening the workspace.

The composer sits on the paper field with a single bright-paper frame enclosing both the labeled textarea and the bottom-right Send or Stop icon. It uses the assistant-composer and assistant-entry tokens, a thin muted rule, and a deep-green focus border. Entry starts at 48px and can grow up to 180px while the message region keeps its own scroll. Header, drawer-close, Send, and Stop icons use 44px controls, accessible names, and matching native title hints; citation targets retain a 44px minimum. The keyboard hint hides on small screens while the explicit-apply assurance remains visible. Busy states retain the question and show textual progress or interruption.

Welcome content preserves its Vietnamese wording with the assistant-welcome heading and quiet, left-aligned prompt rows. The access surface is a simple centered paper-field composition with the same heading role.

History uses ruled rows and a green wash for the selected conversation. Source and proposal actions attach to their response and open the shared drawer. Pending review uses transfer paper; applied results use washed green; conflicts, expiry, and destructive changes use service-red fields with text. Before/after content remains inspectable, and Apply stays explicit and visible near the drawer bottom. Dialogs restore focus on close. New content does not force the reader away from an older response; a recovery action appears when needed.

The desktop resize edge is a labeled, focusable vertical separator with current/minimum/maximum width exposed to assistive technology. A 12px pointer region straddles the navy seam, expanding to 44px for coarse pointers; a centered 4px by 44px grey grip becomes deep green on hover, focus, or drag. Keyboard focus has a yellow outline. Left/Right grow/shrink by 24px, or 80px with Shift; Home/End choose the bounds. Enter or double-click restores the responsive default, and Escape cancels an active drag. Accepted pointer and keyboard changes retain a best-effort local width preference.

### Motion and Live State

The live dot pulses on a 2.1-second ease-out cycle; countdown progress advances over 600ms with a fast-out, slow-arrive curve; loading skeletons alternate opacity over 1.2 seconds. The assistant running dot alternates opacity over 1.4 seconds with ease-in-out. Motion confirms liveness or state change and never gates content. Under `prefers-reduced-motion: reduce`, smooth scrolling, animation, and transition are disabled across elements and pseudo-elements.

## Do's and Don'ts

### Do:

- **Do** preserve the single connected route from overview through active station, next transfer, full schedule, and admin editing rows.
- **Do** make now and next identifiable through wording, rail weight, node geometry, icons, and color together.
- **Do** use tabular numerals for every clock, countdown, range, and schedule column.
- **Do** keep keyboard focus visibly transfer yellow and retain semantic lists, headings, time elements, labels, alerts, and accessible icon names.
- **Do** keep contribution notes attached to their station or to the explicitly labeled whole-trip contribution region.
- **Do** use code-native line SVG pictograms with consistent 1.8–2px rounded strokes.
- **Do** preserve a 320px minimum viewport, safe-area padding, one-handed mobile controls, and the reduced-motion override.
- **Do** use the intentional 15–16px conversation scale and keep sources and explicit proposal review reachable from each response.

### Don't:

- **Don't** introduce detached rounded itinerary cards, generic dashboard tiles, or a card grid; they contradict the route model.
- **Don't** add travel photography, ornamental illustration, emoji-first UI, glass effects, ambient drop shadows, glossy gradient fills, or plush pill controls. These are explicit non-goals for this world; the existing faint paper tonal wash and 25% fold guide remain material and structural.
- **Don't** use yellow as a broad brand fill or red as a general accent; both are reserved operational signals.
- **Don't** communicate before/current/gap/completed, suggestion status, or errors by color alone.
- **Don't** let the owner control room drift into a different SaaS design language; it edits the same timetable infrastructure.
- **Don't** hide citations, contribution context, or real schedule detail in pursuit of visual minimalism.
- **Don't** reuse compact itinerary metadata sizes for chat paragraphs or restore the obsolete three-column assistant layout.
