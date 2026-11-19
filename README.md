# Tibia Daily — Kanda

Automatically posts boosted creature, boosted boss, Ichgahal kills on Kanda (previous reported day), Rashid and Tibia's event-calendar link to Discord at **12:15 Europe/Warsaw time**, every day.

## Setup

1. In Discord, create a `#tibia-daily` text channel and a webhook pointing to it (Server Settings → Integrations → Webhooks). Copy the webhook URL.
2. Create a public GitHub repository named `tibia-daily-kanda`, with no starter README.
3. Upload the extracted files from this ZIP, preserving the `.github/workflows/daily.yml` path. Commit to the default `main` branch.
4. In the GitHub repository go to Settings → Secrets and variables → Actions → New repository secret:
   - Name: `DISCORD_WEBHOOK_URL`
   - Value: the Discord webhook URL
5. Go to Actions → Tibia Daily - Kanda → Run workflow. Check the Actions logs and the Discord channel.
6. No further action is needed. Scheduled GitHub Actions can occasionally be delayed.

If Ichgahal is absent from Kanda's published kill statistics, the message will show 'Unavailable (not listed)' rather than falsely claiming zero kills.

The Events field links to Tibia's official calendar; it does not yet parse individual event names.

Do not commit your Discord webhook URL into the repository. Keep it in the GitHub secret.

API reference: https://docs.tibiadata.com/
Billing: https://docs.github.com/en/actions/concepts/billing-and-usage
