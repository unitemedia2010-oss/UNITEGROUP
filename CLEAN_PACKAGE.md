# Unite HR Portal clean package

This folder is the cleaned runtime package for Unite HR Portal V40.1.

## Included

- Web app entry files: `index.html`, `portal.html`, `admin.html`, `employee.html`, `change-password.html`.
- Runtime CSS/JS referenced by the app.
- PWA files: `manifest.webmanifest`, `sw.js`, icons.
- Supabase SQL setup and current Edge Functions.
- Google Apps Script source used by the integration.
- Python document worker source and helper scripts.

## Intentionally excluded

- Preview pages: `preview-v*.html`.
- Historical docs/changelogs/validation notes.
- Python runtime artifacts: `.venv`, `__pycache__`, `logs`, `worker.lock`, `worker-state.json`.
- Local secrets: `python-worker/.env`, `credentials.json`, `token.json`.
- One-off cleanup script: `supabase/disable-hourly-notification-reminders-v38.sql`.

## Worker setup notes

To run the worker from this clean package:

1. Copy or recreate `python-worker/.env` from `python-worker/.env.example`.
2. Put Google OAuth `credentials.json` in `python-worker/`.
3. Run `python-worker/install-worker.ps1`.
4. Authorize once to generate `token.json`.
5. Run `python-worker/register-worker-task.ps1` as Administrator if the Media PC should keep scanning automatically.

Secrets were not copied here on purpose.
