// Synthetic predictions for tests only. Never publish these as model outputs.
import {teamContext} from '../src/projections.js';
export function modelFixture(slate) {
  return {schemaVersion:1,platform:'yahoo',date:slate.date,inputsAt:slate.updatedAt,generatedAt:slate.updatedAt,
    trainedThrough:'2026-10-20',historyThrough:'2026-10-20',modelVersion:'synthetic-test-only',
    teamContexts:Object.fromEntries([...new Set(slate.players.map(p=>p.team))].map(t=>[t,teamContext(slate.players,t)])),
    players:slate.players.map((p,i)=>({id:p.id,team:p.team,opponent:p.opponent,game:p.game,tipoff:p.tipoff,
      points:p.projection == null ? 0 : 20+(i%35),minutes:p.minutes ?? 0}))};
}
