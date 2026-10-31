// Derived fantasy-point contributions, never raw bookmaker odds. This adjusted
// forecast shares provider inputs wherever betting categories are missing.
export const componentLabel = kind => ({points:'PTS',rebounds:'REB',assists:'AST',steals:'STL',blocks:'BLK',turnovers:'TO',dk_extras:'3PM + DD/TD'}[kind] || kind);
const baseKinds = ['points','rebounds','assists','steals','blocks','turnovers'];
const fresh = (value, now) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now+300000 && now-Date.parse(value) <= 120*60000;
const matches = (data,p,platform) => data?.platform === platform && data.game === p.game && data.tipoff === p.tipoff;
const contribution = (kind,value) => Number.isFinite(value) && (kind === 'turnovers' ? value <= 0 && value >= -100 : value >= 0 && value <= 300);

export function hybridSportsline(p,platform,now) {
  const kinds=platform==='draftkings' ? [...baseKinds,'dk_extras'] : baseKinds;
  const unavailable = reason => ({points:null,used:[],provider:kinds,reason,quotes:{},yesOnly:false});
  const baseline=p.sources?.sportsline, provider=p.sportslineComponents;
  if (!Number.isFinite(baseline) || baseline<0) return unavailable('No SportsLine baseline; using remaining provider forecasts.');
  if (provider?.method!=='provider-components-v1' || !matches(provider,p,platform) || !fresh(provider.updatedAt,now) ||
      !Number.isFinite(provider.total) || Math.abs(provider.total-baseline)>.002 ||
      !kinds.every(k=>contribution(k,provider.values?.[k])) ||
      Math.abs(kinds.reduce((sum,k)=>sum+provider.values[k],0)-baseline)>.002) {
    return unavailable('Matching SportsLine components are unavailable; retaining provider totals.');
  }
  const betting=p.bettingComponents;
  if (betting?.method!=='prop-components-v1' || !matches(betting,p,platform)) return unavailable('No matching betting components; retaining provider forecasts.');
  const used=[], retained=[], quotes={};let points=baseline,yesOnly=false;
  for (const kind of kinds) {
    const quote=betting.values?.[kind];
    if (quote && contribution(kind,quote.points) && fresh(quote.updatedAt,now)) {
      points+=quote.points-provider.values[kind];used.push(kind);quotes[kind]=quote.updatedAt;
      if (kind==='dk_extras') yesOnly=Object.values(quote.bonusProbabilityMethods||{}).some(v=>Array.isArray(v)&&v.includes('yes_only_implied'));
    } else retained.push(kind);
  }
  if (!used.length) return unavailable('No fresh usable betting components; retaining provider forecasts.');
  if (!Number.isFinite(points) || points<0) return unavailable('Hybrid total failed validation; retaining provider forecasts.');
  return {points:Math.round(points*1000)/1000,used,provider:retained,quotes,yesOnly,reason:null};
}

export function hybridExplanation(p) {
  const d=p.hybridDetails;
  if (!d?.used.length) return d?.reason || 'Hybrid components unavailable.';
  return `Betting: ${d.used.map(componentLabel).join(', ')}. SportsLine retained: ${d.provider.map(componentLabel).join(', ') || 'none'}.`+
    (p.projectionMethod==='market' && p.blendSources?.includes('betting_filled')
      ? ' Betting (provider-filled) is averaged with the original SportsLine and Fuel forecasts when available. Each estimate gets equal weight. Missing categories share SportsLine inputs; these are not three independent forecasts.'
      : p.hybridSources?.includes('fuel') ? ' Averaged with Fuel; SportsLine is not counted again.' : ' No Fuel forecast; hybrid used alone.')+
    (d.yesOnly ? ' DD/TD includes Yes-only implied probabilities; bookmaker margin remains.' : '');
}
