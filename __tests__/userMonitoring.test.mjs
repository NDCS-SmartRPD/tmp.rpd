import { inContactRange, matchesMonitoring, communicationUsage } from '../src/js/admin/userMonitoring.js';

test('existing communication alone determines usage at the selected cutoff', () => {
  const now = Date.parse('2026-11-23T00:00:00Z');
  const ago = days => new Date(now - days * 86400000).toISOString();
  expect(communicationUsage(ago(30), 30, now)).toEqual({ status: 'recent', ageLabel: '30 days ago' });
  expect(communicationUsage(ago(30.1), 30, now).status).toBe('inactive');
  expect(communicationUsage(ago(8), 7, now).status).toBe('inactive');
  expect(communicationUsage(ago(8), 90, now).status).toBe('recent');
  for (const value of [null, '', 'invalid', '1970-01-01T00:00:00Z', ago(-1)]) {
    expect(communicationUsage(value, 30, now).status).toBe('unknown');
  }
});

test('timestamp type and login-state filters compose without claiming online presence', () => {
  const user = { lastContactAt: '2026-11-18T02:15:30Z', lastLoginAt: '2026-11-17T02:15:30Z', loginState: 'logged_out' };
  expect(matchesMonitoring(user, 'lastContactAt', '2026-11-18T10:15', '2026-11-18T10:15', 'logged_out')).toBe(true);
  expect(matchesMonitoring(user, 'lastLoginAt', '2026-11-18T10:15', '', 'all')).toBe(false);
  expect(matchesMonitoring(user, 'lastContactAt', '', '', 'within_timeout')).toBe(false);
  expect(matchesMonitoring({}, 'lastContactAt', '', '', 'unknown')).toBe(true);
});

test('last-contact date bounds include the full end day in Singapore', () => {
  expect(inContactRange('2026-11-18T15:59:59Z', '2026-11-18', '2026-11-18')).toBe(true);
  expect(inContactRange('2026-11-18T16:00:00Z', '2026-11-18', '2026-11-18')).toBe(false);
  expect(inContactRange(null, '2026-11-18', '')).toBe(false);
  expect(inContactRange(null, '', '')).toBe(true);
  expect(inContactRange('2026-11-18T01:00:00Z', '2026-11-19', '2026-11-18')).toBe(false);
});
