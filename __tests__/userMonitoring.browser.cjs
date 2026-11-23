const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route('http://smartrpd.test/**', async route => {
      const fs = require('node:fs/promises');
      const path = require('node:path');
      const relative = new URL(route.request().url()).pathname.slice(1);
      const file = path.resolve(__dirname, '..', relative);
      if (!file.startsWith(path.resolve(__dirname, '..') + path.sep)) return route.abort();
      const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
      try { await route.fulfill({ body: await fs.readFile(file), contentType: types[path.extname(file)] || 'application/octet-stream' }); }
      catch { await route.fulfill({ status: 404, body: '' }); }
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.SMARTRPD_API_BASE = 'http://smartrpd.test/api/smartrpd';
      localStorage.setItem('smartrpd.tour.admin_users.v1', '1');
      localStorage.setItem('loggedInUser', JSON.stringify({ uuid: 'admin', username: 'Admin', isAdmin: 1 }));
    });
    let unavailable = false;
    let dense = false;
    await page.route('**/api/smartrpd/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let body;
      if (path.endsWith('/user/getall')) body = [
        { uuid: 'old', username: 'Older User', email: 'old@example.test', create_time: 1700000000, deleted: 0, is_admin: 0 },
        { uuid: 'recent', username: 'Recent User', email: 'recent@example.test', create_time: 1700000000, deleted: 0, is_admin: 0 },
        { uuid: 'unknown', username: 'Unknown User', email: 'unknown@example.test', create_time: 1700000000, deleted: 0, is_admin: 0 },
      ];
      else if (path.endsWith('/user/monitoring/getall')) {
        if (unavailable) return route.fulfill({ status: 503, json: {} });
        body = { users: [
          { uuid: 'old', lastLoginAt: null, lastContactAt: '2026-10-01T00:00:00Z', loginState: 'logged_out', loggedOut: true },
          { uuid: 'recent', lastLoginAt: '2026-11-18T00:00:00Z', lastContactAt: '2026-11-18T15:59:59Z', loginState: 'within_timeout', loggedOut: false },
        ], nextCursor: null };
      } else if (path.endsWith('/user/monitoring/get')) {
        assert.equal(route.request().postDataJSON()[1].targetUserUuid, 'recent');
        body = { user: { uuid: 'recent', lastLoginAt: '2026-11-18T00:00:00Z', lastContactAt: '2026-11-18T15:59:59Z', loggedOut: false, loginState: 'within_timeout' } };
      } else if (path.endsWith('/user/activity/get')) body = { events: [
        { id: '9', caseId: '123', action: 'Save 2D design', outcome: 'succeeded', source: 'server', occurredAt: '2026-11-18T00:00:00Z' },
      ], nextCursor: null };
      else body = [];
      if (dense && path.endsWith('/user/getall')) body = Array.from({ length: 40 }, (_, i) => ({
        uuid: `user-${i}`, username: `User ${i}`, email: `user${i}@example.test`, deleted: 0, is_admin: 0,
      }));
      await route.fulfill({ json: body });
    });
    await page.goto('http://smartrpd.test/src/pages/admin/admin_users.html');
    await page.waitForFunction(() => document.querySelectorAll('#userTableBody tr[data-uuid]').length === 3);
    assert.equal(await page.locator('#userResultCount').textContent(), 'Showing 3 of 3 users');
    assert.ok((await page.locator('#userListWrap').boundingBox()).height >= 300);
    if (await page.locator('#ptSkip').isVisible()) await page.locator('#ptSkip').click();
    assert.equal(await page.locator('#contactFrom').isEnabled(), true);
    await page.locator('#usageFilter').selectOption('inactive');
    assert.equal(await page.locator('#userTableBody tr[data-uuid="old"]').count(), 1);
    assert.equal(await page.locator('#userTableBody tr[data-uuid]').count(), 1);
    assert.equal(await page.locator('#userResultCount').textContent(), 'Showing 1 of 3 users');
    await page.locator('#usageThreshold').selectOption('90');
    assert.equal(await page.locator('#userTableBody tr[data-uuid]').count(), 0);
    assert.equal(await page.locator('#userResultCount').textContent(), 'Showing 0 of 3 users');
    await page.locator('#usageFilter').selectOption('recent');
    assert.equal(await page.locator('#userTableBody tr[data-uuid]').count(), 2);
    await page.locator('#usageFilter').selectOption('unknown');
    assert.equal(await page.locator('#userTableBody tr[data-uuid="unknown"]').count(), 1);
    await page.locator('#clearContactRange').click();
    assert.equal(await page.locator('#usageThreshold').inputValue(), '30');
    await page.locator('.au-advanced-filters summary').click();
    await page.locator('#contactLoginState').selectOption('logged_out');
    assert.equal(await page.locator('#userTableBody tr[data-uuid="old"]').count(), 1);
    assert.equal(await page.locator('#userTableBody tr[data-uuid="recent"]').count(), 0);
    await page.locator('#contactLoginState').selectOption('all');
    await page.locator('#contactFrom').fill('2026-11-18T23:59');
    await page.locator('#contactTo').fill('2026-11-18T23:59');
    assert.equal(await page.locator('#userTableBody tr[data-uuid]').count(), 1);
    await page.locator('#contactTimestampType').selectOption('lastLoginAt');
    assert.equal(await page.locator('#userTableBody tr[data-uuid]').count(), 0);
    await page.locator('#contactTimestampType').selectOption('lastContactAt');
    await page.locator('#userTableBody tr[data-uuid]').click();
    await page.waitForFunction(() => document.querySelector('#userMonitoringDetail ol').textContent.includes('Save 2D design'));
    await page.waitForFunction(() => document.querySelector('#userMonitoringDetail').textContent.includes('0 (not explicitly logged out)'));
    assert.equal(await page.locator('#userMonitoringDetail button').isVisible(), false);
    await page.screenshot({ path: 'tools/user-monitoring-desktop.png', fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'tools/user-monitoring-mobile.png', fullPage: true, animations: 'disabled' });
    await page.locator('#userBackToListBtn').click();
    await page.waitForFunction(() => {
      const detail = document.querySelector('#userDetail');
      return new DOMMatrix(getComputedStyle(detail).transform).m41 >= detail.offsetWidth - 1;
    });
    await page.screenshot({ path: 'tools/user-monitoring-mobile-list.png', fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    unavailable = true;
    await page.locator('#refreshUsersBtn').click();
    await page.waitForFunction(() => document.querySelector('#contactFrom').disabled);
    assert.equal(await page.locator('#userTableBody tr[data-uuid]').count(), 3);
    assert.equal(await page.locator('#contactFrom').inputValue(), '');
    dense = true;
    await page.setViewportSize({ width: 1652, height: 780 });
    await page.locator('.au-advanced-filters summary').click();
    await page.locator('#refreshUsersBtn').click();
    await page.waitForFunction(() => document.querySelector('#userResultCount').textContent === 'Showing 40 of 40 users');
    assert.ok((await page.locator('#userListWrap').boundingBox()).height >= 300);
    assert.equal(await page.locator('#userListWrap').evaluate(el => {
      el.scrollTop = 200;
      return el.scrollTop > 0;
    }), true);
    await page.screenshot({ path: 'tools/user-monitoring-results.png', fullPage: true, animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log('PASS: timestamp type/range, login-state filter, selected-user fetch, timeline, mobile layout and unavailable API fallback; no page errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
