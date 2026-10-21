import solver from 'javascript-lp-solver';

export const SLOTS = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL'];
export const ELIGIBILITY = { PG: ['PG', 'G', 'UTIL'], SG: ['SG', 'G', 'UTIL'], SF: ['SF', 'F', 'UTIL'], PF: ['PF', 'F', 'UTIL'], C: ['C', 'UTIL'] };
export function easternDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function slateProblem(slate, now = Date.now()) {
  if (!slate) return 'No slate is available yet.';
  if (slate.date !== easternDate(new Date(now))) return 'This is an archived slate. Wait for today’s salary release.';
  if (!Number.isFinite(Date.parse(slate.updatedAt)) || now - Date.parse(slate.updatedAt) > 120 * 60000) return 'This snapshot is over two hours old. Refresh data before generating.';
  if (Date.parse(slate.updatedAt) > now + 5 * 60000) return 'The snapshot timestamp is invalid.';
  if (!Number.isFinite(Date.parse(slate.firstTip))) return 'The slate start time is invalid.';
  if (now >= Date.parse(slate.firstTip)) return 'This slate has started. Choose a later slate; existing-entry late swaps are not supported in v1.';
  if (!slate.ready) return slate.readinessReason || 'Current projections or injury reports are not ready.';
  if (!Number.isFinite(Date.parse(slate.injuryReportedAt)) || now - Date.parse(slate.injuryReportedAt) > 180 * 60000 || Date.parse(slate.injuryReportedAt) > now + 5 * 60000) return 'The official injury report needs a refresh.';
  return null;
}
export function playerProblem(p, settings = {}) {
  if (!Number.isFinite(p.projection) || p.projection <= 0 || p.sourceCount < 2) return 'Awaiting both projection sources';
  if (['Out', 'Doubtful', 'Questionable', 'Unknown'].includes(p.injury)) return p.injury === 'Unknown' ? 'Team injury report not submitted' : p.injury;
  if (!['Not listed', 'Available', 'Probable'].includes(p.injury)) return 'Unknown injury status';
  if (!p.providerClear) return 'Unresolved provider injury flag';
  if (settings.startersOnly !== false && !p.starter) return 'Outside projected starting five';
  if (!Number.isFinite(p.minutes) || p.minutes < (settings.minMinutes ?? 24)) return 'Below minutes minimum';
  if (!ELIGIBILITY[p.position] || !Number.isInteger(p.salary) || p.salary < 10) return 'Invalid Yahoo salary or position';
  return null;
}
export function validateLineup(lineup, settings = {}) {
  if (lineup.length !== 8 || new Set(lineup.map(p => p.id)).size !== 8) throw new Error('A lineup must have eight different players.');
  if (new Set(lineup.map(p => p.slot)).size !== 8 || lineup.some(p => !ELIGIBILITY[p.position]?.includes(p.slot))) throw new Error('The lineup contains an invalid position assignment.');
  if (lineup.reduce((n, p) => n + p.salary, 0) > 200) throw new Error('The lineup exceeds the $200 salary cap.');
  const counts = Object.values(lineup.reduce((a, p) => ({ ...a, [p.team]: (a[p.team] || 0) + 1 }), {}));
  if (counts.length < 3 || Math.max(...counts) > 6) throw new Error('Yahoo requires at least three teams, with at most six players from one team.');
  if (lineup.filter(p => p.newPlayer).length > (settings.maxNewPlayers ?? 2)) throw new Error('The lineup exceeds your limit for new players.');
  const ids = new Set(lineup.map(p => p.id));
  if ((settings.locked || []).some(id => !ids.has(id))) throw new Error('A locked player is missing.');
  if ((settings.excluded || []).some(id => ids.has(id))) throw new Error('An excluded player was selected.');
  return true;
}
export function assignSlots(players) {
  // Fill narrow slots with the earliest games, leaving the latest eligible
  // players in G/F/UTIL for flexibility. Try every legal assignment (eight only).
  let best = null;
  function visit(slot, left, chosen, score) {
    if (slot === 8) { if (!best || score > best.score) best = { lineup: chosen, score }; return; }
    for (let i = 0; i < left.length; i++) {
      const p = left[i];
      if (!ELIGIBILITY[p.position].includes(SLOTS[slot])) continue;
      const flexibility = SLOTS[slot] === 'UTIL' ? 3 : ['G', 'F'].includes(SLOTS[slot]) ? 1 : 0;
      const tip = Date.parse(p.tipoff) || 0;
      visit(slot + 1, [...left.slice(0, i), ...left.slice(i + 1)], [...chosen, { ...p, slot: SLOTS[slot] }], score + flexibility * tip);
    }
  }
  visit(0, players, [], 0);
  if (!best) throw new Error('These players cannot fill Yahoo’s eight positions.');
  return best.lineup;
}
export function generateLineup(slate, settings = {}, now = Date.now()) {
  if (!Number.isInteger(settings.maxNewPlayers ?? 2) || (settings.maxNewPlayers ?? 2) < 0 || (settings.maxNewPlayers ?? 2) > 8 || !Number.isFinite(settings.minMinutes ?? 24) || (settings.minMinutes ?? 24) < 0 || (settings.minMinutes ?? 24) > 48) throw new Error('Invalid build settings.');
  const error = slateProblem(slate, now);
  if (error) throw new Error(error);
  const locked = new Set(settings.locked || []), excluded = new Set(settings.excluded || []);
  if (locked.size > 8) throw new Error('You can lock at most eight players.');
  for (const id of locked) {
    const p = slate.players.find(p => p.id === id);
    if (!p || excluded.has(id)) throw new Error('A player cannot be both locked and excluded.');
    const problem = playerProblem(p, settings);
    if (problem) throw new Error(`${p.name} cannot be locked: ${problem}.`);
  }
  const candidates = slate.players.filter(p => !excluded.has(p.id) && !playerProblem(p, settings));
  if (new Set(slate.players.map(p => p.id)).size !== slate.players.length) throw new Error('Duplicate player IDs in the published slate.');
  if (candidates.length < 8) throw new Error('Not enough eligible players. Lower the minutes minimum or include bench players.');
  const teams = [...new Set(candidates.map(p => p.team))].sort();
  if (teams.length < 3) throw new Error('Include players from at least three teams.');
  const constraints = { salary: { max: 200 }, total: { equal: 8 }, newPlayers: { max: settings.maxNewPlayers ?? 2 }, guards: { min: 3 }, forwards: { min: 3 } };
  for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) constraints[pos] = { min: 1 };
  for (const t of teams) constraints[`team_${t}`] = { max: 6 };
  // No two teams may account for all eight players.
  const pairs = [];
  for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) {
    const name = `pair_${i}_${j}`; constraints[name] = { max: 7 }; pairs.push({ name, teams: [teams[i], teams[j]] });
  }
  const variables = {}, binaries = {};
  candidates.forEach((p, i) => {
    const name = `p${i}`;
    variables[name] = { projection: Math.round(p.projection * 1000), salary: p.salary, total: 1, newPlayers: +p.newPlayer,
      [p.position]: 1, guards: +['PG', 'SG'].includes(p.position), forwards: +['SF', 'PF'].includes(p.position), [`team_${p.team}`]: 1 };
    for (const pair of pairs) if (pair.teams.includes(p.team)) variables[name][pair.name] = 1;
    if (locked.has(p.id)) { constraints[`lock_${i}`] = { equal: 1 }; variables[name][`lock_${i}`] = 1; }
    binaries[name] = 1;
  });
  const result = solver.Solve({ optimize: 'projection', opType: 'max', constraints, variables, binaries, options: { timeout: 15000, tolerance: 0 } });
  if (!result.feasible) throw new Error('No legal lineup fits these settings. Release a lock, include more players, or increase the new-player limit.');
  const selected = candidates.filter((p, i) => result[`p${i}`] > 0.5);
  const lineup = assignSlots(selected);
  validateLineup(lineup, settings);
  return { lineup, salary: lineup.reduce((n, p) => n + p.salary, 0), projection: lineup.reduce((n, p) => n + p.projection, 0), generatedAt: new Date(now).toISOString(), eligibleCount: candidates.length };
}
