// Only derived daily predictions are public. The trained models stay private.
export const projectionLabel = method => ({trained:'Trained model (experimental)',combined:'Combined',consensus:'50/50 consensus'}[method] || 'Daily projections');
export const sourceLabel = source => ({consensus:'50/50',sportsline:'SportsLine',fuel:'Fuel',model:'Trained model',unavailable:'Unavailable'}[source] || 'Unavailable');
const forecast = value => Number.isFinite(value) && value >= 0;
const validMinutes = value => Number.isFinite(value) && value >= 0 && value <= 48;

export function teamContext(players, team) {
  return JSON.stringify(players.filter(p => p.team === team).map(p =>
    [p.id, p.injury, !!p.providerClear, !!p.starter, p.starterStatus]
  ).sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function trainedProblem(slate, snapshot, now = Date.now()) {
  if ((slate?.platform || 'yahoo') !== 'yahoo') return 'The trained model currently supports Yahoo only.';
  if (!snapshot) return 'No trained-model snapshot is published for this date.';
  if (snapshot.schemaVersion !== 1 || snapshot.platform !== 'yahoo' || snapshot.date !== slate.date || !Array.isArray(snapshot.players)) return 'The trained-model snapshot does not match this slate.';
  if (snapshot.players.some(p => !p || typeof p.id !== 'string' || !Number.isFinite(p.points) || !Number.isFinite(p.minutes))) return 'The trained-model player data is invalid.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.trainedThrough || '') || snapshot.trainedThrough >= slate.date || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.historyThrough || '') || snapshot.historyThrough >= slate.date) return 'The trained-model history cutoff is invalid.';
  const captured = Date.parse(snapshot.inputsAt), generated = Date.parse(snapshot.generatedAt);
  if (![captured,generated].every(Number.isFinite) || captured > now + 300000 || generated > now + 300000 || generated < captured) return 'The trained-model timestamp is invalid.';
  if (now - captured > 120 * 60000) return 'The trained-model inputs are over two hours old. A new private-model export is needed.';
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
    const consensusProjection = Object.hasOwn(p,'consensusProjection') ? p.consensusProjection : p.projection;
    const sportslineMinutes = Object.hasOwn(p,'sportslineMinutes') ? p.sportslineMinutes : p.minutes;
    const modelMinutes = modelAvailable ? prediction.minutes : null;
    const sportsline = forecast(p.sources?.sportsline) ? p.sources.sportsline : null;
    const fuel = forecast(p.sources?.fuel) ? p.sources.fuel : null;
    // A published zero is a forecast, not a missing source. Never replace it
    // with a more optimistic model prediction.
    const combinedSource = sportsline !== null && fuel !== null ? 'consensus' : sportsline !== null ? 'sportsline' : fuel !== null ? 'fuel' : modelAvailable ? 'model' : 'unavailable';
    const combinedProjection = combinedSource === 'consensus' ? forecast(consensusProjection) ? consensusProjection : Math.round((sportsline+fuel)/2*1000)/1000 : sportsline ?? fuel ?? modelProjection;
    const useModelMinutes = method === 'combined' && (combinedSource === 'model' || !validMinutes(sportslineMinutes));
    const minutes = useModelMinutes ? modelMinutes : sportslineMinutes;
    return {...p, consensusProjection, combinedProjection, combinedSource, modelProjection, modelMinutes, sportslineMinutes,
      modelAvailable, projectionMethod:method,
      projectionSource:method === 'combined' ? combinedSource : method === 'trained' ? modelAvailable ? 'model' : 'unavailable' : forecast(consensusProjection) ? 'consensus' : 'unavailable',
      minutes, minutesSource:validMinutes(minutes) ? useModelMinutes ? 'model' : 'sportsline' : 'unavailable',
      projection:method === 'trained' ? modelProjection : method === 'combined' ? combinedProjection : consensusProjection};
  });
  const coverageProblem = !problem && players.filter(p => p.modelAvailable).length < 8 ? 'Trained-model predictions no longer match the current player pool, injuries, or starters. A new private-model export is needed.' : null;
  const combinedReady = slate.combinedReady ?? slate.ready;
  const enoughCombined = players.filter(p=>forecast(p.combinedProjection) && p.combinedProjection > 0).length >= 8;
  return {...slate,players,projectionMethod:method,trainedSnapshot:snapshot,
    combinedReady,
    ready:method === 'combined' ? combinedReady && enoughCombined : slate.ready,
    readinessReason:method === 'combined' ? !combinedReady ? slate.combinedReadinessReason || slate.readinessReason : !enoughCombined ? 'Combined needs at least eight current forecasts from providers or a fresh trained-model export.' : null : slate.readinessReason,
    modelFallbackProblem:problem, trainedProblem:problem || coverageProblem,
    model:method === 'trained' || method === 'combined' ? {id:method === 'trained' ? 'private-yahoo-v8' : 'combined-yahoo-v1',name:projectionLabel(method)} : slate.model};
}

// A Combined lineup may depend on the model for points OR for minutes. Expiry
// invalidates that lineup without disabling builds from remaining provider data.
export function lineupModelProblem(slate, lineup, now = Date.now()) {
  if (!lineup?.some(p=>p.projectionSource === 'model' || p.minutesSource === 'model')) return null;
  return trainedProblem(slate, slate.trainedSnapshot, now);
}

export function comparisonTotals(lineup) {
  const sum = key => lineup.every(p => Number.isFinite(p[key])) ? lineup.reduce((n,p) => n+p[key],0) : null;
  return {consensus:sum('consensusProjection'),trained:sum('modelProjection')};
}
