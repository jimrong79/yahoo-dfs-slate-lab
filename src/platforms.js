export const YAHOO_SLOTS = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL'];
export const ELIGIBILITY = { PG:['PG','G','UTIL'], SG:['SG','G','UTIL'], SF:['SF','F','UTIL'], PF:['PF','F','UTIL'], C:['C','UTIL'] };
const RULES = {
  yahoo:{id:'yahoo',name:'Yahoo',salaryCap:200,minSalary:10,slots:YAHOO_SLOTS,minTeams:3,maxPerTeam:6,minGames:1,projectionSources:2,valueUnit:1},
  draftkings:{id:'draftkings',name:'DraftKings',salaryCap:50000,minSalary:3000,slots:['PG','SG','SF','PF','C','G','F','UTIL'],minTeams:2,maxPerTeam:7,minGames:2,projectionSources:1,valueUnit:1000},
};
export function platformRules(value = 'yahoo') {
  const id = typeof value === 'string' ? value : value?.platform || 'yahoo';
  if (!RULES[id]) throw new Error('Unsupported fantasy platform.');
  return RULES[id];
}
export function eligibleSlots(player, platform = 'yahoo') {
  const positions = String(player.position || '').split('/');
  if (!positions.length || positions.some(p => !ELIGIBILITY[p]) || (platformRules(platform).id === 'yahoo' && positions.length !== 1)) return [];
  return [...new Set(positions.flatMap(p => ELIGIBILITY[p]))];
}
export const money = value => `$${Number(value).toLocaleString('en-US')}`;
