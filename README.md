# Tibia Daily — Kanda v3

Updates the existing **free** Discord webhook + GitHub Actions automation.
No NabBot Premium required.

## Update an existing repository

Replace the following files in the GitHub repository's `main` branch:

- `daily.mjs`
- `package.json`
- `.github/workflows/daily.yml`

Add `test/parsers.test.mjs`.
Your existing `DISCORD_WEBHOOK_URL` repository secret stays the same.

Then go to **Actions → Tibia Daily - Kanda → Run workflow**.
Read the "Post Tibia Daily" step for actual fetch errors. Optional parser tests can be run with `npm test` after installing dependencies locally.

## Behavior

- World: **Kanda**
- Scheduled every day at **13:15 Europe/Warsaw**, after regular Tibia server save.
- **Today's boosts**: prefers Tibia.com's `#Monster` and `#Boss` data. If Tibia.com blocks requests, falls back to TibiaData and **explicitly identifies the values as cached/unverified in the footer**. Requesting with no-cache cannot force the upstream CDN to update. The correct values are not guaranteed when the source has not updated.
- **Ichgahal**: uses only the `last_day_killed` statistic, **not** today's partial count.
- **Rashid**: uses the game's server day, not local midnight.
- **Dream Scar**: community-maintained Kanda table; only reports a name when the wiki says it matches today's weekday. No official API guarantees this.
- **Tibiadrome**: rotation number and next reset (not randomly assigned modifiers).
- **Events**: tries official Tibia calendar first; if blocked, tries TibiaGG's dated 2026 event table. If blocked as well, it uses **a small, explicitly dated November/December 2026 snapshot**. The snapshot does not claim to track future announcements. After the snapshot expires, events require working live sources.
- Events use start-inclusive, end-exclusive Tibia server-save dates. Displayed end dates indicate the **server save** at which an event ends.

## Source limitations

The current request environment cannot reach these live pages, so although the JavaScript has been syntax-checked, live behavior must be verified in GitHub Actions. The integration logs will explicitly show 403, 429, parsing, or network errors.

If sources continue blocking GitHub-hosted runners, dynamic live event scraping cannot be guaranteed; use a permitted source that exposes event JSON (or maintain a small calendar data file) instead of relying on Tibia.com's HTML.

## Manual test

Use **Actions → Tibia Daily - Kanda → Run workflow**. Keep the webhook private.
