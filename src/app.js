import './style.css';
import { createIcons, LayoutDashboard, Bookmark, ChartNoAxesCombined, Sparkles, ChevronRight, CircleHelp, RefreshCw, CalendarDays, ChevronDown, SlidersHorizontal, Search, LockKeyhole, Ban, Info, ArrowUpRight, ShieldCheck, WandSparkles, ArrowRight, Copy, Download, X, Check } from 'lucide';
import { SLOTS, playerProblem, slateProblem } from './optimizer.js';

const icons = { LayoutDashboard, Bookmark, ChartNoAxesCombined, Sparkles, ChevronRight, CircleHelp, RefreshCw, CalendarDays, ChevronDown, SlidersHorizontal, Search, LockKeyhole, Ban, Info, ArrowUpRight, ShieldCheck, WandSparkles, ArrowRight, Copy, Download, X, Check };
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = name => `<i data-lucide="${name}"></i>`;
const drawIcons = () => createIcons({ icons });
const number = value => Number.isFinite(value) ? value.toFixed(1) : '—';
const time = value => new Date(value).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
const dateLabel = value => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
const readSaved = () => { try { const data = JSON.parse(localStorage.getItem('slatelab-lineups-v1') || '[]'); return Array.isArray(data) ? data.slice(0, 30) : []; } catch { return []; } };
const state = { catalog: null, slate: null, loading: false, busy: false, locked: new Set(), excluded: new Set(), result: null, game: 'ALL', position: 'ALL', sort: 'projection', direction: -1, settings: { minMinutes: 24, startersOnly: true, maxNewPlayers: 2 } };
let toastTimer, worker, workerTimer, generation = 0, loadGeneration = 0;

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}
function message(text, error = false) {
  $('lineup-message').textContent = text;
  $('lineup-message').classList.toggle('error', error);
}
function invalidate(text = 'Settings changed. Generate a new lineup.') {
  generation++; clearTimeout(workerTimer); worker?.terminate(); worker = null; state.busy = false; state.result = null;
  renderLineup(); message(text); updateStatus();
}
function settings() { return { ...state.settings, locked: [...state.locked], excluded: [...state.excluded] }; }
function showModal(title, html) {
  $('modal-title').textContent = title; $('modal-content').innerHTML = html;
  if (!$('modal').open) $('modal').showModal();
  drawIcons();
}
function updateStatus() {
  const problem = slateProblem(state.slate);
  const failed = state.catalog?.status === 'refresh_failed';
  const warning = problem || (failed ? 'The last automatic refresh failed. Showing the previous snapshot; check its time before using it.' : '');
  $('notice').hidden = !warning; $('notice').textContent = warning; $('notice').classList.toggle('error', !!problem);
  $('generate').disabled = !!problem || state.loading || state.busy;
  $('generate').innerHTML = state.busy ? `${icon('refresh-cw')}Building your lineup…` : `${icon('wand-sparkles')}Generate lineup${icon('arrow-right')}`;
  if (state.busy) $('generate').querySelector('i')?.classList.add('spin');
  $('top-status').textContent = state.loading ? 'Loading slate' : problem ? 'Check slate status' : 'Slate ready';
  $('refresh').disabled = state.loading;
  $('slate-select').disabled = state.loading;
  if (state.slate) {
    const age = Math.max(0, Math.floor((Date.now() - Date.parse(state.slate.updatedAt)) / 60000));
    $('freshness').textContent = `Snapshot ${age < 1 ? 'just updated' : `${age} min ago`} · ${time(state.slate.updatedAt)} PT`;
    $('footer-update').textContent = `Scheduled checks every 15 min · delays possible`;
  }
  if (problem && state.result) invalidateResultOnly(problem);
  drawIcons();
}
function invalidateResultOnly(problem) {
  state.result = null; renderLineup(); message(problem, true);
}
async function getData(file) {
  if (!/^(catalog|\d{4}-\d{2}-\d{2}-\d+)\.json$/.test(file)) throw new Error('Invalid published data path.');
  const url = new URL(`data/${file}`, document.baseURI); url.searchParams.set('v', Date.now());
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Published data is unavailable (${response.status}). Try Refresh data in a moment.`);
  return response.json();
}
async function loadData(id = state.slate?.id) {
  const request = ++loadGeneration;
  state.loading = true; invalidate('Loading the latest published data…'); updateStatus();
  try {
    const catalog = await getData('catalog.json');
    if (request !== loadGeneration) return;
    if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.slates)) throw new Error('The data format is not supported.');
    state.catalog = catalog;
    $('slate-select').innerHTML = catalog.slates.length ? catalog.slates.map(s => `<option value="${esc(s.seriesId)}">${esc(s.label)} · ${s.gameCount} games</option>`).join('') : '<option>No slate released yet</option>';
    const selected = catalog.slates.find(s => s.seriesId === id) || catalog.slates.find(s => Date.parse(s.firstTip) > Date.now()) || catalog.slates[0];
    if (!selected) {
      state.slate = null; renderGames(); renderPool();
      $('date-label').textContent = dateLabel(catalog.date);
      $('freshness').textContent = 'Waiting for today’s Yahoo slate';
      message(catalog.message || 'Today’s data is not ready. Scheduled checks continue automatically.');
      return;
    }
    const slate = await getData(selected.file);
    if (request !== loadGeneration) return;
    if (slate.schemaVersion !== 1 || slate.id !== selected.seriesId || !Array.isArray(slate.players) || !Array.isArray(slate.games)) throw new Error('Slate data could not be validated.');
    const changed = state.slate?.id !== slate.id || state.slate?.date !== slate.date;
    state.slate = slate; $('slate-select').value = slate.id;
    if (changed) { state.locked.clear(); state.excluded.clear(); state.game = 'ALL'; }
    $('date-label').textContent = dateLabel(slate.date);
    $('yahoo-link').href = `https://sports.yahoo.com/dailyfantasy/contest/${encodeURIComponent(slate.contestId)}`;
    renderGames(); renderPool(); renderLineup();
    message(slateProblem(slate) || 'Ready when you are. Review your lineup before entering.', !!slateProblem(slate));
  } catch (error) {
    state.slate = null; renderGames(); renderPool(); renderLineup();
    message(error.message, true); $('freshness').textContent = 'Data could not be loaded';
    $('notice').hidden = false; $('notice').textContent = error.message;
  } finally {
    if (request === loadGeneration) { state.loading = false; updateStatus(); }
  }
}
function renderGames() {
  const games = state.slate?.games || [];
  $('game-count').textContent = `${games.length} GAMES ON THIS SLATE`;
  $('games-strip').innerHTML = `<button class="game-chip all ${state.game === 'ALL' ? 'selected' : ''}" data-game="ALL" aria-pressed="${state.game === 'ALL'}"><span class="matchup">All games</span><span class="game-time">${games.length} matchups</span></button>` + games.map(g => `<button class="game-chip ${state.game === g.matchup ? 'selected' : ''}" data-game="${esc(g.matchup)}" aria-pressed="${state.game === g.matchup}" title="Filter the table to ${esc(g.matchup)}"><span class="matchup">${esc(g.away)} <small>@</small> ${esc(g.home)}</span><span class="game-time">${time(g.tipoff)}<span>${Number.isFinite(g.total) ? `${g.total} O/U` : 'NBA'}</span></span></button>`).join('');
}
function renderPool() {
  const players = state.slate?.players || [];
  const query = $('search').value.trim().toLowerCase();
  const eligible = players.filter(p => !playerProblem(p, state.settings));
  const filtered = players.filter(p => (!query || `${p.name} ${p.team} ${p.opponent}`.toLowerCase().includes(query)) && (state.position === 'ALL' || p.position === state.position) && (state.game === 'ALL' || p.game === state.game) && (!$('eligible-only').checked || !playerProblem(p, state.settings)));
  const val = p => state.sort === 'value' ? (p.projection ?? -1) / p.salary : p[state.sort] ?? -1;
  filtered.sort((a, b) => state.direction * (val(a) - val(b)) || a.name.localeCompare(b.name));
  $('pool-count').textContent = filtered.length;
  $('pool-subtitle').textContent = `${players.length} Yahoo players · ${eligible.length} eligible with your settings`;
  $('position-tabs').innerHTML = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'].map(pos => `<button data-position="${pos}" class="${state.position === pos ? 'active' : ''}" aria-pressed="${state.position === pos}">${pos === 'ALL' ? 'All' : pos}</button>`).join('');
  $('players-body').innerHTML = filtered.length ? filtered.map(p => {
    const locked = state.locked.has(p.id), excluded = state.excluded.has(p.id), problem = playerProblem(p, state.settings);
    const shortStatus = ['Out','Doubtful','Questionable','Unknown'].includes(p.injury) ? p.injury : '';
    return `<tr class="player-row ${locked ? 'locked' : ''} ${excluded ? 'excluded' : ''}" data-player-id="${esc(p.id)}" title="${esc(problem || `${p.starterStatus} starter · ${p.injury}`)}"><td><button class="row-action ${locked ? 'locked' : ''}" data-lock="${esc(p.id)}" aria-label="${locked ? 'Unlock' : 'Lock'} ${esc(p.name)}" aria-pressed="${locked}" ${problem && !locked ? 'disabled' : ''}>${icon('lock-keyhole')}</button></td><td class="player-cell"><div class="player-wrap"><span class="player-avatar">${esc(p.name.split(' ').map(w => w[0]).slice(0,2).join(''))}</span><div><div class="player-name">${esc(p.name)} ${p.newPlayer ? '<span class="new-badge" title="Yahoo historical average is zero; may be a rookie or missing history">NEW</span>' : ''}${shortStatus ? `<span class="status-badge">${esc(shortStatus)}</span>` : ''}</div><div class="player-meta"><b>${esc(p.team)}</b> vs ${esc(p.opponent)} · ${time(p.tipoff)}</div></div></div></td><td><span class="pos-tag">${esc(p.position)}</span></td><td class="salary-cell">$${p.salary}</td><td>${number(p.minutes)}</td><td class="projection-cell" title="SportsLine: ${number(p.sources.sportsline)} · Fuel: ${number(p.sources.fuel)}">${number(p.projection)}</td><td class="value-cell ${(p.projection / p.salary) >= 1.3 ? 'good' : ''}">${Number.isFinite(p.projection) ? (p.projection / p.salary).toFixed(2) + '×' : '—'}</td><td><button class="row-action ${excluded ? 'excluded' : ''}" data-exclude="${esc(p.id)}" aria-label="${excluded ? 'Include' : 'Exclude'} ${esc(p.name)}" aria-pressed="${excluded}">${icon('ban')}</button></td></tr>`;
  }).join('') : '<tr><td colspan="8" class="table-empty">No players match these filters. Try another position or turn off “Eligible only.”</td></tr>';
  document.querySelectorAll('[data-sort]').forEach(button => { button.textContent = `${{salary:'SALARY',minutes:'MIN',projection:'PROJ',value:'VALUE'}[button.dataset.sort]}${state.sort === button.dataset.sort ? state.direction < 0 ? ' ↓' : ' ↑' : ''}`; });
  drawIcons();
}
function renderLineup() {
  const result = state.result;
  $('roster-count').textContent = `${result ? 8 : 0} / 8`;
  $('remaining-salary').innerHTML = `$${200 - (result?.salary || 0)}<span> / $200</span>`;
  $('projected-total').innerHTML = `${result ? result.projection.toFixed(1) : '—'}<span> FPTS</span>`;
  $('budget-fill').style.width = `${(result?.salary || 0) / 2}%`;
  $('lineup-rows').innerHTML = SLOTS.map(slot => {
    const p = result?.lineup.find(p => p.slot === slot);
    return `<div class="lineup-row" data-slot="${slot}"><span class="slot-pill">${slot}</span>${p ? `<div class="lineup-player"><strong>${esc(p.name)}</strong><small>${esc(p.team)} · ${esc(p.position)} · $${p.salary}</small></div><div class="lineup-points"><strong>${number(p.projection)}</strong><small>FPTS</small></div>` : '<span class="empty-slot">Open position</span><span class="empty-dash">—</span>'}</div>`;
  }).join('');
  $('build-rules').innerHTML = `${icon('shield-check')}<span>${state.settings.startersOnly ? 'Starters' : 'Include bench'} · ${state.settings.minMinutes}+ min · Max ${state.settings.maxNewPlayers} new</span>`;
  ['copy-lineup','download-lineup','save-lineup'].forEach(id => { $(id).disabled = !result; });
  drawIcons();
}
async function generate() {
  const problem = slateProblem(state.slate);
  if (problem) { message(problem, true); updateStatus(); return; }
  const run = ++generation; const snapshot = state.slate;
  state.busy = true; state.result = null; renderLineup(); updateStatus(); message('Finding a lineup within your constraints…');
  try {
    const result = await new Promise((resolve, reject) => {
      worker = new Worker(new URL('./optimizer.worker.js', import.meta.url), { type: 'module' });
      workerTimer = setTimeout(() => { worker?.terminate(); reject(new Error('This build took too long. Release some locks or tighten the player pool and try again.')); }, 22000);
      worker.onmessage = ({ data }) => { clearTimeout(workerTimer); data.ok ? resolve(data.result) : reject(new Error(data.error)); };
      worker.onerror = () => { clearTimeout(workerTimer); reject(new Error('The lineup worker could not run. Reload the page and try again.')); };
      worker.postMessage({ slate: snapshot, settings: settings() });
    });
    if (run !== generation) return;
    const latestProblem = slateProblem(snapshot);
    if (latestProblem) throw new Error(latestProblem);
    state.result = result; renderLineup();
    message(`8 players · ${new Set(result.lineup.map(p => p.team)).size} teams · Check starters again before tipoff.`);
  } catch (error) { if (run === generation) message(error.message, true); }
  finally { if (run === generation) { clearTimeout(workerTimer); worker?.terminate(); worker = null; state.busy = false; updateStatus(); } }
}
function method() {
  const sources = state.slate?.sources || {};
  showModal('A transparent starting point', `<p><strong>Daily consensus v1</strong> averages two current public forecasts: SportsLine’s component stats converted to Yahoo scoring, and Daily Fantasy Fuel’s FanDuel points. Yahoo and FanDuel use the same NBA scoring weights.</p><p>Points + 1.2 × rebounds + 1.5 × assists + 3 × steals + 3 × blocks − turnovers. Value means projected fantasy points per salary dollar.</p><p>This first version does not use the old private ML model. Its profitability has not been validated. It builds one lineup with a high projected total; it does not model ownership or tournament payout risk.</p><h3>Who can enter a lineup?</h3><p>By default: projected starters, at least 24 projected minutes, two available forecasts, and no unresolved injury flag. The official team injury reports must be submitted. “NEW” means Yahoo’s historical average is zero; it can indicate a rookie or missing history. At most two are selected by default.</p><p>Game chips, position tabs, and search filter the table only. Locks, exclusions, and Settings affect generation. Eight slots, $200 maximum, and at least three teams are enforced.</p><h3>Freshness and lineup locks</h3><p>Scheduled checks run every 15 minutes and can be delayed. “Refresh data” reloads the latest published snapshot. Forecast publication can lag behind salaries. Generation stops if the snapshot is over two hours old, the injury report is over three hours old, or this slate has started. V1 does not manage an existing Yahoo entry or late swaps.</p><h3>Current sources</h3>${Object.entries(sources).map(([name, s]) => `<div class="source-row"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc({ sportsline:'SportsLine',fuel:'Daily Fantasy Fuel',starters:'RotoWire starting lineups',injuries:'Official NBA injury report' }[name] || name)}</a><span>${s.updatedAt ? 'Published' : 'Retrieved'} ${time(s.updatedAt || s.capturedAt)} PT</span></div>`).join('')}<p>SportsLine provides no source timestamp here; its current matchup is checked. Review team news and verify the lineup on Yahoo before entering.</p>`);
}
function openSettings() {
  showModal('Build settings', `<div class="setting-row"><label for="setting-minutes">Minimum projected minutes<small>Minutes come from SportsLine’s current forecast.</small></label><select id="setting-minutes">${[0,16,20,24,28,30,32].map(n => `<option value="${n}" ${n === state.settings.minMinutes ? 'selected' : ''}>${n}+ min</option>`).join('')}</select></div><div class="setting-row"><label for="setting-starters">Projected starters only<small>Turn off to consider healthy bench players.</small></label><input id="setting-starters" type="checkbox" ${state.settings.startersOnly ? 'checked' : ''}></div><div class="setting-row"><label for="setting-new">Maximum new players<small>“New” means Yahoo has a zero historical average, including rookies and missing history.</small></label><select id="setting-new">${[0,1,2,3,4,5,6,7,8].map(n => `<option value="${n}" ${n === state.settings.maxNewPlayers ? 'selected' : ''}>${n}</option>`).join('')}</select></div><button id="apply-settings" class="button generate">Apply settings</button>`);
  $('apply-settings').onclick = () => {
    state.settings = { minMinutes: +$('setting-minutes').value, startersOnly: $('setting-starters').checked, maxNewPlayers: +$('setting-new').value };
    $('modal').close(); invalidate(); renderPool();
  };
}
function lineupText(result, slate) {
  return `Slate Lab · Yahoo NBA · ${slate.date}\n${result.lineup.map(p => `${p.slot}: ${p.name} (${p.team}) $${p.salary}`).join('\n')}\nSalary: $${result.salary}/$200 · Projection: ${result.projection.toFixed(2)}\nReview starters and injury news before entering.`;
}
async function copyResult(result = state.result, slate = state.slate) {
  if (!result) return;
  const text = lineupText(result, slate);
  try { await navigator.clipboard.writeText(text); toast('Lineup copied'); }
  catch { showModal('Copy your lineup', `<p>Select and copy this lineup:</p><textarea aria-label="Lineup to copy" readonly style="width:100%;height:270px;font:12px monospace;padding:12px">${esc(text)}</textarea>`); $('modal-content').querySelector('textarea').select(); }
}
function downloadResult() {
  if (!state.result) return;
  const cell = value => `"${String(value).replace(/"/g,'""')}"`;
  const rows = [['Slot','Player','Yahoo ID','Team','Position','Salary','Projection','Slate date','Snapshot time'], ...state.result.lineup.map(p => [p.slot,p.name,p.id,p.team,p.position,p.salary,p.projection,state.slate.date,state.slate.updatedAt])];
  const url = URL.createObjectURL(new Blob([rows.map(row => row.map(cell).join(',')).join('\r\n')], { type:'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `slatelab-${state.slate.date}-${state.slate.id}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Review CSV downloaded — enter these players on Yahoo');
}
function updateSavedCount() { document.querySelectorAll('.saved-count').forEach(el => { el.textContent = readSaved().length; }); }
function saveResult() {
  if (!state.result) return;
  try {
    const saved = readSaved(); saved.unshift({ ...state.result, date:state.slate.date, slateId:state.slate.id, snapshotAt:state.slate.updatedAt });
    localStorage.setItem('slatelab-lineups-v1', JSON.stringify(saved.slice(0,30))); updateSavedCount(); toast('Saved on this browser');
  } catch { toast('Browser storage is unavailable. Copy or download instead.'); }
}
function savedLineups() {
  const saved = readSaved();
  showModal('Saved lineups', `<p>Stored only in this browser. Saved lineups are historical records and are not refreshed automatically.</p>${saved.length ? saved.map((s,i) => `<div class="saved-card"><strong>${esc(s.date)} · $${s.salary} · ${number(s.projection)} FPTS</strong><p>${esc(s.lineup.map(p => p.name).join(' · '))}</p><button class="button secondary small" data-saved-copy="${i}">${icon('copy')}Copy</button> <button class="button secondary small" data-saved-delete="${i}">Delete</button></div>`).join('') : '<p>No saved lineups yet. Generate one, then select Save.</p>'}`);
  $('modal-content').onclick = event => {
    const copy = event.target.closest('[data-saved-copy]'), remove = event.target.closest('[data-saved-delete]');
    if (copy) copyResult(saved[+copy.dataset.savedCopy], saved[+copy.dataset.savedCopy]);
    if (remove) { try { saved.splice(+remove.dataset.savedDelete,1); localStorage.setItem('slatelab-lineups-v1',JSON.stringify(saved)); updateSavedCount(); savedLineups(); } catch { toast('Browser storage is unavailable.'); } }
  };
}

$('refresh').onclick = () => loadData();
$('slate-select').onchange = event => loadData(event.target.value);
$('generate').onclick = generate;
$('settings-button').onclick = openSettings;
['method-nav','sources-link','help-button'].forEach(id => { $(id).onclick = method; });
$('saved-nav').onclick = savedLineups;
$('mobile-saved').onclick = savedLineups;
$('builder-nav').onclick = () => { $('modal').close(); window.scrollTo({ top:0,behavior:'smooth' }); };
$('close-modal').onclick = () => $('modal').close();
$('modal').addEventListener('click', event => { if (event.target === $('modal')) { const box = $('modal').getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $('modal').close(); } });
$('search').oninput = renderPool; $('eligible-only').onchange = renderPool;
$('position-tabs').onclick = event => { const button = event.target.closest('[data-position]'); if (button) { state.position = button.dataset.position; renderPool(); } };
$('games-strip').onclick = event => { const button = event.target.closest('[data-game]'); if (button) { state.game = button.dataset.game; renderGames(); renderPool(); } };
$('player-table').onclick = event => {
  const sort = event.target.closest('[data-sort]'), lock = event.target.closest('[data-lock]'), exclude = event.target.closest('[data-exclude]');
  if (sort) { state.direction = state.sort === sort.dataset.sort ? -state.direction : -1; state.sort = sort.dataset.sort; renderPool(); }
  if (lock) {
    const id = lock.dataset.lock;
    if (state.locked.has(id)) state.locked.delete(id);
    else { if (state.locked.size >= 8) { toast('You can lock at most eight players.'); return; } state.locked.add(id); state.excluded.delete(id); }
    invalidate(); renderPool();
  }
  if (exclude) { const id = exclude.dataset.exclude; state.excluded.has(id) ? state.excluded.delete(id) : state.excluded.add(id); state.locked.delete(id); invalidate(); renderPool(); }
};
$('reset-pool').onclick = () => { state.position = state.game = 'ALL'; $('search').value = ''; $('eligible-only').checked = true; state.locked.clear(); state.excluded.clear(); invalidate('Filters, locks, and exclusions reset.'); renderGames(); renderPool(); };
$('copy-lineup').onclick = () => copyResult(); $('download-lineup').onclick = downloadResult; $('save-lineup').onclick = saveResult;
setInterval(updateStatus, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateStatus(); });
renderLineup(); updateSavedCount(); drawIcons(); loadData();
