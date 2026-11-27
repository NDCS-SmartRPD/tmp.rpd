import { apiPost } from '../shared/api.js';

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFormat = new Intl.DateTimeFormat('en-SG', {
  timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short',
});

export function formatMonitoringTime(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Not recorded';
  return `${timeFormat.format(new Date(value))} SGT`;
}

export function inContactRange(value, from, to) {
  if (from && to && from > to) return false;
  if (!from && !to) return true;
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return false;
  if (from.includes('T') || to.includes('T')) {
    const lower = from ? new Date(`${from}:00+08:00`).getTime() : -Infinity;
    const upper = to ? new Date(`${to}:00+08:00`).getTime() + 59999 : Infinity;
    return date.getTime() >= lower && date.getTime() <= upper;
  }
  const day = dayFormat.format(date);
  return (!from || day >= from) && (!to || day <= to);
}

export const loginStateLabels = {
  logged_out: 'Logged out', within_timeout: 'Within login timeout',
  timed_out: 'Login timed out', unknown: 'Not recorded',
};

export const usageLabels = { recent: 'Recently active', inactive: 'Inactive', unknown: 'Unknown' };

export function communicationUsage(value, days = 30, now = Date.now()) {
  const timestamp = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now) {
    return { status: 'unknown', ageLabel: 'No reliable communication timestamp' };
  }
  const elapsed = now - timestamp;
  const ageDays = Math.floor(elapsed / 86400000);
  return { status: elapsed <= Number(days) * 86400000 ? 'recent' : 'inactive',
    ageLabel: ageDays === 0 ? 'Less than a day ago' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago` };
}

export function updateUsageDetail() {
  const element = document.getElementById('userUsageSummary');
  if (!element || element.dataset.available !== 'true') return;
  const days = document.getElementById('usageThreshold').value;
  const usage = communicationUsage(element.dataset.contact, days);
  element.textContent = `Communication usage (${days}-day threshold): ${usageLabels[usage.status]} · ${usage.ageLabel}`;
}

export function formatUsage(value, days) {
  const usage = communicationUsage(value, days);
  return `${usageLabels[usage.status]} · ${usage.ageLabel}`;
}

export function matchesMonitoring(user, field, from, to, state) {
  return (state === 'all' || (user.loginState || 'unknown') === state) &&
    inContactRange(user[field], from, to);
}

export async function loadMonitoring() {
  const users = new Map();
  let after = '';
  do {
    const page = await apiPost('user/monitoring/getall', { after });
    for (const user of page.users) users.set(user.uuid, user);
    if (page.nextCursor && page.nextCursor <= after) throw new Error('Invalid monitoring cursor');
    after = page.nextCursor;
  } while (after);
  return users;
}

let selectedRequest = 0;
export function showUserMonitoring(user) {
  const request = ++selectedRequest;
  const root = document.getElementById('userMonitoringDetail');
  root.replaceChildren();
  const add = (tag, text) => {
    const el = document.createElement(tag);
    el.textContent = text;
    root.append(el);
    return el;
  };
  add('h3', 'Communication details');
  const login = add('p', 'Last successful login: Loading…');
  const contact = add('p', 'Last API contact: Loading…');
  const usage = add('p', 'Communication usage: Loading…');
  usage.id = 'userUsageSummary';
  const flag = add('p', 'Logged-out flag: Loading…');
  const state = add('p', 'Login state: Loading…');
  void apiPost('user/monitoring/get', { targetUserUuid: user.uuid }).then(({ user: fresh }) => {
    if (request !== selectedRequest) return;
    login.textContent = `Last successful login: ${formatMonitoringTime(fresh?.lastLoginAt)}`;
    contact.textContent = `Last API contact: ${formatMonitoringTime(fresh?.lastContactAt)}`;
    usage.dataset.available = 'true';
    usage.dataset.contact = fresh?.lastContactAt || '';
    updateUsageDetail();
    flag.textContent = `Logged-out flag: ${fresh?.loggedOut === true ? '1 (logged out)' : fresh?.loggedOut === false ? '0 (not explicitly logged out)' : 'Not recorded'}`;
    state.textContent = `Login state: ${loginStateLabels[fresh?.loginState] || loginStateLabels.unknown}`;
  }).catch(() => {
    if (request !== selectedRequest) return;
    for (const element of [login, contact, usage, flag, state]) element.textContent = `${element.textContent.split(':')[0]}: Unavailable`;
  });
  add('p', 'API contact includes login, logout and supported API calls; it does not indicate that the user is online. Dates shown in SGT.');
  const activityButton = add('button', 'View user activity');
  activityButton.type = 'button';
  activityButton.className = 'cm-btn cm-btn-secondary';
  activityButton.addEventListener('click', () => {
    document.getElementById('activityUserSelect').value = user.uuid;
    switchUserView('activity');
    document.getElementById('activityUserSelect').focus();
  });
}

let activityRequest = 0;
function switchUserView(view) {
  const activity = view === 'activity';
  const page = document.querySelector('.au-page');
  page.classList.toggle('is-activity', activity);
  page.classList.remove('show-details');
  for (const name of ['Overview', 'Activity']) {
    const selected = (name === 'Activity') === activity;
    const tab = document.getElementById(`user${name}Tab`);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(`user${name}Panel`).hidden = !selected;
  }
  if (activity) showUserActivity();
  else activityRequest++; // Ignore results arriving after leaving the activity view.
}

export function setActivityUsers(users) {
  const select = document.getElementById('activityUserSelect');
  const previous = select.value;
  select.replaceChildren(new Option('Select a user', ''));
  for (const user of [...users].sort((a, b) => a.username.localeCompare(b.username))) {
    select.add(new Option(`${user.username || user.uuid}${user.email ? ` (${user.email})` : ''}${user.deleted ? ' — Deactivated' : ''}`, user.uuid));
  }
  select.value = previous;
}

export function initUserViews() {
  const tabs = ['userOverviewTab', 'userActivityTab'].map(id => document.getElementById(id));
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => switchUserView(index ? 'activity' : 'overview'));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
      tabs[next].focus();
      switchUserView(next ? 'activity' : 'overview');
    });
  });
  document.getElementById('activityUserSelect').addEventListener('change', showUserActivity);
  document.getElementById('refreshUserActivity').addEventListener('click', showUserActivity);
}

function showUserActivity() {
  const request = ++activityRequest;
  const uuid = document.getElementById('activityUserSelect').value;
  const root = document.getElementById('userActivityTimeline');
  root.replaceChildren();
  const add = (tag, text) => {
    const el = document.createElement(tag);
    el.textContent = text;
    root.append(el);
    return el;
  };
  if (!uuid) { add('p', 'Select a user to view their activity.'); return; }
  add('h3', document.getElementById('activityUserSelect').selectedOptions[0].textContent);
  add('h3', 'Actions performed across cases');
  const status = add('p', 'Loading activity…');
  status.setAttribute('role', 'status');
  const list = add('ol', '');
  const more = add('button', 'Load older activity');
  more.type = 'button';
  more.className = 'cm-btn cm-btn-secondary';
  more.hidden = true;
  let before = null;
  let loaded = 0;
  const count = add('p', '0 activity entries loaded');
  async function load() {
    more.disabled = true;
    status.textContent = 'Loading activity…';
    try {
      const page = await apiPost('user/activity/get', { targetUserUuid: uuid, before });
      if (request !== activityRequest) return;
      for (const event of page.events) {
        const item = document.createElement('li');
        const title = document.createElement('strong');
        title.textContent = event.action;
        const detail = document.createElement('p');
        detail.textContent = [formatMonitoringTime(event.occurredAt),
          `Case #${event.caseId}${event.caseLabel ? ` (${event.caseLabel})` : ''}`,
          event.source === 'browser' ? 'Browser reported' : 'Server recorded',
          event.outcome, event.jaw ? `${event.jaw} jaw` : '',
          event.unchanged === true ? 'Saved without changes' : '',
          ...(event.changedFields || []),
        ].filter(Boolean).join(' · ');
        item.append(title, detail);
        list.append(item);
      }
      loaded += page.events.length;
      count.textContent = `${loaded} activity ${loaded === 1 ? 'entry' : 'entries'} loaded`;
      before = page.nextCursor;
      more.textContent = 'Load older activity';
      more.hidden = !before;
      status.textContent = list.children.length ? '' : 'No recorded activity. Tracking began at rollout; older and uninstrumented actions are not available.';
    } catch (error) {
      if (request !== activityRequest) return;
      if (error.status === 401 || error.status === 403) {
        list.replaceChildren();
        count.textContent = 'Activity unavailable';
        more.hidden = true;
        status.textContent = 'Administrator access is required. Sign in again.';
      } else {
        status.textContent = 'Activity is unavailable. Check the API deployment and activity migration.';
        more.hidden = false;
        more.textContent = 'Try again';
      }
    } finally {
      more.disabled = false;
    }
  }
  more.addEventListener('click', load);
  void load();
}
