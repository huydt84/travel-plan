# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are registered groups of friends preparing for and following a private itinerary together. Every trip has exactly one Leader; its Members can follow the schedule, choose branches, and contribute notes.

## Product Purpose

The product makes a shared trip plan useful before departure and during the trip itself. Before the trip, the group can understand the sequence, timing, locations, and sources and contribute notes. During the trip, everyone can immediately see what is happening now, what comes next, and how the day is progressing.

Success means the group can coordinate without repeatedly asking where to go or what comes next, while the trip Leader can update the plan without introducing ambiguity.

## Positioning

Unlike a generic itinerary document, the product turns a schedule into a live, time-aware companion: it identifies the current activity, counts down to the next transition, preserves source citations, and keeps participant suggestions attached to the relevant part of the day.

## Operating Context

The member tracker is used on phones while moving through Japan and on larger screens while planning. Signed-out visitors see only an access screen. Leaders use `/trips/manage`; Admin and Owner use `/admin/trips` for global oversight.

## Capabilities and Constraints

- Multiple trips can be selected from the tracker, filtered by the signed-in user's membership.
- Each trip has a date, timezone, location, cited sources, and an ordered schedule.
- The tracker derives before, active, gap, and completed states from Japan-local time and displays a live clock and countdown.
- Signed-in contributors can submit comments or suggested changes for an activity or the whole trip.
- Any authenticated user can create a trip and becomes its Leader. Leaders manage their trip and membership; Admin/Owner can override from the admin area.
- The interface and product copy are primarily Vietnamese.
- Existing data, authentication, URLs, roles, schedule semantics, citations, and live behavior must remain intact through the redesign.
- The private tracker, personal Leader workspace, and Admin/Owner area are all in redesign scope.

## Evidence on Hand

The repository contains working member and admin interfaces, production data access through Neon Postgres, trip-import tooling, authentication and authorization, real itinerary content, citations, suggestions, and responsive behavior. No testimonials, commercial claims, or formal brand assets are present and none should be fabricated.

## Product Principles

- Make “now” and “next” unmistakable at a glance.
- Support calm preparation and fast in-motion decisions with the same source of truth.
- Keep timing, provenance, and participant input attached to the itinerary context where they matter.
- Preserve Admin/Owner oversight while keeping day-to-day ownership with each trip's Leader.
- Design for interrupted attention and one-handed mobile use without diminishing desktop planning.

## Accessibility & Inclusion

Maintain semantic structure, keyboard access, visible focus, reduced-motion support, readable contrast, and responsive layouts. Time and status must never be communicated by color alone.
