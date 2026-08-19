// GitHub's public contribution calendar. No token, no GraphQL scope.

export async function fetchCalendar(user) {
  const res = await fetch(`https://github.com/users/${user}/contributions`, {
    headers: { accept: 'text/html', 'user-agent': 'contribution-maze' }
  });
  if (!res.ok) throw new Error(`${user}: HTTP ${res.status}`);
  const html = await res.text();

  const days = [];
  for (const m of html.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"[^>]*?data-level="(\d)"/g)) {
    days.push({ date: m[1], level: Number(m[2]) });
  }
  if (!days.length) throw new Error('no contribution cells found - GitHub changed the page');
  return days;
}

// Used when the calendar cannot be reached, so a run still produces a board.
export function syntheticCalendar(seedFn, count = 371) {
  const start = Date.UTC(2025, 7, 17);
  return Array.from({ length: count }, (_, i) => {
    const r = seedFn();
    return {
      date: new Date(start + i * 86400000).toISOString().slice(0, 10),
      level: r > 0.88 ? 4 : r > 0.72 ? 3 : r > 0.52 ? 2 : r > 0.3 ? 1 : 0
    };
  });
}
