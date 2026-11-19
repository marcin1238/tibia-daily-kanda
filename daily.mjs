const API = 'https://api.tibiadata.com/v5';
const WORLD = 'Kanda';
const webhook = process.env.DISCORD_WEBHOOK_URL;
if (!webhook) throw new Error('Missing DISCORD_WEBHOOK_URL secret');

async function get(path) {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`TibiaData ${path}: HTTP ${response.status}`);
  return response.json();
}

async function ichgahalLastDay() {
  try {
    const data = await get(`/killstatistics/${encodeURIComponent(WORLD)}`);
    const entries = data.killstatistics?.entries;
    if (!Array.isArray(entries)) throw new Error('Unexpected killstatistics response');
    const boss = entries.find(x => x.race?.trim().toLowerCase() === 'ichgahal');
    if (!boss || !Number.isInteger(boss.last_day_killed)) {
      console.warn('Ichgahal is not listed in the Kanda kill statistics');
      return 'Unavailable (not listed)';
    }
    return `${boss.last_day_killed.toLocaleString('en-US')} kills`;
  } catch (err) {
    console.warn(`Could not read Ichgahal kill statistics: ${err.message}`);
    return 'Unavailable (API error)';
  }
}

const [creatures, bosses, ichgahal] = await Promise.all([
  get('/creatures'), get('/boostablebosses'), ichgahalLastDay(),
]);
const creature = creatures.creatures?.boosted?.name;
const boss = bosses.boostable_bosses?.boosted?.name;
if (!creature || !boss) throw new Error('Missing boosted creature or boss');

const now = new Date();
const zone = 'Europe/Warsaw';
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: zone }).format(now);
const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: zone }).format(now);
const rashid = {
  Monday: 'Svargrond', Tuesday: 'Liberty Bay', Wednesday: 'Port Hope',
  Thursday: 'Ankrahmun', Friday: 'Darashia', Saturday: 'Edron', Sunday: 'Carlin',
};

const payload = {
  username: 'Tibia Daily',
  allowed_mentions: { parse: [] },
  embeds: [{
    title: `📅 Tibia Daily — ${WORLD} — ${date}`,
    color: 0x2a9d8f,
    fields: [
      { name: '🐉 Boosted Creature', value: creature, inline: true },
      { name: '💀 Boosted Boss', value: boss, inline: true },
      { name: '⚔️ Ichgahal — Previous Reported Day', value: ichgahal },
      { name: '🧳 Rashid', value: rashid[weekday], inline: true },
      { name: '📅 Tibia Events', value: '[Official event calendar](https://www.tibia.com/news/?subtopic=eventcalendar)' },
    ],
    footer: { text: 'World: Kanda • Source: TibiaData API v5' },
    timestamp: now.toISOString(),
  }],
};

const result = await fetch(webhook, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(20000),
});
if (!result.ok) throw new Error(`Discord webhook returned HTTP ${result.status}`);
console.log(`Tibia Daily posted: ${WORLD}, Ichgahal: ${ichgahal}`);
