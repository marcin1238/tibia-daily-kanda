import * as cheerio from 'cheerio';

const WORLD = 'Kanda';
const API = 'https://api.tibiadata.com/v5';
const OFFICIAL_CALENDAR = 'https://www.tibia.com/news/?subtopic=eventcalendar';
const FALLBACK_EVENTS = 'https://tibia.gg/en/articles/events';
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const now = process.env.TEST_NOW ? new Date(process.env.TEST_NOW) : new Date();
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const safe = value => clean(value).replace(/([*_`~|])/g, '\\$1').replace(/@/g, '@\u200b');
const iso = d => d.toISOString().slice(0, 10);
const plusDays = (date, days) => iso(new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000));
const formatted = date => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const warsaw = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
}).formatToParts(now);
const part = kind => warsaw.find(p => p.type === kind)?.value;
const wallDate = `${part('year')}-${part('month')}-${part('day')}`;
// Tibia's day rolls over at the regular 10:00 CET/CEST server save, not at midnight.
const today = Number(part('hour')) >= 10 ? wallDate : plusDays(wallDate, -1);
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${today}T12:00:00Z`));

async function get(url, json = false) {
  const res = await fetch(url, {
    headers: {
      Accept: json ? 'application/json' : 'text/html,application/xhtml+xml',
      'Cache-Control': 'no-cache',
      'User-Agent': 'Mozilla/5.0 (compatible; KandaDaily/3.0; +https://github.com)',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(18000),
  });
  if (!res.ok) throw new Error(`${new URL(url).hostname} HTTP ${res.status}`);
  return json ? res.json() : res.text();
}
const api = path => get(`${API}${path}`, true);
async function attempt(label, fn, fallback = null) {
  try { return await fn(); }
  catch (e) { console.warn(`[${label}] ${e.message}`); return fallback; }
}

// Tibia.com puts the two boosted values in the page's RightArtwork header.
// These selectors match the ones used by the actively maintained Tibia.py parser.
function parseOfficialBoosts(html) {
  const $ = cheerio.load(html);
  const parse = id => clean($(`#RightArtwork #${id}, #${id}`).first().attr('title'))
    .replace(/^Today.s boosted (?:creature|boss):\s*/i, '').trim();
  const creature = parse('Monster');
  const boss = parse('Boss');
  if (!creature || !boss) throw new Error('Missing #Monster or #Boss header data');
  return { creature, boss, source: 'tibia.com', verified: true };
}

async function boosted() {
  const official = await attempt('Official boosts', async () => {
    const html = await get('https://www.tibia.com/library/?subtopic=creatures');
    return parseOfficialBoosts(html);
  });
  if (official) return official;
  const fallback = await attempt('TibiaData boosts', async () => {
    const [creatures, bosses] = await Promise.all([api('/creatures'), api('/boostablebosses')]);
    const creature = clean(creatures.creatures?.boosted?.name);
    const boss = clean(bosses.boostable_bosses?.boosted?.name);
    if (!creature || !boss) throw new Error('Missing boosted values');
    return { creature, boss, source: 'TibiaData (cached)', verified: false };
  });
  return fallback ?? { creature: 'Unavailable', boss: 'Unavailable', source: 'unavailable', verified: false };
}

async function ichgahal() {
  const entries = (await api(`/killstatistics/${WORLD}`)).killstatistics?.entries;
  if (!Array.isArray(entries)) throw new Error('Bad kill statistics response');
  const record = entries.find(entry => clean(entry.race).toLowerCase() === 'ichgahal');
  return Number.isInteger(record?.last_day_killed)
    ? `${record.last_day_killed.toLocaleString('en-US')} kills`
    : 'No previous-day record supplied by API';
}

function drome() {
  // Publicly documented rotation #140 ends at the server save on 25 Nov 2026.
  const base = Date.parse('2026-11-11T09:00:00Z');
  const duration = 14 * 86400000;
  const index = Math.floor((now.getTime() - base) / duration);
  const reset = new Date(base + (index + 1) * duration);
  const hoursLeft = Math.max(0, Math.ceil((reset.getTime() - now.getTime()) / 3600000));
  return `Rotation **#${140 + index}** • Next reset **${formatted(iso(reset))}** (${Math.floor(hoursLeft / 24)}d ${hoursLeft % 24}h)`;
}

async function dreamScar() {
  // Still community-maintained, not an official Kanda API. Report this qualification.
  const urls = [
    'https://tibia.fandom.com/api.php?action=parse&page=Dream_Scar%2FBoss_of_the_Day&prop=text&format=json',
    'https://tibia.fandom.com/wiki/Dream_Scar/Boss_of_the_Day',
  ];
  const allowed = new Set(['Plagueroot', 'Malofur Mangrinder', 'Maxxenius', 'Alptramun', 'Izcandar the Banished']);
  for (const url of urls) {
    try {
      const html = url.includes('/api.php') ? (await get(url, true)).parse?.text?.['*'] : await get(url);
      const $ = cheerio.load(html ?? '');
      const wikiDay = clean($('body').text()).match(/Today is (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i)?.[1];
      if (!wikiDay || wikiDay.toLowerCase() !== weekday.toLowerCase()) {
        throw new Error(`Wiki date not confirmed for ${weekday} (reported ${wikiDay ?? 'missing'})`);
      }
      let boss;
      $('tr').each((_, el) => {
        const cells = $(el).find('td, th').map((_, c) => clean($(c).text())).get();
        if (cells[0] === WORLD) boss = cells[1];
      });
      if (!allowed.has(boss)) throw new Error('Kanda boss absent');
      return `${boss}`;
    } catch (e) { console.warn(`[Dream Scar] ${e.message}`); }
  }
  return 'Not verifiable for Kanda today';
}

// Official Tibia calendar: each day contains a HelperDivIndicator popup, whose
// onmouseover JS embeds pairs of HTML divs: title followed by description.
function parsePopups($, cell) {
  const result = [];
  $(cell).find('span.HelperDivIndicator[onmouseover]').each((_, element) => {
    const raw = $(element).attr('onmouseover') ?? '';
    const first = raw.indexOf(',');
    const second = raw.indexOf(',', first + 1);
    if (first < 0 || second < 0) return;
    const html = raw.slice(second + 1)
      .replace(/,\s*\);?\s*$/, '')
      .replace(/\\'/g, '"')
      .replace(/'/g, '')
      .trim();
    const nested = cheerio.load(`<section>${html}</section>`);
    const divs = nested('section div').map((_, el) => clean(nested(el).text())).get();
    for (let i = 0; i + 1 < divs.length; i += 2) {
      if (divs[i]) result.push({ title: divs[i].replace(/:$/, ''), description: divs[i + 1].replace(/^•\s*/, '') });
    }
  });
  return result;
}

function parseOfficialCalendar(html) {
  const $ = cheerio.load(html);
  const header = clean($('div.eventscheduleheaderdateblock').first().text());
  const match = header.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if (!match || !$('#eventscheduletable').length) throw new Error('Unknown Tibia calendar HTML');
  let month = new Date(`${match[1]} 1, ${match[2]} 12:00:00 GMT`).getUTCMonth() + 1;
  let year = Number(match[2]);
  let expected = 1;
  const days = [];
  $('#eventscheduletable td').each((_, cell) => {
    const number = Number(clean($(cell).find('div').first().text()));
    if (!Number.isInteger(number) || number < 1 || number > 31) return;
    if (expected < number) { month--; if (month === 0) { month = 12; year--; } }
    else if (number < expected) { month++; if (month === 13) { month = 1; year++; } }
    expected = number + 1;
    days.push({ date: `${year}-${String(month).padStart(2, '0')}-${String(number).padStart(2, '0')}`, entries: parsePopups($, cell) });
  });
  if (days.length < 28) throw new Error(`Only ${days.length} calendar dates decoded`);
  if (html.includes('HelperDivIndicator') && !days.some(d => d.entries.length)) {
    throw new Error('Event popups were not decoded');
  }
  return days;
}

function normalizeTitle(title) {
  const str = clean(title).toLowerCase();
  if (/^(xp\/skill event|double xp.*skill|double experience.*skill)$/.test(str)) return 'double-experience-and-skill';
  return str.replace(/[^a-z0-9]/g, '');
}

function eventsFromDays(days) {
  const map = new Map();
  for (const day of days) for (const entry of day.entries) {
    const key = normalizeTitle(entry.title);
    if (!map.has(key)) map.set(key, { title: key === 'double-experience-and-skill' ? 'Double Experience and Skill' : entry.title, description: entry.description, days: new Set() });
    map.get(key).days.add(day.date);
  }
  const result = [];
  for (const event of map.values()) {
    const sorted = [...event.days].sort();
    if (!sorted.length) continue;
    let group = [sorted[0]];
    const emit = () => {
      // The last calendar date is the server-save end date (end-exclusive).
      result.push({ title: event.title, description: event.description, start: group[0], end: group.at(-1) });
    };
    for (const d of sorted.slice(1)) {
      if (plusDays(group.at(-1), 1) === d) group.push(d);
      else { emit(); group = [d]; }
    }
    emit();
  }
  return result;
}

async function officialEvents() {
  const [year, month] = today.split('-').map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  const pages = await Promise.all([
    [year, month], [next.getUTCFullYear(), next.getUTCMonth() + 1],
  ].map(async ([y, m]) => attempt(`Official events ${y}-${m}`,
    async () => parseOfficialCalendar(await get(`${OFFICIAL_CALENDAR}&calendarmonth=${m}&calendaryear=${y}`)),
    null)));
  if (!pages.some(Boolean)) throw new Error('Official website blocked or HTML structure changed');
  const events = eventsFromDays(pages.filter(Boolean).flat());
  if (!events.length) throw new Error('No events found on official calendar');
  return { events, source: 'Tibia.com calendar' };
}

// TibiaGG publishes an explicitly dated yearly table as a fallback.
// We deliberately do NOT project yearly events into a different year.
function parseTibiaGGEvents(html) {
  const $ = cheerio.load(html);
  const text = clean($.root().text());
  const year = Number(text.match(/yearly events of (20\d\d)/i)?.[1]);
  if (!year) throw new Error('Could not establish source year');
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const date = (name, day, y) => `${y}-${String(months[name.toLowerCase()]).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const events = [];
  $('table tr').each((_, tr) => {
    const cells = $(tr).find('td').map((_, td) => clean($(td).text())).get();
    if (cells.length < 3) return;
    const match = cells[0].match(/^([A-Za-z]{3})\s+(\d{1,2})\s*[–-]\s*(?:([A-Za-z]{3})\s+)?(\d{1,2})$/);
    if (!match || !months[match[1].toLowerCase()] || (match[3] && !months[match[3].toLowerCase()])) return;
    const start = date(match[1], match[2], year);
    const end = date(match[3] || match[1], match[4], (match[3] && months[match[3].toLowerCase()] < months[match[1].toLowerCase()]) ? year + 1 : year);
    if (start >= end) return;
    events.push({ title: cells[1], description: cells[2], start, end });
  });
  if (events.length < 10) throw new Error(`Only ${events.length} dated events parsed`);
  return events;
}

// Captured from the official November 2026 calendar, for situations in which
// both live event sources block automated HTTP requests. These dates expire.
const OFFICIAL_2026_FALLBACK = [
  { title: 'Double Experience and Skill', start: '2026-11-20', end: '2026-11-23', description: 'Double XP and skills' },
  { title: 'Last Creep Standing', start: '2026-11-20', end: '2026-11-25', description: 'Scheduled Tibia event' },
  { title: 'Rapid Respawn', start: '2026-12-04', end: '2026-12-07', description: 'Faster creature respawns' },
];

async function getEvents() {
  const official = await attempt('Official event calendar', officialEvents);
  if (official) return official;
  const fallback = await attempt('TibiaGG events', async () => parseTibiaGGEvents(await get(FALLBACK_EVENTS)), []);
  // Merge any available live yearly-table dates with 2026 events observed on official page.
  const map = new Map();
  for (const event of [...fallback, ...OFFICIAL_2026_FALLBACK]) {
    const key = `${normalizeTitle(event.title)}|${event.start}`;
    // The official snapshot wins when both sources describe the same occurrence.
    map.set(key, event);
  }
  return { events: [...map.values()], source: fallback.length ? 'TibiaGG yearly table + official 2026 snapshot' : 'official Nov/Dec 2026 snapshot (limited)' };
}

function eventsByStatus(all) {
  const horizon = plusDays(today, 28);
  const active = [], upcoming = [];
  for (const e of all) {
    if (e.start <= today && today < e.end) active.push(e);
    else if (today < e.start && e.start <= horizon) upcoming.push(e);
  }
  active.sort((a, b) => a.end.localeCompare(b.end));
  upcoming.sort((a, b) => a.start.localeCompare(b.start));
  return { active, upcoming };
}
function displayEvents(events, type) {
  if (!events.length) return type === 'active' ? 'No active events found' : 'No upcoming events found within 28 days';
  let lines = events.slice(0, 6).map(e => {
    const when = type === 'active' ? `ends ${formatted(e.end)} at server save` : `starts ${formatted(e.start)}`;
    return `• **${safe(e.title)}** — ${when}${e.description ? `\n  ${safe(e.description).slice(0, 90)}` : ''}`;
  });
  if (events.length > 6) lines.push(`…plus ${events.length - 6} more`);
  return lines.join('\n').slice(0, 1024);
}

async function main() {
  if (!WEBHOOK && process.env.DRY_RUN !== '1') throw new Error('Missing DISCORD_WEBHOOK_URL');
  const [boost, kills, dream, eventsData] = await Promise.all([
    boosted(),
    attempt('Ichgahal', ichgahal, 'Unavailable (API error)'),
    attempt('Dream Scar', dreamScar, 'Not verifiable for Kanda today'),
    getEvents(),
  ]);
  const { active, upcoming } = eventsByStatus(eventsData.events);
  const rashid = {
    Monday: 'Svargrond', Tuesday: 'Liberty Bay', Wednesday: 'Port Hope',
    Thursday: 'Ankrahmun', Friday: 'Darashia', Saturday: 'Edron', Sunday: 'Carlin',
  };
  const payload = {
    username: 'Tibia Daily', allowed_mentions: { parse: [] },
    embeds: [{
      title: `📅 Tibia Daily ${formatted(today)}`,
      description: `Server day: ${formatted(today)}`,
      color: 0x2a9d8f,
      fields: [
        { name: '🐉 Boosted Creature', value: safe(boost.creature), inline: true },
        { name: '💀 Boosted Boss', value: safe(boost.boss), inline: true },
        { name: '🧳 Rashid', value: rashid[weekday], inline: true },
        { name: '⚔️ Ichgahal — last day kills', value: kills, inline: true },
        { name: '🌙 Dream Courts', value: safe(dream), inline: true },
        { name: '🏟️ Tibiadrome', value: drome() },
        { name: '🎉 Active Events', value: displayEvents(active, 'active') },
        // { name: '📅 Upcoming Events (28 days)', value: displayEvents(upcoming, 'upcoming') },
      ],
      footer: { text: `Boosts: ${boost.source} • Events: ${eventsData.source}`.slice(0, 2048) },
      timestamp: now.toISOString(),
    }],
  };
  if (process.env.DRY_RUN === '1') { console.log(JSON.stringify(payload, null, 2)); return; }
  const res = await fetch(WEBHOOK, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Discord HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
  console.log(`Posted ${today}; boosts ${boost.source}; events ${eventsData.source}`);
}

if (process.env.DAILY_TEST_IMPORT !== '1') await main();
export { parseOfficialBoosts, parsePopups, parseOfficialCalendar, parseTibiaGGEvents, eventsFromDays, eventsByStatus, displayEvents, plusDays, today };
