import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';

const WORLD = 'Kanda';
const SOURCE_URL = 'https://tibtr.com/deaths?world=Kanda';
const STATE_PATH = resolve(process.cwd(), '.kanda-deaths-state.json');
const WEBHOOK = process.env.DISCORD_DEATHS_WEBHOOK_URL;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const normalized = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function parseDeaths(html) {
  const $ = cheerio.load(html);
  let table = null;

  for (const candidate of $('table').toArray()) {
    const headers = $(candidate)
      .find('tr').filter((_, tr) => $(tr).children('th').length > 0)
      .first().children('th')
      .toArray().map((th) => normalized($(th).text()).toLowerCase());
    if (['when', 'character', 'level', 'killed by', 'world'].every((header) => headers.includes(header))) {
      table = { element: candidate, headers };
      break;
    }
  }

  if (!table) {
    throw new Error('Death table not found on Tibia Tracker. Site structure may have changed.');
  }

  const indices = Object.fromEntries(table.headers.map((key, index) => [key, index]));
  const result = [];
  $(table.element).find('tr').each((_, row) => {
    const cells = $(row).children('td').toArray();
    if (!cells.length) return;

    const cellText = (index) => {
      const cell = $(cells[index]);
      const raw = normalized(cell.text());
      if (raw) return raw;
      return normalized(cell.find('img[alt]').first().attr('alt'));
    };

    const when = cellText(indices.when);
    const name = cellText(indices.character);
    const level = Number(cellText(indices.level));
    const killer = cellText(indices['killed by']) || 'Unknown';
    const world = cellText(indices.world);

    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(when) || !name || !Number.isInteger(level)) return;
    if (world.toLowerCase() !== WORLD.toLowerCase()) return;

    result.push({ when, name, level, killer, world });
  });

  // A nonempty table without parsed rows usually indicates unexpected markup.
  if (!result.length) throw new Error('No Kanda deaths were parsed from the death table; refusing to overwrite saved state.');
  return result;
}

export function fingerprint(event) {
  return [event.when, event.name, event.level, event.killer].map((part) => normalized(part).toLowerCase()).join('|');
}

async function getDeaths() {
  const response = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'KandaDiscordDeathTracker/1.0 (+GitHub Actions)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Tibia Tracker returned HTTP ${response.status}`);
  const html = await response.text();
  return parseDeaths(html);
}

async function getState() {
  try {
    const state = JSON.parse(await readFile(STATE_PATH, 'utf8'));
    if (state.version !== 1 || typeof state.counts !== 'object' || !state.counts) {
      throw new Error('Unexpected state format');
    }
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function saveState(state) {
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function postDeath(event) {
  if (!WEBHOOK) throw new Error('Missing DISCORD_DEATHS_WEBHOOK_URL secret');
  const profile = `https://www.tibia.com/community/?subtopic=characters&name=${encodeURIComponent(event.name)}`;
  const safe = (value, maxLength) => normalized(value).replace(/@/g, '@\u200b').slice(0, maxLength);
  const payload = {
    username: 'Kanda Death Tracker',
    allowed_mentions: { parse: [] },
    embeds: [{
      color: 0xBF3838,
      title: `☠️ ${safe(event.name, 180)} died at level ${event.level}`,
      url: profile,
      fields: [
        { name: 'Killed by', value: safe(event.killer, 900) },
        { name: 'World', value: WORLD, inline: true },
        { name: 'Death time', value: `${event.when} (New York time)`, inline: true },
      ],
      footer: { text: 'Recorded by Tibia Tracker • May appear after the actual death' },
    }],
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) return;
    if (response.status === 429) {
      const body = await response.json().catch(() => ({}));
      const retryMs = Math.max(1000, Math.ceil(Number(body.retry_after ?? 1) * 1000));
      await sleep(retryMs);
      continue;
    }
    if (response.status >= 500) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    throw new Error(`Discord webhook returned HTTP ${response.status}`);
  }
  throw new Error('Discord webhook failed after multiple retries');
}

async function main() {
  if (!WEBHOOK) throw new Error('Set DISCORD_DEATHS_WEBHOOK_URL as a repository secret.');
  const deaths = await getDeaths();
  console.log(`Parsed ${deaths.length} recorded Kanda deaths from Tibia Tracker.`);

  // Use occurrence counts because two indistinguishable deaths can occur in the same minute.
  const ordered = [...deaths].reverse();
  const observed = {};
  for (const event of ordered) {
    const key = fingerprint(event);
    observed[key] = (observed[key] ?? 0) + 1;
  }

  let state = await getState();
  if (!state) {
    state = { version: 1, counts: observed };
    await saveState(state);
    console.log('First run: initialized baseline without posting historical deaths.');
    return;
  }

  const scannedCounts = {};
  let posted = 0;
  for (const event of ordered) {
    const key = fingerprint(event);
    const occurrence = (scannedCounts[key] ?? 0) + 1;
    scannedCounts[key] = occurrence;
    const prior = state.counts[key] ?? 0;
    if (occurrence <= prior) continue;

    await postDeath(event);
    state.counts[key] = occurrence;
    await saveState(state); // Ensures checkpoint can be committed even after a later failure.
    posted++;
    await sleep(500);
  }

  // Limit the checkpoint size while retaining at least 45 days of event signatures.
  const cutoff = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  let trimmed = false;
  for (const key of Object.keys(state.counts)) {
    if (/^\d{4}-\d{2}-\d{2}/.test(key) && key.slice(0, 10) < cutoff) {
      delete state.counts[key];
      trimmed = true;
    }
  }
  if (trimmed) await saveState(state);
  console.log(`Posted ${posted} newly recorded deaths; ${Object.keys(state.counts).length} signatures in checkpoint.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
