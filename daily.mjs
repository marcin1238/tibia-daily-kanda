import * as cheerio from 'cheerio';

const API = 'https://api.tibiadata.com/v5';
const WORLD = 'Kanda';
const TIMEZONE = 'Europe/Warsaw';
const CALENDAR = 'https://www.tibia.com/news/?subtopic=eventcalendar';
const WIKI = 'https://tibia.fandom.com/wiki/Dream_Scar/Boss_of_the_Day';
const webhook = process.env.DISCORD_WEBHOOK_URL;
if (!webhook && process.env.DRY_RUN !== '1') throw new Error('Missing DISCORD_WEBHOOK_URL');
const now = new Date();
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const safe = v => clean(v).replace(/([*_`~|])/g, '\\$1').replace(/@/g, '@\u200b');
const iso = d => d.toISOString().slice(0, 10);
const plusDays = (date, delta) => iso(new Date(new Date(`${date}T12:00:00Z`).getTime() + delta * 86400000));
const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
}).formatToParts(now);
const p = type => parts.find(x => x.type === type)?.value;
const today = `${p('year')}-${p('month')}-${p('day')}`;
const fmt = date => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

async function fetchData(url, json = false) {
  const res = await fetch(url, {
    headers: { Accept: json ? 'application/json' : 'text/html', 'Cache-Control': 'no-cache', 'User-Agent': 'TibiaDailyKanda/2.0' },
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${new URL(url).hostname})`);
  return json ? res.json() : res.text();
}
const api = path => fetchData(`${API}${path}`, true);
async function optional(label, fn, fallback) {
  try { return await fn(); } catch (e) { console.warn(`${label}: ${e.message}`); return fallback; }
}

async function boosted() {
  // Prefer live Tibia.com because TibiaData/CDN may still contain yesterday's data.
  const official = await optional('Official boosts', async () => {
    const $ = cheerio.load(await fetchData('https://www.tibia.com/library/?subtopic=creatures'));
    const find = kind => {
      const el = $('img[title]').filter((_, item) => new RegExp(`today.s boosted ${kind}`, 'i').test($(item).attr('title') ?? '')).first();
      return clean((el.attr('title') ?? '').replace(new RegExp(`^today.s boosted ${kind}:?\\s*`, 'i'), ''));
    };
    const creature = find('creature'), boss = find('boss');
    if (!creature || !boss) throw new Error('Boost data not found on official page');
    return { creature, boss, source: 'tibia.com' };
  }, null);
  const tibiadata = await optional('TibiaData boosts', async () => {
    const [c, b] = await Promise.all([api('/creatures'), api('/boostablebosses')]);
    const creature = clean(c.creatures?.boosted?.name), boss = clean(b.boostable_bosses?.boosted?.name);
    if (!creature || !boss) throw new Error('Invalid API response');
    return { creature, boss, source: 'TibiaData (cached/unverified)' };
  }, null);
  if (official && tibiadata && (official.creature.toLowerCase() !== tibiadata.creature.toLowerCase() || official.boss.toLowerCase() !== tibiadata.boss.toLowerCase())) {
    console.warn('Boost mismatch! Official:', official, 'API:', tibiadata);
  }
  return official ?? tibiadata ?? { creature: 'Unavailable', boss: 'Unavailable', source: 'Unavailable' };
}

async function ichgahal() {
  const entries = (await api(`/killstatistics/${WORLD}`)).killstatistics?.entries;
  if (!Array.isArray(entries)) throw new Error('Bad kill statistics response');
  const boss = entries.find(e => clean(e.race).toLowerCase() === 'ichgahal');
  return Number.isInteger(boss?.last_day_killed) ? `${boss.last_day_killed.toLocaleString('en-US')} kills` : 'Unavailable (not listed)';
}

function drome() {
  // Rotation #140 began 2026-11-11 08:00 UTC; each rotation lasts 14 days.
  const base = Date.parse('2026-11-11T08:00:00Z');
  const interval = 14 * 86400000;
  const index = Math.floor((Date.now() - base) / interval);
  const end = new Date(base + (index + 1) * interval);
  const hoursLeft = Math.max(0, Math.ceil((end.getTime() - Date.now()) / 3600000));
  return `Rotation **#${140 + index}** • Next reset **${fmt(iso(end))}** (${Math.floor(hoursLeft / 24)}d ${hoursLeft % 24}h)\nModifiers are randomized: check the board in-game.`;
}

async function dreamScar() {
  const urls = [
    'https://tibia.fandom.com/api.php?action=parse&page=Dream_Scar%2FBoss_of_the_Day&prop=text&format=json',
    `${WIKI}?_=${Date.now()}`,
  ];
  const allowed = ['Plagueroot', 'Malofur Mangrinder', 'Maxxenius', 'Alptramun', 'Izcandar the Banished'];
  for (const url of urls) {
    try {
      const html = url.includes('/api.php') ? (await fetchData(url, true)).parse?.text?.['*'] : await fetchData(url);
      if (!html) throw new Error('No rendered wiki content');
      const $ = cheerio.load(html);
      const wikiDay = clean($('body').text()).match(/Today is (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i)?.[1];
      const expectedDay = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Etc/GMT+8' }).format(now);
      if (wikiDay?.toLowerCase() !== expectedDay.toLowerCase()) throw new Error(`Stale wiki date (${wikiDay || 'missing'})`);
      let boss;
      $('tr').each((_, row) => {
        const cells = $(row).find('th,td').map((_, el) => clean($(el).text())).get();
        if (cells[0] === WORLD) boss = cells[1];
      });
      if (!allowed.includes(boss)) throw new Error('Kanda boss unavailable');
      return `${boss} (community-maintained)`;
    } catch (e) { console.warn(`Dream Scar: ${e.message}`); }
  }
  return 'Unverified for Kanda today';
}

// Tibia's official calendar stores daily event titles/descriptions inside hover popups.
function parsePopups($, cell) {
  const result = [];
  $(cell).find('span.HelperDivIndicator[onmouseover]').each((_, el) => {
    const attr = $(el).attr('onmouseover') || '';
    const first = attr.indexOf(','), second = attr.indexOf(',', first + 1);
    if (second < 0) return;
    let html = attr.slice(second + 1).replace(/,?\s*\);?\s*$/, '').trim();
    if (html.startsWith("'")) html = html.slice(1);
    if (html.endsWith("'")) html = html.slice(0, -1);
    html = html.replace(/\\'/g, "'").replace(/\\"/g, '"');
    const nested = cheerio.load(`<section>${html}</section>`);
    const divs = nested('section div').map((_, div) => clean(nested(div).text())).get();
    for (let i = 0; i + 1 < divs.length; i += 2) {
      if (divs[i]) result.push({ title: divs[i].replace(/:$/, ''), description: divs[i + 1].replace(/^•\s*/, '') });
    }
  });
  return result;
}

function parseCalendar(html) {
  const $ = cheerio.load(html);
  const header = clean($('.eventscheduleheaderdateblock').first().text());
  const match = header.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if (!match || !$('#eventscheduletable').length) throw new Error('Unrecognized calendar HTML');
  let month = new Date(`${match[1]} 1, ${match[2]} 12:00:00 GMT`).getUTCMonth() + 1;
  let year = Number(match[2]), expected = 1;
  const days = [];
  $('#eventscheduletable td').each((_, cell) => {
    const day = Number(clean($(cell).find('div').first().text()));
    if (!Number.isInteger(day) || day < 1 || day > 31) return;
    if (expected < day) { month--; if (month < 1) { month = 12; year--; } }
    else if (day < expected) { month++; if (month > 12) { month = 1; year++; } }
    expected = day + 1;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    days.push({ date, entries: parsePopups($, cell) });
  });
  if (days.length < 20) throw new Error('Calendar incomplete');
  if (html.includes('HelperDivIndicator') && !days.some(d => d.entries.length)) throw new Error('Event popups could not be decoded');
  return days;
}

async function getEvents() {
  const [year, month] = today.split('-').map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  const months = [[year, month], [next.getUTCFullYear(), next.getUTCMonth() + 1]];
  const pages = await Promise.all(months.map(async ([y, m]) => optional(`Events ${y}-${m}`, () => fetchData(`${CALENDAR}&calendarmonth=${m}&calendaryear=${y}`).then(parseCalendar), null)));
  if (!pages.some(Boolean)) throw new Error('Could not fetch any official calendars');
  const unique = new Map();
  for (const page of pages.filter(Boolean)) for (const day of page) for (const event of day.entries) {
    const key = `${event.title}|${event.description}`.toLowerCase();
    if (!unique.has(key)) unique.set(key, { ...event, days: new Set() });
    unique.get(key).days.add(day.date);
  }
  const active = [], upcoming = [], horizon = plusDays(today, 28);
  for (const event of unique.values()) {
    const days = [...event.days].sort();
    if (!days.length) continue;
    let group = [days[0]];
    const emit = () => {
      const start = group[0], end = group.at(-1);
      const entry = { title: event.title, description: event.description, start, end };
      if (start <= today && end >= today) active.push(entry);
      else if (start > today && start <= horizon) upcoming.push(entry);
    };
    for (const day of days.slice(1)) {
      if (plusDays(group.at(-1), 1) === day) group.push(day);
      else { emit(); group = [day]; }
    }
    emit();
  }
  active.sort((a,b) => a.end.localeCompare(b.end));
  upcoming.sort((a,b) => a.start.localeCompare(b.start));
  return { active, upcoming };
}

function showEvents(events, mode) {
  if (!events.length) return mode === 'active' ? 'No active events listed' : 'No upcoming events listed in 28 days';
  const lines = events.slice(0, 5).map(event => {
    const label = mode === 'active' ? `until ${fmt(event.end)}` : `starts ${fmt(event.start)}`;
    return `• **${safe(event.title)}** — ${label}\n  ${safe(event.description).slice(0, 130)}`;
  });
  if (events.length > 5) lines.push(`…and ${events.length - 5} more`);
  return lines.join('\n').slice(0, 1024);
}

async function main() {
  const [todayBoost, kills, dream, events] = await Promise.all([
    boosted(),
    optional('Ichgahal kills', ichgahal, 'Unavailable (API error)'),
    optional('Dream Scar', dreamScar, 'Unverified for Kanda today'),
    optional('Events', getEvents, null),
  ]);
  const rashid = {
    Monday: 'Svargrond', Tuesday: 'Liberty Bay', Wednesday: 'Port Hope',
    Thursday: 'Ankrahmun', Friday: 'Darashia', Saturday: 'Edron', Sunday: 'Carlin',
  };
  const boostLabel = todayBoost.source === 'tibia.com' ? 'TODAY' : 'FRESHNESS NOT VERIFIED';
  const payload = {
    username: 'Tibia Daily', allowed_mentions: { parse: [] },
    embeds: [{
      title: `📅 Tibia Daily — Kanda — ${fmt(today)}`,
      description: 'Current Tibia server day, following server save.',
      color: 0x2a9d8f,
      fields: [
        { name: `🐉 Boosted Creature — ${boostLabel}`, value: safe(todayBoost.creature), inline: true },
        { name: `💀 Boosted Boss — ${boostLabel}`, value: safe(todayBoost.boss), inline: true },
        { name: '🧳 Rashid — TODAY', value: rashid[p('weekday')], inline: true },
        { name: '⚔️ Ichgahal — PREVIOUS reported day (Kanda)', value: kills, inline: true },
        { name: '🌙 Dream Courts / Dream Scar — Kanda', value: safe(dream), inline: true },
        { name: '🏟️ Tibiadrome', value: drome() },
        { name: '🎉 Active Events', value: events ? showEvents(events.active, 'active') : 'Unavailable (calendar could not be read)' },
        { name: '📅 Upcoming Events (28 days)', value: events ? showEvents(events.upcoming, 'upcoming') : 'Unavailable (calendar could not be read)' },
      ],
      footer: { text: `Kanda • Boost source: ${todayBoost.source} • Event source: Tibia.com` },
      timestamp: now.toISOString(),
    }],
  };
  if (process.env.DRY_RUN === '1') { console.log(JSON.stringify(payload, null, 2)); return; }
  const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Discord webhook HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  console.log(`Daily posted for ${WORLD}. Boost source: ${todayBoost.source}`);
}

if (process.env.DAILY_TEST_IMPORT !== '1') await main();
export { parsePopups, parseCalendar, showEvents, drome, plusDays, getEvents };
