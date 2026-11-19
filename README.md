# Kanda deaths — webhook add-on

Add these two files **to your existing `tibia-daily-kanda` repository**:

- `deaths.mjs` at the repository root.
- `.github/workflows/deaths.yml` at the stated nested path.

Your existing `package.json` (from the daily v2/v3 project) should already contain a dependency on `cheerio`. If not, add `"cheerio": "1.1.2"` to the `dependencies` object.

In Discord create a different channel `#kanda-deaths` and go to **Server Settings → Integrations → Webhooks → New Webhook**. Create a webhook, select the new channel, and copy its URL.

In GitHub, open your existing repository → **Settings → Secrets and variables → Actions → New repository secret**. Add `DISCORD_DEATHS_WEBHOOK_URL` with the URL from Discord. Keep the webhook secret.

GitHub repository → **Settings → Actions → General → Workflow permissions**: if necessary, select **Read and write permissions** for Actions, so the workflow can commit `.kanda-deaths-state.json` to the repository. Some repos are restricted by organization settings.

Commit the files to `main`, then go to **Actions → Kanda - Death Tracker → Run workflow**.

**First run:** creates `.kanda-deaths-state.json` as a baseline and sends **no historical deaths**. Wait for the next newly recorded death; it is checked approximately every 5 minutes. GitHub scheduling and source updates can cause additional delays.

The script reads `https://tibtr.com/deaths?world=Kanda`, which itself says characters are checked on different schedules. It does **not guarantee every death is collected**. This is not a direct official Tibia all-deaths API. Its public table may change or requests may be blocked. It currently shows around 50 recent deaths. After a prolonged outage or intense activity some events may be missed. The source displays **America/New_York** time, and the Discord embed labels that explicitly.

GitHub Actions on a standard runner in a **public repository** is free under GitHub's published billing terms. In a **private repository**, a 5-minute schedule can rapidly exhaust monthly included minutes. Public-repository schedules can be disabled after 60 days with no repository activity; checkpoint commits generally create activity when new deaths occur, but monitor the workflow.

The checkpoint JSON contains only public Tibia death metadata (no webhook secret). Your daily Tibia summaries are unaffected.

**Alternative (recommended for the most complete free world-wide tracking):** use Lemon Bot's `/setup world` for Kanda, which includes a free `#deaths` feed without writing this code. https://tibialemon.com/ . It's a bot, not a webhook.
