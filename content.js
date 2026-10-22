// orgcs-remote: a keyboard "remote" for the OrgCS console, and Omni-Channel status changes sent from
// elsewhere through Satella's relay. Every command is listed in the Extensions menu and in
// Settings > Shortcuts, where its shortcut can be changed or removed. A shortcut another command
// already uses is not granted; the command stays in the menu.

const OMNI_STATUSES = [
  { id: 'omni-available-case', label: 'Available - Case', shortcut: 'Ctrl+Alt+1' },
  { id: 'omni-available-voice', label: 'Available - Voice', shortcut: 'Ctrl+Alt+2' },
  { id: 'omni-break', label: 'Break', shortcut: 'Ctrl+Alt+3' },
  { id: 'omni-lunch', label: 'Lunch', shortcut: 'Ctrl+Alt+4' },
  { id: 'omni-meeting', label: 'Meeting', shortcut: 'Ctrl+Alt+5' },
  { id: 'omni-research', label: 'Research' },
  { id: 'omni-screen-sharing', label: 'Screen Sharing' },
  { id: 'omni-project-support', label: 'Project / Pilot Support' },
  { id: 'omni-training', label: 'Training / Coaching' },
  { id: 'omni-end-of-work', label: 'End of Work' },
  { id: 'omni-offline', label: 'Offline', shortcut: 'Ctrl+Alt+0' },
];

const TAB_SELECTOR = '.tabsetHeader.slds-context-bar ul.tabBarItems > li.oneConsoleTabItem';

// ---- DOM helpers (native shadow roots or synthetic shadow) --------------

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const norm = text => (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
const visible = el => !!el && el.isConnected && el.getClientRects().length > 0;

async function waitUntil(check, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (check()) return true;
    await sleep(50);
  }
  return check();
}

function deepAll(root, selector) {
  const found = [];
  const queue = [root];
  while (queue.length) {
    const scope = queue.shift();
    found.push(...scope.querySelectorAll(selector));
    if (scope.shadowRoot) queue.push(scope.shadowRoot);
    for (const el of scope.querySelectorAll('*')) if (el.shadowRoot) queue.push(el.shadowRoot);
  }
  return found;
}

function deepText(node) {
  if (node.nodeType === 3) return node.data;
  if (node.nodeType !== 1 && node.nodeType !== 11) return '';
  if (node.nodeType === 1) {
    if (['style', 'script', 'template'].includes(node.localName)) return '';
    if (node.classList.contains('slds-assistive-text') || node.classList.contains('assistiveText')) return '';
  }
  let text = '';
  if (node.shadowRoot) for (const child of node.shadowRoot.childNodes) text += deepText(child);
  for (const child of node.childNodes) text += deepText(child);
  return text;
}

// The split view next to a case has its own list; prefer the main one when both are on screen.
function inSplitView(el) {
  for (let n = el; n; n = n.parentNode || n.host) if (n.id === 'split-left') return true;
  return false;
}

function pickOnScreen(elements) {
  const shown = elements.filter(visible);
  return shown.find(el => !inSplitView(el)) || shown[0] || null;
}

// A full press-and-release, for handlers that don't react to a bare click().
function press(el) {
  const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.click();
}

// ---- toast --------------------------------------------------------------

let toastNode = null;
let toastTimer = 0;

function toast(text, duration = 2200) {
  if (!toastNode) {
    toastNode = document.createElement('div');
    toastNode.setAttribute('role', 'status');
    toastNode.style.cssText =
      'position:fixed;left:50%;bottom:56px;transform:translateX(-50%);z-index:2147483647;' +
      'padding:8px 14px;border-radius:8px;background:#032d60;color:#fff;' +
      'font:13px -apple-system,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:none';
  }
  toastNode.textContent = text;
  document.body.append(toastNode);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastNode.remove(), duration);
}

// ---- Omni-Channel -------------------------------------------------------

function omniTrigger(widget) {
  const buttons = deepAll(widget, 'lightning-button-menu')
    .map(menu => (menu.shadowRoot || menu).querySelector('button'))
    .filter(Boolean);
  return buttons.find(b => /status/i.test(b.getAttribute('aria-label') || b.title || b.textContent)) || buttons[0] || null;
}

function omniItem(widget, label) {
  const host = deepAll(widget, 'lightning-menu-item').find(el => norm(deepText(el)) === norm(label));
  return host ? (host.shadowRoot || host).querySelector('a, [role="menuitem"]') || host : null;
}

// The status checked in the open menu, spelled as in OMNI_STATUSES; '' when none is.
function checkedStatus(widget) {
  const host = deepAll(widget, 'lightning-menu-item')
    .find(el => ((el.shadowRoot || el).querySelector('a, [role="menuitem"]') || el).getAttribute('aria-checked') === 'true');
  if (!host) return '';
  const text = deepText(host).replace(/\s+/g, ' ').trim();
  return OMNI_STATUSES.find(s => norm(s.label) === norm(text))?.label || text;
}

// Returns { ok, message, was } (was: the status before), plus missing: true when this page has no
// Omni-Channel widget. With onlyIf, it changes nothing (skipped: true) unless the status is onlyIf now.
async function setOmniStatus(label, { onlyIf } = {}) {
  const widgets = deepAll(document, 'omni-widget2-header');
  const widget = widgets.find(visible) || widgets[0];
  const trigger = widget && omniTrigger(widget);
  if (!trigger) return { ok: false, missing: true, message: 'Omni-Channel isn’t loaded on this page. Open it once, then try again.' };

  const closeMenu = () => { if (trigger.getAttribute('aria-expanded') === 'true') trigger.click(); };
  if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();

  // With the Omni-Channel sidebar collapsed the menu never shows, so don't wait long for it.
  let item = null;
  await waitUntil(() => visible(item = omniItem(widget, label)), visible(trigger) ? 1500 : 300);
  if (!item) {
    closeMenu();
    return { ok: false, message: `There is no “${label}” status in your Omni-Channel menu.` };
  }
  const was = checkedStatus(widget);
  if (onlyIf !== undefined && norm(was) !== norm(onlyIf)) {
    closeMenu();
    return { ok: false, skipped: true, was, message: `Omni-Channel is ${was || 'on another status'} now, so it was left as is.` };
  }
  if (item.getAttribute('aria-checked') === 'true') {
    closeMenu();
    return { ok: true, was, message: `Omni-Channel is already ${label}.` };
  }
  item.click();
  return { ok: true, was, message: `Omni-Channel: ${label}` };
}

// ---- list view ----------------------------------------------------------

function refreshList() {
  const button = pickOnScreen(
    deepAll(document, 'lightning-button-icon.forceRefreshButton')
      .map(host => (host.shadowRoot || host).querySelector('button'))
      .filter(Boolean),
  );
  if (!button) return toast('No list view on screen.');
  button.click();
  toast('Refreshing list…');
}

function searchList() {
  const input = pickOnScreen(
    deepAll(document, 'force-list-view-manager-search-bar').flatMap(host => deepAll(host, 'input')),
  );
  if (!input) return toast('No list view on screen.');
  input.focus();
  input.select();
}

// ---- console tabs -------------------------------------------------------

function closeTab() {
  const active = [...document.querySelectorAll(TAB_SELECTOR)].find(li =>
    li.classList.contains('slds-is-active') ||
    li.querySelector('a.tabHeader')?.getAttribute('aria-selected') === 'true');
  const button = active?.querySelector('.close button');
  if (!button) return toast('No case tab is open.');
  // A tab with unsaved changes asks first; Salesforce handles that prompt.
  press(button);
}

// ---- remote control over Satella ----------------------------------------
// Commands arrive on a Satella relay channel (satella.js; client/remote.js and client/remote.html send
// them). Every subscriber can write to a relay channel, so only senders whose proven key is under
// Linked devices count. Each person links their own devices with a one-time code (Link a device), so
// nobody manages anyone else's PC.

const IDENTITY_KEY = 'satellaIdentity';
const PLAYER_KEY = /^[0-9a-f]{64}$/;

const remote = { client: null, channel: '', key: '', trusted: new Set(), ignored: new Set(), state: 'off', detail: '' };
let remoteGeneration = 0;
let remoteRestartTimer = 0;

const parseKeys = text => new Set(String(text || '').toLowerCase().split(/[\s,;]+/).filter(k => PLAYER_KEY.test(k)));

async function remoteIdentity() {
  const read = async () => {
    try { return JSON.parse(await satellite.storage.get(IDENTITY_KEY)); } catch (e) { return null; }
  };
  let jwk = await read();
  if (!jwk?.d || !jwk?.x) {
    await satellite.storage.set(IDENTITY_KEY, JSON.stringify(await SatellaClient.createIdentity()));
    jwk = await read(); // another OrgCS page may have made one at the same moment
  }
  return SatellaClient.loadIdentity(jwk);
}

// A private channel name the first time, saved so remote.js can be given the same one.
async function remoteChannel() {
  let channel = String((await satellite.settings.get('remoteChannel')) || '').trim();
  if (!channel) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    channel = 'orgcs-remote.' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    await satellite.settings.set('remoteChannel', channel);
  }
  return channel;
}

function setRemoteState(state, detail = '') {
  const was = remote.state;
  remote.state = state;
  remote.detail = detail;
  if (state === 'online') {
    console.log(`[orgcs-remote] Satella: listening on “${remote.channel}” as ${remote.key}`);
    if (!detail) console.warn('[orgcs-remote] Satella did not accept this page’s key; replies won’t say who sent them.');
  } else if (state === 'offline' && was !== 'offline') {
    // Logged once per outage: the client keeps retrying, up to once a minute.
    console.warn(`[orgcs-remote] Satella: offline (${detail}); retrying.`);
  } else if (state === 'blocked') {
    console.warn(`[orgcs-remote] The OrgCS page’s Content Security Policy (${detail}) blocks connections to ` +
      `${SatellaClient.HOST}, so the browser stopped the connection before it reached Satella. Not retrying.`);
  }
}

// Salesforce's Content Security Policy can block the connection in the browser, which only shows up as
// "connection closed (1006)". The browser reports the block as an event on the page, so say that instead,
// and stop: retrying can't work until the page reloads, and each try sends Salesforce a violation report.
document.addEventListener('securitypolicyviolation', event => {
  if (!String(event.blockedURI).startsWith(SatellaClient.HOST) || remote.state === 'blocked') return;
  remote.client?.stop();
  setRemoteState('blocked', event.effectiveDirective || event.violatedDirective || 'connect-src');
});

async function startRemote() {
  const generation = ++remoteGeneration;
  if (linking) endLinking('Linking stopped because the remote connection restarted. Choose Link a device again.');
  remote.client?.stop();
  remote.client = null;
  const settings = await satellite.settings.getAll();
  remote.trusted = parseKeys(settings.remoteTrustedKeys);
  if (!settings.remoteEnabled) return setRemoteState('off');
  if (remote.state === 'blocked') return; // the same policy applies until the page reloads

  const [identity, channel] = await Promise.all([remoteIdentity(), remoteChannel()]);
  if (generation !== remoteGeneration) return; // settings changed meanwhile; a newer start runs
  remote.key = identity.publicKey;
  remote.channel = channel;
  if (!SatellaClient.isChannelId(channel)) {
    console.warn(`[orgcs-remote] “${channel}” isn’t a valid Satella channel: use letters, digits, “.”, “_” and “-”.`);
    return setRemoteState('off', 'invalid channel');
  }
  remote.client = new SatellaClient.Client({
    identity,
    channels: [channel],
    onRelay: onRemoteMessage,
    onState: (state, detail) => { if (generation === remoteGeneration) setRemoteState(state, detail); },
  });
  remote.client.start();
}

// { "type": "set-status", "status": "Break", "id": "…" }, or just the status as plain text.
function onRemoteMessage({ channel, sender, text }) {
  if (sender && sender === remote.key) return; // our own replies come back too
  if (channel !== remote.channel) {
    onLinkRequest({ channel, sender, text }).catch(e => console.error('[orgcs-remote] linking', e));
    return;
  }
  let message;
  try { message = JSON.parse(text); } catch (e) { message = { type: 'set-status', status: text }; }
  if (message?.type === 'list-statuses') { // remote.html asks for its buttons
    if (!sender || !remote.trusted.has(sender)) return;
    const reply = { type: 'statuses', id: message.id ?? null, statuses: OMNI_STATUSES.map(s => s.label) };
    remote.client?.send(remote.channel, JSON.stringify(reply));
    return;
  }
  if (!message || message.type !== 'set-status' || typeof message.status !== 'string') return;
  const status = message.status.trim().slice(0, 80);

  if (!sender || !remote.trusted.has(sender)) {
    const who = sender || 'unverified';
    if (!remote.ignored.has(who)) {
      remote.ignored.add(who);
      console.log(`[orgcs-remote] Ignored remote “${status}” from ${sender ? `key ${sender}` : 'a sender without a proven key'}.` +
        (sender ? ' To allow that device, link it with Link a device.' : ''));
    }
    return;
  }

  exclusive(async () => {
    const result = await setOmniStatus(status);
    if (result.missing) return; // an OrgCS page with Omni-Channel on it answers instead
    toast(`${result.message} (remote)`);
    const reply = { type: 'status-result', id: message.id ?? null, ok: result.ok, status, message: result.message };
    remote.client?.send(remote.channel, JSON.stringify(reply));
  });
}

function showRemote() {
  const text = {
    off: 'Remote control is off. Turn it on in Settings > Extensions > orgcs-remote.',
    connecting: 'Connecting to Satella…',
    offline: `Satella is unreachable (${remote.detail}). Retrying.`,
    blocked: `The OrgCS page’s security policy (${remote.detail}) blocks ${SatellaClient.HOST}, so the connection never reaches Satella.`,
    online: `Listening on ${remote.channel} · ${remote.trusted.size} linked device(s)`,
  }[remote.state];
  console.log('[orgcs-remote]', text, `· key ${remote.key || 'none yet'}`);
  toast(text, 6000);
}

// ---- linking a device with a code ---------------------------------------
// Link a device shows a one-time code. remote.js proves it knows the code on the code's lobby channel
// (SatellaClient.link); the page then trusts that device's key and tells it the private channel. A code
// links one device, lasts five minutes, and three wrong tries end it.

const LINK_TTL = 5 * 60 * 1000;
const LINK_TRIES = 3;
let linking = null; // { code, lobby, client, channel, key, wrong, expires, panel, timer }

const deviceName = text => String(text || '').replace(/[^\w .'-]/g, '').trim().slice(0, 32); // never a key

async function startLinking() {
  const client = remote.client;
  if (remote.state === 'blocked') return showRemote();
  if (!client) return toast('Turn on Accept remote status changes in Settings > Extensions > orgcs-remote first.', 5000);
  if (remote.state === 'offline') return toast(`Can’t reach Satella: ${remote.detail}. It keeps retrying.`, 6000);
  if (!client.online) return toast('Still connecting to Satella. Try again in a moment.', 4000);
  if (linking) endLinking();
  const code = SatellaClient.link.newCode();
  const offer = { code, lobby: SatellaClient.link.lobby(code), client, channel: remote.channel, key: remote.key, wrong: 0, expires: Date.now() + LINK_TTL };
  linking = offer;
  if (!(await client.subscribe(offer.lobby))) {
    if (linking === offer) endLinking('Satella didn’t open the linking channel. Try again.');
    return;
  }
  if (linking !== offer) return;
  showLinkPanel(offer);
  console.log(`[orgcs-remote] Offering a link code on “${offer.lobby}” for five minutes.`);
}

function endLinking(message) {
  const offer = linking;
  if (!offer) return;
  linking = null;
  clearInterval(offer.timer);
  offer.panel?.remove();
  offer.client.unsubscribe(offer.lobby);
  if (message) toast(message, 6000);
}

function showLinkPanel(offer) {
  const panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Link a device');
  panel.style.cssText =
    'position:fixed;right:24px;bottom:56px;z-index:2147483647;width:300px;padding:14px 16px;border-radius:10px;' +
    'background:#032d60;color:#fff;font:13px -apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3)';
  const line = (text, css) => {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = css;
    panel.append(el);
    return el;
  };
  line('Link a device', 'font-weight:600');
  line(SatellaClient.link.format(offer.code), 'margin:6px 0;font:600 28px ui-monospace,Menlo,monospace;letter-spacing:2px;user-select:all');
  line('Type it in OrgCS Remote (client/remote.html) on the device you want to link, or run:', 'opacity:.85');
  line(`node remote.js link ${offer.code}`, 'margin:4px 0 10px;font:12px ui-monospace,Menlo,monospace;user-select:all');
  const footer = line('', 'display:flex;align-items:center;justify-content:space-between');
  const countdown = document.createElement('span');
  countdown.style.opacity = '.85';
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.style.cssText = 'padding:3px 10px;border:1px solid #fff;border-radius:6px;background:transparent;color:#fff;font:inherit;cursor:pointer';
  cancel.addEventListener('click', () => { if (linking === offer) endLinking(); });
  footer.append(countdown, cancel);

  const tick = () => {
    const left = Math.max(0, Math.ceil((offer.expires - Date.now()) / 1000));
    countdown.textContent = `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (!left && linking === offer) endLinking('The link code expired. Choose Link a device for a new one.');
  };
  offer.panel = panel;
  offer.timer = setInterval(tick, 1000);
  tick();
  document.body.append(panel);
}

// { "type": "link-request", "name": "…", "proof": "…" } on the lobby channel.
async function onLinkRequest({ channel, sender, text }) {
  const offer = linking;
  if (!offer || channel !== offer.lobby || !sender) return; // a device must prove its key to link
  let request;
  try { request = JSON.parse(text); } catch (e) { return; }
  if (request?.type !== 'link-request' || typeof request.proof !== 'string') return;
  const reply = result => offer.client.send(offer.lobby, JSON.stringify({ type: 'link-result', to: sender, ...result }));

  // Another person's device can land in the same lobby too; it counts as a wrong try here.
  const right = request.proof === await SatellaClient.link.proof(offer.code, 'request', sender);
  if (linking !== offer) return; // linked, cancelled or expired meanwhile
  if (!right) {
    offer.wrong++;
    console.log(`[orgcs-remote] Wrong link code from key ${sender} (${offer.wrong} of ${LINK_TRIES}).`);
    reply({ ok: false, message: 'Wrong code. Check the code shown on your PC.' });
    if (offer.wrong >= LINK_TRIES) endLinking(`Linking stopped after ${LINK_TRIES} wrong codes. Choose Link a device for a new one.`);
    return;
  }

  endLinking(); // one device per code
  const name = deviceName(request.name);
  await linkDevice(sender, name);
  const proof = await SatellaClient.link.proof(offer.code, 'accept', sender, offer.key, offer.channel);
  reply({ ok: true, channel: offer.channel, proof, message: 'Linked. This device can change your Omni-Channel status now.' });
  console.log(`[orgcs-remote] Linked ${name || 'a device'} (key ${sender}).`);
  toast(`Linked ${name ? `“${name}”` : 'a device'}. It can change your Omni-Channel status now.`, 6000);
}

// Adds "<key> (<name>)" to Linked devices; deleting it there unlinks the device.
async function linkDevice(key, name) {
  remote.trusted.add(key);
  remote.ignored.delete(key);
  const current = String((await satellite.settings.get('remoteTrustedKeys')) || '').trim();
  if (parseKeys(current).has(key)) return;
  const entry = name ? `${key} (${name})` : key;
  await satellite.settings.set('remoteTrustedKeys', current ? `${current}, ${entry}` : entry);
}

// ---- scheduled statuses -------------------------------------------------
// Time windows that set your Omni-Channel status, e.g. Mon–Fri 12:00–13:00 Lunch, then back to what it
// was. They run in local time while an OrgCS page with Omni-Channel is open: a window that started while
// none was open still applies until it ends, and a start or end without a window applies up to 15
// minutes late. Edited in a panel (Schedule statuses) and kept in storage.

const SCHEDULE_KEY = 'schedule';
const SCHEDULE_LOG_KEY = 'scheduleLog'; // today's done events and the status before each window
const SCHEDULE_TICK = 20000;
const SCHEDULE_GRACE = 15; // minutes
const PREVIOUS = ''; // afterwards: go back to the status before the window
const KEEP = 'keep'; // afterwards: leave it
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const scheduleNow = () => new Date();
const toMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const weekday = date => (date.getDay() + 6) % 7 + 1; // 1 = Monday … 7 = Sunday
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const validRule = r => !!r && typeof r.id === 'string' && Array.isArray(r.days) && typeof r.status === 'string' &&
  TIME.test(r.start) && (!r.end || (TIME.test(r.end) && r.end > r.start));

async function loadSchedule() {
  let rules = [];
  try { rules = JSON.parse(await satellite.storage.get(SCHEDULE_KEY)) || []; } catch (e) { /* none yet */ }
  return Array.isArray(rules) ? rules.filter(validRule) : [];
}

async function readScheduleLog(today) {
  let log = null;
  try { log = JSON.parse(await satellite.storage.get(SCHEDULE_LOG_KEY)); } catch (e) { /* none yet */ }
  return log?.day === today ? log : { day: today, done: {}, before: {} };
}

// One day's starts and ends, in order; an end comes before a start at the same minute. A window that
// ends as another starts has no end of its own, so back-to-back windows don't flick back in between.
function scheduleEvents(rules) {
  const events = [];
  for (const rule of rules) {
    const start = toMinutes(rule.start);
    const end = rule.end ? toMinutes(rule.end) : null;
    events.push({ rule, kind: 'start', at: start, until: end ?? start + SCHEDULE_GRACE });
    if (end !== null && rule.then !== KEEP && !rules.some(r => r !== rule && r.start === rule.end)) {
      events.push({ rule, kind: 'end', at: end, until: end + SCHEDULE_GRACE });
    }
  }
  return events.sort((a, b) => a.at - b.at || (a.kind === b.kind ? 0 : a.kind === 'end' ? -1 : 1));
}

// The next start or end within a week, e.g. "Lunch at 12:00 today".
function nextScheduled(rules, from = scheduleNow()) {
  const minute = from.getHours() * 60 + from.getMinutes();
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    const day = weekday(date);
    const event = scheduleEvents(rules.filter(r => r.on && r.days.includes(day))).find(e => offset > 0 || e.at > minute);
    if (!event) continue;
    const { rule, kind } = event;
    const what = kind === 'start' ? rule.status : rule.then === PREVIOUS ? `back from ${rule.status}` : rule.then;
    const when = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : DAY_NAMES[day - 1];
    return `${what} at ${kind === 'start' ? rule.start : rule.end} ${when}`;
  }
  return '';
}

function scheduleNote(text) {
  console.log('[orgcs-remote]', text);
  toast(text, 5000);
}

let scheduleRunning = false;

async function runSchedule() {
  if (scheduleRunning) return;
  scheduleRunning = true;
  try { await exclusive(scheduleStep); } finally { scheduleRunning = false; }
}

async function scheduleStep() {
  if (!deepAll(document, 'omni-widget2-header').length) return; // an OrgCS page with Omni-Channel runs it
  const now = scheduleNow();
  const today = dayKey(now);
  const minute = now.getHours() * 60 + now.getMinutes();
  const todays = (await loadSchedule()).filter(r => r.on && r.days.includes(weekday(now)));
  for (const event of scheduleEvents(todays)) {
    if (event.at > minute || minute >= event.until) continue;
    const log = await readScheduleLog(today);
    const key = `${event.rule.id}@${event.rule.start}-${event.rule.end}:${event.kind}`; // an edited window counts as new
    if (log.done[key]) continue;
    log.done[key] = true;
    await satellite.storage.set(SCHEDULE_LOG_KEY, JSON.stringify(log)); // claimed, so another OrgCS page skips it
    await fireScheduled(event, todays, log);
    await satellite.storage.set(SCHEDULE_LOG_KEY, JSON.stringify(log));
  }
}

async function fireScheduled({ rule, kind }, todays, log) {
  if (kind === 'start') {
    const result = await setOmniStatus(rule.status);
    scheduleNote(`Schedule: ${result.message}${result.ok && rule.end ? ` until ${rule.end}` : ''}`);
    if (!result.ok) return; // so its end leaves the status alone too
    // A window that starts as another ends takes over its "before", so a run of windows ends where it began.
    const handoff = todays.find(r => r !== rule && r.end === rule.start && r.id in log.before);
    log.before[rule.id] = handoff ? log.before[handoff.id] : result.was || '';
    return;
  }
  if (!(rule.id in log.before)) return; // its start didn't run today
  const target = rule.then === PREVIOUS ? log.before[rule.id] : rule.then;
  if (!target) return;
  const result = await setOmniStatus(target, { onlyIf: rule.status }); // unless you changed it meanwhile
  scheduleNote(`Schedule: ${result.message}`);
}

// ---- the schedule panel ----

let schedulePanel = null;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('aria-') || key === 'role') node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children);
  return node;
}

function choice(options, value) {
  const select = el('select', {}, ...options.map(([v, label]) => el('option', { value: v, textContent: label })));
  select.value = options.some(([v]) => v === value) ? value : options[0][0];
  return select;
}

function scheduleRow(rule, onRemove) {
  const labels = OMNI_STATUSES.map(s => [s.label, s.label]);
  const on = el('input', { type: 'checkbox', checked: rule.on, title: 'Use this window' });
  const days = DAY_NAMES.map((name, i) => {
    const day = el('button', { type: 'button', className: 'day', textContent: name, 'aria-pressed': String(rule.days.includes(i + 1)) });
    day.addEventListener('click', () => day.setAttribute('aria-pressed', String(day.getAttribute('aria-pressed') !== 'true')));
    return day;
  });
  const start = el('input', { type: 'time', value: rule.start, 'aria-label': 'From' });
  const end = el('input', { type: 'time', value: rule.end || '', 'aria-label': 'Until (optional)' });
  const status = choice(labels, rule.status);
  const then = choice([[PREVIOUS, 'Previous status'], [KEEP, 'Keep it'], ...labels], rule.then);
  const thenLabel = el('label', { className: 'then' }, 'Afterwards ', then);
  const remove = el('button', { type: 'button', className: 'plain', textContent: 'Remove' });
  remove.addEventListener('click', () => { row.remove(); onRemove(); });
  const sync = () => { thenLabel.hidden = !end.value; };
  end.addEventListener('input', sync);
  sync();

  const row = el('div', { className: 'row' },
    el('div', { className: 'line' }, on, el('span', { className: 'days' }, ...days)),
    el('div', { className: 'line' }, start, el('span', { textContent: '–' }), end, status),
    el('div', { className: 'line' }, thenLabel, el('span', { className: 'grow' }), remove));
  row.read = () => ({
    id: rule.id,
    on: on.checked,
    days: days.flatMap((d, i) => d.getAttribute('aria-pressed') === 'true' ? [i + 1] : []),
    start: start.value,
    end: end.value,
    status: status.value,
    then: end.value ? then.value : PREVIOUS,
  });
  return row;
}

const SCHEDULE_CSS = `
  .panel { width: 440px; max-height: 70vh; overflow: auto; padding: 14px 16px; border-radius: 10px; background: #fff; color: #181818;
    font: 13px -apple-system, BlinkMacSystemFont, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
  header, footer, .line { display: flex; align-items: center; gap: 8px; }
  header { justify-content: space-between; margin-bottom: 8px; }
  h2 { margin: 0; font-size: 15px; }
  .row { padding: 10px 0; border-top: 1px solid #e5e5e5; }
  .line + .line { margin-top: 6px; }
  .days { display: flex; gap: 3px; }
  .day { padding: 3px 6px; border: 1px solid #c9c9c9; border-radius: 5px; background: #fff; color: #444; font: inherit; cursor: pointer; }
  .day[aria-pressed="true"] { border-color: #0176d3; background: #0176d3; color: #fff; }
  input[type="time"], select { padding: 3px 5px; border: 1px solid #c9c9c9; border-radius: 5px; background: #fff; color: #181818; font: inherit; }
  select { flex: 1; min-width: 0; }
  .then { display: flex; align-items: center; gap: 6px; color: #5c5c5c; }
  .then[hidden] { display: none; }
  .grow { flex: 1; }
  button { font: inherit; cursor: pointer; }
  .plain { padding: 2px 0; border: 0; background: none; color: #0176d3; }
  .primary { padding: 5px 14px; border: 0; border-radius: 6px; background: #0176d3; color: #fff; font-weight: 600; }
  .secondary { padding: 5px 12px; border: 1px solid #c9c9c9; border-radius: 6px; background: #fff; color: #181818; }
  .note { margin: 10px 0 0; color: #5c5c5c; }
  .error { margin: 8px 0 0; color: #ba0517; }
  .error:empty { display: none; }
  footer { margin-top: 12px; justify-content: flex-end; }
  footer .note { flex: 1; margin: 0; }
`;

async function editSchedule() {
  if (schedulePanel) return;
  const rules = await loadSchedule();
  const host = el('div');
  host.style.cssText = 'position:fixed;right:24px;bottom:56px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' }); // keeps Salesforce's styles out
  const rows = el('div');
  const next = el('p', { className: 'note' });
  const error = el('p', { className: 'error', role: 'alert' });
  const read = () => [...rows.children].map(row => row.read());
  const refresh = () => {
    const upcoming = nextScheduled(read().filter(validRule));
    next.textContent = upcoming ? `Next: ${upcoming}.` : 'Nothing scheduled.';
  };
  const addRow = rule => rows.append(scheduleRow(rule, refresh));
  const close = () => { host.remove(); schedulePanel = null; };

  const add = el('button', { type: 'button', className: 'plain', textContent: '+ Add a window' });
  add.addEventListener('click', () => {
    addRow({ id: crypto.randomUUID(), on: true, days: [1, 2, 3, 4, 5], start: '12:00', end: '13:00', status: 'Lunch', then: PREVIOUS });
    refresh();
  });
  const cancel = el('button', { type: 'button', className: 'secondary', textContent: 'Cancel' });
  cancel.addEventListener('click', close);
  const closeX = el('button', { type: 'button', className: 'plain', textContent: 'Close', 'aria-label': 'Close' });
  closeX.addEventListener('click', close);
  const save = el('button', { type: 'button', className: 'primary', textContent: 'Save' });
  save.addEventListener('click', async () => {
    const edited = read();
    const problem =
      edited.some(r => !r.days.length) ? 'Pick at least one day for each window.' :
      edited.some(r => !TIME.test(r.start)) ? 'Each window needs a start time.' :
      edited.some(r => r.end && r.end <= r.start) ? 'A window has to end after it starts, on the same day. Split one that crosses midnight in two.' : '';
    error.textContent = problem;
    if (problem) return;
    await satellite.storage.set(SCHEDULE_KEY, JSON.stringify(edited));
    close();
    const upcoming = nextScheduled(edited);
    scheduleNote(upcoming ? `Schedule saved. Next: ${upcoming}.` : 'Schedule saved. Nothing is scheduled.');
    runSchedule(); // a window you're in now applies right away
  });

  root.append(
    el('style', { textContent: SCHEDULE_CSS }),
    el('div', { className: 'panel', role: 'dialog', 'aria-label': 'Scheduled statuses' },
      el('header', {}, el('h2', { textContent: 'Scheduled statuses' }), closeX),
      rows, add, next, error,
      el('footer', {}, el('p', { className: 'note', textContent: 'Runs while the OrgCS console is open.' }), cancel, save)));
  root.addEventListener('input', refresh);
  root.addEventListener('click', refresh);
  for (const rule of rules) addRow(rule);
  refresh();
  schedulePanel = host;
  document.body.append(host);
}

// ---- commands -----------------------------------------------------------

// Satellite lets an extension register at most 12 commands, listed in this order; these are 12. Only the
// statuses with a shortcut get one; the others are set from the Omni-Channel menu, a schedule, OrgCS
// Remote or remote.js.
const COMMANDS = [
  { id: 'link-device', title: 'Link a device', run: startLinking },
  { id: 'schedule', title: 'Schedule statuses', run: editSchedule },
  { id: 'remote-info', title: 'Show remote connection', run: showRemote },
  { id: 'close-tab', title: 'Close case tab', shortcut: 'Ctrl+Alt+W', run: closeTab },
  { id: 'refresh-list', title: 'Refresh list view', shortcut: 'Ctrl+Alt+R', run: refreshList },
  { id: 'search-list', title: 'Search this list', shortcut: 'Ctrl+Alt+F', run: searchList },
  ...OMNI_STATUSES.filter(s => s.shortcut).map(({ id, label, shortcut }) =>
    ({ id, title: `Omni-Channel: ${label}`, shortcut, run: async () => toast((await setOmniStatus(label)).message) })),
];

// One command at a time, from the keyboard or remote: a status change takes a moment to open the menu.
let commandQueue = Promise.resolve();

function exclusive(task) {
  const run = commandQueue.then(task);
  commandQueue = run.catch(e => console.error('[orgcs-remote]', e));
  return run;
}

function runCommand(command) {
  exclusive(command.run).catch(() => toast(`${command.title} didn’t work. See Settings > Extensions > Logs.`));
}

if (window.top === window) {
  // Version 0.3 and earlier also registered the statuses without a shortcut; free those slots.
  await Promise.all(OMNI_STATUSES.filter(s => !s.shortcut).map(({ id }) => satellite.shortcuts.unregister(id).catch(() => {})));
  const granted = await Promise.all(COMMANDS.map(command => {
    const { id, title, shortcut } = command;
    return satellite.shortcuts.register(shortcut ? { id, title, shortcut } : { id, title }, () => runCommand(command))
      .catch(e => console.error('[orgcs-remote] could not register', id, e));
  }));
  for (const s of granted) {
    if (s && s.requested && !s.shortcut && s.conflict) {
      console.log(`[orgcs-remote] ${s.title}: ${s.requested} is used by “${s.conflict}”. Pick another in Settings > Shortcuts.`);
    }
  }

  satellite.settings.onChange((key, value) => {
    if (key === 'remoteTrustedKeys') {
      remote.trusted = parseKeys(value);
      remote.ignored.clear();
    } else if (key === 'remoteEnabled' || key === 'remoteChannel') {
      clearTimeout(remoteRestartTimer);
      remoteRestartTimer = setTimeout(async () => {
        // Saving the generated channel lands here too; keep that connection.
        const { remoteEnabled, remoteChannel } = await satellite.settings.getAll();
        if (remote.client && remoteEnabled && String(remoteChannel).trim() === remote.channel) return;
        startRemote().catch(e => console.error('[orgcs-remote]', e));
      }, 500);
    }
  });
  startRemote().catch(e => console.error('[orgcs-remote] remote control', e));
  setInterval(() => runSchedule().catch(e => console.error('[orgcs-remote] schedule', e)), SCHEDULE_TICK);
  runSchedule().catch(e => console.error('[orgcs-remote] schedule', e));
}
