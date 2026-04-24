# Reminder Functions

This folder holds the Firebase Cloud Functions side of planner reminders.

## What it does

- Reads due `reminder_jobs`
- Sends Firebase Cloud Messaging web push notifications to enabled `push_registrations`
- Marks reminder jobs as `sent`, `failed`, or `cancelled`
- Mirrors successful sends back onto `planner_tasks` by setting `reminderFired`

## Before deploy

1. Install dependencies in `functions/`
2. Deploy the function with Firebase Functions
3. Set a web push VAPID key for the frontend by exposing `window.PLANNER_PUSH_CONFIG = { vapidKey: "..." }` before `scripts/core.js` loads

Without a VAPID key, the planner will stay in `Fallback only` mode on the client.
