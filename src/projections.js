// Only derived daily predictions are public. The trained models stay private.
import {hybridSportsline} from './hybrid.js';
export const projectionLabel = method => ({provider:'Fuel DraftKings (original)',trained:'Trained model (experimental)',combined:'Combined',market:'3-source blend (experimental)',hybrid:'Betting hybrid (experimental)',consensus:'50/50 consensus'}[method] || 'Daily projections');
export const sourceLabel = source => ({consensus:'50/50',sportsline:'SportsLine',fuel:'Fuel',betting:'Betting',market:'3-source blend',hybrid:'Betting/SportsLine hybrid',model:'Trained model',unavailable:'Unavailable'}[source] || 'Unavailable');
export const playerSourceLabel = p => ['market','hybrid'].includes(p.projectionMethod) ? (p.projectionMethod==='hybrid' ? p.hybridSources : p.blendSources)?.map(sourceLabel).join(' + ') || 'Unavailable' : sourceLabel(p.projectionSource);
const forecast = value => Number.isFinite(value) && value >= 0;
const validMinutes = value => Number.isFinite(value) && value >= 0 && value <= 48;

export function bettingForecast(p, platform, now) {
  const b=p.betting, updated=Date.parse(b?.updatedAt);
  return b?.complete === true && b.method === 'prop-lines-v2' && b.platform === platform &&
    b.game === p.game && b.tipoff === p.tipoff && forecast(b.points) && b.points === p.sources?.betting &&
    Number.isFinite(updated) && now-updated <= 120*60000 && updated <= now+300000 ? b.points : null;
}

export function teamContext(players, team) {
  return JSON.stringify(players.filter(p => p.team === team).map(p =>
    [p.id, p.injury, !!p.providerClear, !!p.starter, p.starterStatus]
  ).sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function trainedProblem(slate, snapshot, now = Date.now()) {
  const platform = slate?.platform || 'yahoo';
  if (!['yahoo','draftkings'].includes(platform)) return 'Unsupported trained-model platform.';
  if (!snapshot) return 'No trained-model snapshot is published for this date.';
  if (snapshot.schemaVersion !== 1 || snapshot.platform !== platform || snapshot.date !== slate.date || !Array.isArray(snapshot.players)) return 'The trained-model snapshot does not match this slate or scoring platform.';
  if (snapshot.players.some(p => !p || typeof p.id !== 'string' || !Number.isFinite(p.points) || !Number.isFinite(p.minutes))) return 'The trained-model player data is invalid.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.trainedThrough || '') || snapshot.trainedThrough >= slate.date || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.historyThrough || '') || snapshot.historyThrough >= slate.date) return 'The trained-model history cutoff is invalid.';
  const captured = Date.parse(snapshot.inputsAt), generated = Date.parse(snapshot.generatedAt);
  if (![captured,generated].every(Number.isFinite) || captured > now + 300000 || generated > now + 300000 || generated < captured) return 'The trained-model timestamp is invalid.';
  if (now - captured > 120 * 60000) return 'The trained-model inputs are over two hours old. A new private-model export is needed.';
  if (new Set(snapshot.players.map(p => p.id)).size !== snapshot.players.length) return 'Duplicate players in the trained-model snapshot.';
  return null;
}

export function selectProjection(slate, snapshot, method, now = Date.now()) {
  if (!slate) return null;
  const platform=slate.platform || 'yahoo';
  method ??= platform === 'draftkings' ? 'provider' : 'consensus';
  const problem = trainedProblem(slate, snapshot, now);
  const predictions = new Map(problem ? [] : snapshot.players.map(p => [p.id,p]));
  const context = Object.fromEntries([...new Set(slate.players.map(p => p.team))].map(t => [t,teamContext(slate.players,t)]));
  const players = slate.players.map(p => {
    const prediction = predictions.get(p.id);
    const matches = prediction && prediction.team === p.team && prediction.opponent === p.opponent && prediction.game === p.game && prediction.tipoff === p.tipoff && snapshot.teamContexts?.[p.team] === context[p.team] && snapshot.teamContexts?.[p.opponent] === context[p.opponent];
    const modelAvailable = !!matches && Number.isFinite(prediction.points) && prediction.points >= 0 && Number.isFinite(prediction.minutes) && prediction.minutes >= 0 && prediction.minutes <= 48;
    const modelProjection = modelAvailable ? prediction.points : null;
    const consensusProjection = Object.hasOwn(p,'consensusProjection') ? p.consensusProjection : platform === 'draftkings' ? forecast(p.sources?.sportsline) && forecast(p.sources?.fuel) ? (p.sources.sportsline+p.sources.fuel)/2 : null : p.projection;
    const sportslineMinutes = Object.hasOwn(p,'sportslineMinutes') ? p.sportslineMinutes : p.minutes;
    const modelMinutes = modelAvailable ? prediction.minutes : null;
    const sportsline = forecast(p.sources?.sportsline) ? p.sources.sportsline : null;
    const fuel = forecast(p.sources?.fuel) ? p.sources.fuel : null;
    const betting = bettingForecast(p, platform, now);
    const blendEntries = [['sportsline',sportsline],['fuel',fuel],['betting',betting]].filter(([,value])=>value !== null);
    const blendSources = blendEntries.map(([name])=>name);
    const marketProjection = blendEntries.length ? Math.round(blendEntries.reduce((sum,[,value])=>sum+value,0)/blendEntries.length*1000)/1000 : null;
    const hybridDetails=hybridSportsline(p,platform,now);
    const hybridEntries=[[hybridDetails.points !== null ? 'hybrid' : 'sportsline',hybridDetails.points ?? sportsline],['fuel',fuel]].filter(([,v])=>v!==null);
    const hybridSources=hybridEntries.map(([name])=>name);
    const hybridProjection=hybridEntries.length ? Math.round(hybridEntries.reduce((sum,[,v])=>sum+v,0)/hybridEntries.length*1000)/1000 : null;
    // A published zero is a forecast, not a missing source. Never replace it
    // with a more optimistic model prediction.
    const combinedSource = sportsline !== null && fuel !== null ? 'consensus' : sportsline !== null ? 'sportsline' : fuel !== null ? 'fuel' : modelAvailable ? 'model' : 'unavailable';
    const combinedProjection = combinedSource === 'consensus' ? forecast(consensusProjection) ? consensusProjection : Math.round((sportsline+fuel)/2*1000)/1000 : sportsline ?? fuel ?? modelProjection;
    const useModelMinutes = (method === 'combined' && (combinedSource === 'model' || !validMinutes(sportslineMinutes))) || (['market','hybrid'].includes(method) && !validMinutes(sportslineMinutes)) || (platform === 'draftkings' && method === 'trained');
    const minutes = useModelMinutes ? modelMinutes : sportslineMinutes;
    return {...p, consensusProjection, combinedProjection, combinedSource, marketProjection, blendSources, bettingProjection:betting, hybridDetails, hybridSources, hybridProjection, modelProjection, modelMinutes, sportslineMinutes,
      modelAvailable, projectionMethod:method,
      projectionSource:method === 'hybrid' ? hybridSources.length ? 'hybrid' : 'unavailable' : method === 'market' ? blendSources.length ? 'market' : 'unavailable' : method === 'provider' ? fuel !== null ? 'fuel' : 'unavailable' : method === 'combined' ? combinedSource : method === 'trained' ? modelAvailable ? 'model' : 'unavailable' : forecast(consensusProjection) ? 'consensus' : 'unavailable',
      minutes, minutesSource:validMinutes(minutes) ? useModelMinutes ? 'model' : 'sportsline' : 'unavailable',
      projection:method === 'hybrid' ? hybridProjection : method === 'market' ? marketProjection : method === 'provider' ? fuel : method === 'trained' ? modelProjection : method === 'combined' ? combinedProjection : consensusProjection};
  });
  const coverageProblem = !problem && players.filter(p => p.modelAvailable).length < 8 ? 'Trained-model predictions no longer match the current player pool, injuries, or starters. A new private-model export is needed.' : null;
  const combinedReady = slate.combinedReady ?? slate.ready;
  const enoughCombined = players.filter(p=>forecast(p.combinedProjection) && p.combinedProjection > 0).length >= 8;
  const enoughMarket = players.filter(p=>forecast(p.marketProjection) && p.marketProjection > 0).length >= 8;
  const enoughHybrid = players.filter(p=>forecast(p.hybridProjection) && p.hybridProjection > 0).length >= 8;
  const consensusReady=slate.consensusReady ?? (slate.ready && players.filter(p=>forecast(p.consensusProjection)).length>=8);
  const readiness=method === 'hybrid' ? combinedReady && enoughHybrid : method === 'market' ? combinedReady && enoughMarket : method === 'combined' ? combinedReady && enoughCombined : platform === 'draftkings' && method === 'trained' ? combinedReady : method === 'consensus' ? consensusReady : slate.ready;
  return {...slate,players,projectionMethod:method,trainedSnapshot:snapshot,
    combinedReady,consensusReady,ready:readiness,
    readinessReason:method === 'hybrid' ? !combinedReady ? slate.combinedReadinessReason || slate.readinessReason : !enoughHybrid ? 'Betting hybrid needs at least eight available provider or hybrid forecasts.' : null : method === 'market' ? !combinedReady ? slate.combinedReadinessReason || slate.readinessReason : !enoughMarket ? '3-source blend needs at least eight available forecasts.' : null : method === 'combined' ? !combinedReady ? slate.combinedReadinessReason || slate.readinessReason : !enoughCombined ? 'Combined needs at least eight current forecasts from providers or a fresh trained-model export.' : null : method === 'consensus' && !consensusReady ? slate.readinessReason || 'Waiting for both current projection sources.' : slate.readinessReason,
    modelFallbackProblem:problem, trainedProblem:problem || coverageProblem,
    model:{id:`${platform}-${method}`,name:projectionLabel(method)}};
}

// A Combined lineup may depend on the model for points OR for minutes. Expiry
// invalidates that lineup without disabling builds from remaining provider data.
export function lineupModelProblem(slate, lineup, now = Date.now()) {
  if (!lineup?.some(p=>p.projectionSource === 'model' || p.minutesSource === 'model')) return null;
  return trainedProblem(slate, slate.trainedSnapshot, now);
}

export function lineupBettingProblem(slate, lineup, now = Date.now()) {
  if (lineup?.some(p => p.projectionMethod === 'market' && p.blendSources?.includes('betting') && bettingForecast(p, slate.platform || 'yahoo', now) === null)) return 'Betting quotes used by this lineup have expired. Generate again with the available sources.';
  if (lineup?.some(p => p.projectionMethod === 'hybrid' && p.hybridDetails?.used.length && JSON.stringify(hybridSportsline(p,slate.platform || 'yahoo',now).quotes)!==JSON.stringify(p.hybridDetails.quotes))) return 'Betting components used by this lineup have expired. Generate again with the available sources.';
  return null;
}

export function comparisonTotals(lineup) {
  const sum = key => lineup.every(p => Number.isFinite(p[key])) ? lineup.reduce((n,p) => n+p[key],0) : null;
  return {consensus:sum('consensusProjection'),trained:sum('modelProjection')};
}
