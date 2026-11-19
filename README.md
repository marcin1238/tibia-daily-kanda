# Tibia Daily — Kanda (v2)

A free GitHub Actions job that posts a daily Discord embed for **Kanda** at **13:15 Europe/Warsaw time**.

## Features

- Current-day boosted creature/boss: attempts to read the **official Tibia.com page first**, then falls back to TibiaData v5. The fallback may be stale; the embed footer identifies the source.
- Rashid's current city (Polish weekday).
- Ichgahal kills on Kanda from TibiaData's `last_day_killed` statistic (**previous reported day only**, not a rolling 24 hours).
- Dream Scar/Dream Courts boss for Kanda from a **community-maintained world table**. If the community page is stale or inaccessible, shows *Unverified for Kanda today*, not a guessed boss.
- Tibiadrome rotation number, next scheduled rotation reset, days/hours remaining. Modifiers are randomly selected and cannot be reliably predicted from dates.
- Actual active and upcoming event names/descriptions/dates parsed from the **official Tibia event calendar**, covering the current and next month, looking up to 28 days ahead.

## Update your existing GitHub repository

1. Replace the contents of the existing `daily.mjs` with this version.
2. Add the new `package.json` file at the repository root.
3. Replace `.github/workflows/daily.yml` with the new workflow.
4. **Keep your existing** repository secret `DISCORD_WEBHOOK_URL`. No changes or new secrets are needed.
5. Commit your changes on the default branch (`main`).
6. Open **Actions → Tibia Daily - Kanda → Run workflow** to test immediately.
7. Check the workflow logs and the message in `#tibia-daily`.

If you prefer the previous 12:15 schedule, change `cron: '15 13 * * *'` to `cron: '15 12 * * *'`. The later schedule gives post-server-save web caches more time to refresh.

### Important limitations

- TibiaData and Tibia.com can cache data. The official site is preferred, but you should verify the first day's boosted names against the Tibia client. No generic API can guarantee freshness if its upstream site is stale.
- The official Tibia event calendar is HTML, not a TibiaData JSON endpoint. Its markup can change, and Tibia.com can temporarily block automated requests. In either case, events show *Unavailable* and the logs explain why. No fabricated event names are posted.
- Fandom's Dream Scar table is community-maintained, occasionally stale or blocked, and some worlds get extra server saves. An unavailable entry is explicitly marked as unverified.
- The Tibiadrome end date is computed from the confirmed rotation #140 (Nov 11–25, 2026); should CipSoft alter its 14-day schedule, update the anchor in `drome()`.
- GitHub Actions schedules may be delayed. Public repositories with standard runners have no Actions minutes charge; see GitHub's current billing terms for other repository configurations.

### Source references

- TibiaData: https://docs.tibiadata.com/
- Official events: https://www.tibia.com/news/?subtopic=eventcalendar
- Dream Scar: https://tibia.fandom.com/wiki/Dream_Scar/Boss_of_the_Day
- Tibiadrome rotations: https://www.tibiaxplorer.com/tibiadrome
