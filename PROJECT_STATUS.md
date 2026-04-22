# VCHRI Planner Status

Last updated: April 22, 2026
Latest pushed commit before this redesign batch: `8676029`

## Current Product Shape

The planner is now a single-bucket `VCHRI` task and notes tool with a separate home dashboard and planner workspace.

Current major features:
- Daily planner with `Today`, `Due soon`, `Upcoming`, `Overdue`, and `Done` views
- Quick add with natural-language parsing like `Call Sarah tomorrow 3pm`
- Recurring tasks
- Top priorities / pinned tasks
- Recently edited sort
- Compact and expanded density modes
- Keyboard shortcuts: `n`, `/`, `Esc`
- Richer note workflow:
  - inline note preview
  - inline expand/collapse
  - note search/filtering
  - note templates
  - checklist toggling inside notes
  - note timestamps
  - note highlight lines with `!! `
- Reminder workflow:
  - browser reminders while the tab is open
  - reminder bell panel with upcoming reminders
  - `Due soon` reminder-focused view
  - in-app reminder cards with snooze actions

## Important Reminder Behavior

Reminders work, but they are **tab-open reminders**, not true background push notifications.

What that means:
- If the planner page is open, reminders can fire.
- If notifications are allowed, the browser shows a notification.
- If notifications are blocked, the app falls back to an in-app reminder card / toast.
- If the tab is closed, the browser is quit, or the machine is asleep, reminders are not reliable.

Current snooze options:
- 10 minutes
- 30 minutes
- tomorrow

Reminder polling runs every 30 seconds, so alerts may be slightly late.

## File Map

- [index.html](/tmp/vchri-planner-review/index.html:1)
  Home dashboard landing page with quick add, focus tiles, reminders, and weekly stats
- [planner.html](/tmp/vchri-planner-review/planner.html:1)
  Planner workspace structure, toolbar, modals, reminder panel shell
- [home.css](/tmp/vchri-planner-review/home.css:1)
  Home dashboard layout and tile styling
- [styles.css](/tmp/vchri-planner-review/styles.css:1)
  Shared styling, planner layout, responsive behavior, reminder panel/alert UI
- [scripts/core.js](/tmp/vchri-planner-review/scripts/core.js:1)
  Shared constants, helpers, parsing, state, note utilities
- [scripts/data.js](/tmp/vchri-planner-review/scripts/data.js:1)
  Firestore reads/writes, recurring task creation, reminder firing/snooze logic
- [scripts/render.js](/tmp/vchri-planner-review/scripts/render.js:1)
  View calculations, task rendering, reminder panel rendering, alert rendering
- [scripts/features.js](/tmp/vchri-planner-review/scripts/features.js:1)
  Edit modal, import/export, density/view mode helpers
- [scripts/home.js](/tmp/vchri-planner-review/scripts/home.js:1)
  Home dashboard rendering, quick add, tiles, and navigation into the planner
- [scripts/main.js](/tmp/vchri-planner-review/scripts/main.js:1)
  Event listeners, shortcuts, quick add wiring, panel interactions

## What Changed Most Recently

Current redesign batch:
- Split the experience into a home dashboard at `index.html` and the full planner at `planner.html`
- Added home-specific styling in `home.css`
- Added home dashboard behavior in `scripts/home.js`
- Added planner top navigation so the two pages feel connected

## Known Limitations / Watchouts

- No auth/user isolation yet. Firestore is still being accessed directly from the client.
- Reminders are not background-reliable yet.
- The natural-language parser is intentionally lightweight:
  - good for `today`, `tomorrow`, weekdays, and common times like `3pm`
  - not a full NLP parser
- No automated tests yet.
- Import is still pretty basic and could use validation / duplicate protection later.

## Good Next Steps

If we keep improving this, the strongest next options are:

1. Make reminders truly reliable
- service worker / push style reminders
- or calendar/email integration

2. Harden data handling
- safer import behavior
- validation
- duplicate protection

3. Add lightweight tests
- quick-entry parsing
- due-soon filtering
- recurring task generation
- note checklist toggling

4. Keep polishing workflow
- better reminder history / inbox behavior
- smarter quick entry
- archive mode
- weekly review summary

## Quick Restart Tomorrow

If picking this up again:

1. Open the deployed site and test:
- natural-language quick add
- due-soon view
- reminder bell panel
- snooze buttons

2. If reminders feel weak, the next decision is whether to:
- keep them as tab-open reminders, or
- invest in a real background reminder approach

3. If we want a safer codebase next, add a tiny test layer around the parsing and reminder helpers.
