import { platformRules, eligibleSlots, YAHOO_SLOTS, ELIGIBILITY } from './platforms.js';
import { trainedProblem } from './projections.js';

export const SLOTS = YAHOO_SLOTS;
export { ELIGIBILITY };
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
  if (slate.projectionMethod === 'trained') return trainedProblem(slate, slate.trainedSnapshot, now) || slate.trainedProblem;
  return null;
}
export function playerProblem(p, settings = {}, platform = 'yahoo') {
  const rules = platformRules(platform);
  if (p.projectionMethod === 'trained') {
    if (!p.modelAvailable || !Number.isFinite(p.projection) || p.projection <= 0) return 'Awaiting a matching trained-model prediction';
  } else if (p.projectionMethod === 'market') {
    if (!Number.isFinite(p.projection) || p.projection <= 0 || p.projectionSource !== 'market' || !p.blendSources?.length) return 'Awaiting a SportsLine, Fuel, or complete betting forecast';
  } else if (p.projectionMethod === 'combined') {
    if (!Number.isFinite(p.projection) || p.projection <= 0 || !['consensus','sportsline','fuel','model'].includes(p.projectionSource)) return 'Awaiting a provider forecast or matching trained-model prediction';
    if (p.projectionSource === 'model' && !p.modelAvailable) return 'Awaiting a matching trained-model prediction';
  } else if (!Number.isFinite(p.projection) || p.projection <= 0 || p.sourceCount < (p.projectionMethod === 'consensus' ? 2 : rules.projectionSources)) return rules.id === 'yahoo' || p.projectionMethod === 'consensus' ? 'Awaiting both projection sources' : 'Awaiting a DraftKings projection';
  if (['Out', 'Doubtful', 'Questionable', 'Unknown'].includes(p.injury)) return p.injury === 'Unknown' ? 'Team injury report not submitted' : p.injury;
  if (!['Not listed', 'Available', 'Probable'].includes(p.injury)) return 'Unknown injury status';
  const providerClear = ['combined','market'].includes(p.projectionMethod) || (rules.id === 'draftkings' && p.projectionMethod === 'trained') ? p.providerFlagsClear ?? p.providerClear : p.providerClear;
  if (!providerClear) return 'Unresolved provider injury flag';
  if (settings.startersOnly !== false && !p.starter) return 'Outside projected starting five';
  if (!Number.isFinite(p.minutes)) return 'Awaiting projected minutes';
  if (p.minutes < (settings.minMinutes ?? 24)) return 'Below minutes minimum';
  if (!eligibleSlots(p, rules.id).length || !Number.isInteger(p.salary) || p.salary < rules.minSalary || p.salary > rules.salaryCap) return `Invalid ${rules.name} salary or position`;
  return null;
}
