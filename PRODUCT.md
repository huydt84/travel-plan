# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are a small group of friends preparing for and following a day-trip itinerary together. The trip owner maintains the plan; signed-in contributors can add comments and proposed changes.

## Product Purpose

The product makes a shared trip plan useful before departure and during the trip itself. Before the trip, the group can understand the sequence, timing, locations, and sources and contribute notes. During the trip, everyone can immediately see what is happening now, what comes next, and how the day is progressing.

Success means the group can coordinate without repeatedly asking where to go or what comes next, while the owner can update the plan without introducing ambiguity.

## Positioning

Unlike a generic itinerary document, the product turns a schedule into a live, time-aware companion: it identifies the current activity, counts down to the next transition, preserves source citations, and keeps participant suggestions attached to the relevant part of the day.

## Operating Context

The public tracker is used on phones while moving through Japan and on larger screens while planning. Users may be outdoors, in transit, under time pressure, or working with intermittent attention. The owner uses a separate administration surface to manage trips, schedule entries, and contributor suggestions.

## Capabilities and Constraints

- Multiple trips can be selected from the public tracker.
- Each trip has a date, timezone, location, cited sources, and an ordered schedule.
- The tracker derives before, active, gap, and completed states from Japan-local time and displays a live clock and countdown.
- Signed-in contributors can submit comments or suggested changes for an activity or the whole trip.
- Only the owner can create, edit, and delete trips and schedule entries or moderate suggestions.
- The interface and product copy are primarily Vietnamese.
- Existing data, authentication, URLs, roles, schedule semantics, citations, and live behavior must remain intact through the redesign.
- The public tracker and the owner administration area are both in redesign scope.

## Evidence on Hand

The repository contains working public and admin interfaces, production data access through Neon Postgres, trip-import tooling, authentication and authorization, real itinerary content, citations, suggestions, and responsive behavior. No testimonials, commercial claims, or formal brand assets are present and none should be fabricated.

## Product Principles

- Make “now” and “next” unmistakable at a glance.
- Support calm preparation and fast in-motion decisions with the same source of truth.
- Keep timing, provenance, and participant input attached to the itinerary context where they matter.
- Preserve owner control while making contribution lightweight for the group.
- Design for interrupted attention and one-handed mobile use without diminishing desktop planning.

## Accessibility & Inclusion

Maintain semantic structure, keyboard access, visible focus, reduced-motion support, readable contrast, and responsive layouts. Time and status must never be communicated by color alone.
