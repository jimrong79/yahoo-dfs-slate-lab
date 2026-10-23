// Only derived daily predictions are public. The trained models stay private.
export const projectionLabel = method => method === 'trained' ? 'Trained model (experimental)' : '50/50 consensus';

export function teamContext(players, team) {
  return JSON.stringify(players.filter(p => p.team === team).map(p =>
    [p.id, p.injury, !!p.providerClear, !!p.starter, p.starterStatus]
  ).sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function trainedProblem(slate, snapshot, now = Date.now()) {
  if ((slate?.platform || 'yahoo') !== 'yahoo') return 'The trained model currently supports Yahoo only.';
  if (!snapshot) return 'No trained-model snapshot is published for this date. The 50/50 consensus remains available.';
  if (snapshot.schemaVersion !== 1 || snapshot.platform !== 'yahoo' || snapshot.date !== slate.date || !Array.isArray(snapshot.players)) return 'The trained-model snapshot does not match this slate.';
  if (snapshot.players.some(p => !p || typeof p.id !== 'string' || !Number.isFinite(p.points) || !Number.isFinite(p.minutes))) return 'The trained-model player data is invalid.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.trainedThrough || '') || snapshot.trainedThrough >= slate.date || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.historyThrough || '') || snapshot.historyThrough >= slate.date) return 'The trained-model history cutoff is invalid.';
  const captured = Date.parse(snapshot.inputsAt), generated = Date.parse(snapshot.generatedAt);
  if (![captured,generated].every(Number.isFinite) || captured > now + 300000 || generated > now + 300000 || generated < captured) return 'The trained-model timestamp is invalid.';
  if (now - captured > 120 * 60000) return 'The trained-model inputs are over two hours old. A new private-model export is needed; use 50/50 consensus meanwhile.';
  if (new Set(snapshot.players.map(p => p.id)).size !== snapshot.players.length) return 'Duplicate players in the trained-model snapshot.';
  return null;
}

export function selectProjection(slate, snapshot, method = 'consensus', now = Date.now()) {
  if (!slate) return null;
  if ((slate.platform || 'yahoo') !== 'yahoo') return {...slate, projectionMethod:'provider'};
  const problem = trainedProblem(slate, snapshot, now);
  const predictions = new Map(problem ? [] : snapshot.players.map(p => [p.id,p]));
  const context = Object.fromEntries([...new Set(slate.players.map(p => p.team))].map(t => [t,teamContext(slate.players,t)]));
  const players = slate.players.map(p => {
    const prediction = predictions.get(p.id);
    const matches = prediction && prediction.team === p.team && prediction.opponent === p.opponent && prediction.game === p.game && prediction.tipoff === p.tipoff && snapshot.teamContexts?.[p.team] === context[p.team] && snapshot.teamContexts?.[p.opponent] === context[p.opponent];
    const modelAvailable = !!matches && Number.isFinite(prediction.points) && prediction.points >= 0 && Number.isFinite(prediction.minutes) && prediction.minutes >= 0 && prediction.minutes <= 48;
    const modelProjection = modelAvailable ? prediction.points : null;
    return {...p, consensusProjection:p.projection, modelProjection, modelMinutes:modelAvailable ? prediction.minutes : null,
      modelAvailable, projectionMethod:method, projection:method === 'trained' ? modelProjection : p.projection};
  });
  const coverageProblem = !problem && players.filter(p => p.modelAvailable).length < 8 ? 'Trained-model predictions no longer match the current player pool, injuries, or starters. A new private-model export is needed.' : null;
  return {...slate,players,projectionMethod:method,trainedSnapshot:snapshot,
    trainedProblem:problem || coverageProblem,
    model:method === 'trained' ? {id:'private-yahoo-v8',name:projectionLabel(method)} : slate.model};
}

export function comparisonTotals(lineup) {
  const sum = key => lineup.every(p => Number.isFinite(p[key])) ? lineup.reduce((n,p) => n+p[key],0) : null;
  return {consensus:sum('consensusProjection'),trained:sum('modelProjection')};
}
