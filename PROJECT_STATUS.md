# VCHRI Planner Status

Last updated: April 22, 2026
Latest pushed commit before this feature batch: `f16cff3`

## Current Product Shape

The planner is now a single-bucket `VCHRI` task and notes tool with a separate home dashboard and planner workspace.

Current major features:
- Daily planner with `Today`, `Due soon`, `Upcoming`, `Overdue`, `Done`, and `Archived` views
- Quick add with natural-language parsing like `Call Sarah tomorrow 3pm`
- Recurring tasks
- Top priorities / pinned tasks
- Recently edited sort
- Compact and expanded density modes
- Keyboard shortcuts: `n`, `/`, `Esc`
- Archive / restore flow for tasks
- Weekly review screen
- Subtasks with progress and inline toggling
- Undo actions for completion, archive, delete, snooze, and task edits
- Richer note workflow:
  - inline note preview
  - inline expand/collapse
  - note search/filtering
  - note templates
  - checklist toggling inside notes
  - note timestamps
  - note highlight lines with `!! `
- Reminder workflow:
  - service-worker notifications
  - scheduled notifications on browsers that support them
  - fallback reminders while the planner stays open
  - reminder bell panel with upcoming reminders
  - `Due soon` reminder-focused view
  - in-app reminder cards with snooze actions

## Important Reminder Behavior

Reminders are stronger now, but still browser-limited.

What that means:
- If the browser supports scheduled notifications, reminders can fire in the background while the browser is running.
- If scheduled notifications are not supported, reminders fall back to the existing tab-open reminder behavior.
- Notifications now go through the service worker, so notification clicks can jump back into the planner.
- If notifications are blocked, the app falls back to an in-app reminder card / toast.
- Full push-style delivery with the browser fully quit is still not available in this repo yet.

Current snooze options:
- 10 minutes
- 30 minutes
- tomorrow

Reminder polling runs every 30 seconds, so alerts may be slightly late.

## File Map

- [index.html](/tmp/vchri-planner-review/index.html:1)
  Home dashboard landing page with quick add, focus tiles, reminders, and weekly stats
- [planner.html](/tmp/vchri-planner-review/planner.html:1)
  Planner workspace structure, toolbar, modals, reminder panel shell, archive view
- [review.html](/tmp/vchri-planner-review/review.html:1)
  Weekly review screen with completion, carry-forward, archive, and notes activity sections
- [home.css](/tmp/vchri-planner-review/home.css:1)
  Home dashboard layout and tile styling
- [review.css](/tmp/vchri-planner-review/review.css:1)
  Weekly review page styling
- [styles.css](/tmp/vchri-planner-review/styles.css:1)
  Shared styling, planner layout, responsive behavior, reminder panel/alert UI, undo bar, archive/subtask styles
- [manifest.webmanifest](/tmp/vchri-planner-review/manifest.webmanifest:1)
  Install metadata for the planner web app
- [sw.js](/tmp/vchri-planner-review/sw.js:1)
  Service worker for offline shell caching and notification click handling
- [scripts/core.js](/tmp/vchri-planner-review/scripts/core.js:1)
  Shared constants, helpers, parsing, state, undo, subtasks, reminder scheduling helpers
- [scripts/data.js](/tmp/vchri-planner-review/scripts/data.js:1)
  Firestore reads/writes, recurring task creation, archive/subtask actions, reminder firing/snooze logic
- [scripts/render.js](/tmp/vchri-planner-review/scripts/render.js:1)
  View calculations, task/archive rendering, reminder panel rendering, alert rendering
- [scripts/features.js](/tmp/vchri-planner-review/scripts/features.js:1)
  Edit modal, task edit save flow, import/export, density/view mode helpers
- [scripts/home.js](/tmp/vchri-planner-review/scripts/home.js:1)
  Home dashboard rendering, quick add, tiles, and navigation into the planner
- [scripts/main.js](/tmp/vchri-planner-review/scripts/main.js:1)
  Event listeners, shortcuts, quick add wiring, archive/subtask interactions, panel interactions
- [scripts/review.js](/tmp/vchri-planner-review/scripts/review.js:1)
  Weekly review rendering and week navigation

## What Changed Most Recently

Current feature batch:
- Added archive mode and restore flow
- Added weekly review page
- Added subtasks with progress tracking
- Added undo actions for major task changes
- Added service worker + manifest support for stronger browser reminders

## Known Limitations / Watchouts

- No auth/user isolation yet. Firestore is still being accessed directly from the client.
- Scheduled notifications still depend on browser support. Fully push-driven reminders with the browser quit are not in place yet.
- The natural-language parser is intentionally lightweight:
  - good for `today`, `tomorrow`, weekdays, and common times like `3pm`
  - not a full NLP parser
- No automated tests yet.
- Import is still pretty basic and could use validation / duplicate protection later.

## Good Next Steps

If we keep improving this, the strongest next options are:

1. Harden data handling
- safer import behavior
- validation
- duplicate protection

2. Add lightweight tests
- quick-entry parsing
- due-soon filtering
- recurring task generation
- note checklist toggling
- subtask parsing / progress
- weekly review summaries

3. Keep polishing workflow
- better reminder history / inbox behavior
- smarter quick entry
- richer archive filters
- review exports or printable weekly summaries

## Quick Restart Tomorrow

If picking this up again:

1. Open the deployed site and test:
- natural-language quick add
- due-soon view
- reminder bell panel
- snooze buttons
- archive / restore
- subtasks in the edit modal and on task cards
- weekly review navigation

2. If reminders feel weak, the next decision is whether to:
- accept browser-scheduled reminders as the ceiling here, or
- invest in a real push/background delivery approach

3. If we want a safer codebase next, add a tiny test layer around the parsing and reminder helpers.
