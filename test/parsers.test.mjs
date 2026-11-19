import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DAILY_TEST_IMPORT = '1';
process.env.TEST_NOW = '2026-11-19T12:00:00Z';
const { parseOfficialBoosts, parseOfficialCalendar, parseTibiaGGEvents, eventsFromDays, eventsByStatus, today, plusDays } = await import('../daily.mjs');

test('Tibia server day is 19 Nov 2026 after server save', () => {
  assert.equal(today, '2026-11-19');
  assert.equal(plusDays(today, 1), '2026-11-20');
});

test('boosts are found in Tibia.com RightArtwork #Monster and #Boss', () => {
  const result = parseOfficialBoosts(`<div id="RightArtwork">
    <img id="Monster" title="Today's boosted creature: Kongra">
    <img id="Boss" title="Today's boosted boss: Earl Osam">
  </div>`);
  assert.equal(result.creature, 'Kongra');
  assert.equal(result.boss, 'Earl Osam');
  assert.equal(result.verified, true);
});

test('official calendar popup content and date rollover are decoded', () => {
  let cells = '';
  const days = [26,27,28,29,30,31, ...Array.from({length: 30}, (_,i) => i+1), 1,2,3,4,5,6];
  for (const day of days) {
    const popup = day === 20 ? `<span class="HelperDivIndicator" onmouseover="showHelp('x','events','&lt;div&gt;XP/Skill Event:&lt;/div&gt;&lt;div&gt;Bonus XP&lt;/div&gt;', );"></span>` : '';
    cells += `<td><div><span>${day}</span></div>${popup}</td>`;
  }
  const html = `<div class="eventscheduleheaderdateblock">November 2026</div>
    <table id="eventscheduletable"><tr>${cells}</tr></table>`;
  const parsed = parseOfficialCalendar(html);
  assert.equal(parsed[0].date, '2026-10-26');
  const nov20 = parsed.find(d => d.date === '2026-11-20');
  assert.ok(nov20);
  assert.equal(nov20.entries[0]?.title, 'XP/Skill Event');
  assert.equal(nov20.entries[0]?.description, 'Bonus XP');
  assert.equal(eventsFromDays(parsed).find(e => e.title === 'Double Experience and Skill')?.start, '2026-11-20');
});

test('yearly fallback table parser keeps year and month crossover', () => {
  const html = `<h2>Event calendar</h2><table><tr><th>When</th><th>Event</th><th>Kind</th></tr>
  ${Array.from({length: 10}, (_,i) => `<tr><td>Jan ${i+1} – Jan ${i+2}</td><td>Event${i}</td><td>Seasonal</td></tr>`).join('')}
  <tr><td>Dec 22 – Jan 10</td><td>Winterlight Solstice</td><td>World quest</td></tr></table>
  <p>The yearly events of 2026, and its boost weekends</p>`;
  const events = parseTibiaGGEvents(html);
  assert.equal(events.length, 11);
  assert.equal(events.at(-1).end, '2027-01-10');
});

test('events ending at today server save are not active', () => {
  const upcoming = { title: 'Double Experience and Skill', start: '2026-11-20', end: '2026-11-23' };
  const expired = { title: 'Example', start: '2026-11-18', end: '2026-11-19' };
  const { active, upcoming: next } = eventsByStatus([upcoming, expired]);
  assert.equal(active.length, 0);
  assert.equal(next[0].title, upcoming.title);
});
