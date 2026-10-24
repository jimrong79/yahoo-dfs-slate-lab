// Synthetic predictions for tests only. Never publish these as model outputs.
import {teamContext} from '../src/projections.js';
export function modelFixture(slate) {
  return {schemaVersion:1,platform:'yahoo',date:slate.date,inputsAt:slate.updatedAt,generatedAt:slate.updatedAt,
    trainedThrough:'2026-10-20',historyThrough:'2026-10-20',modelVersion:'synthetic-test-only',
    teamContexts:Object.fromEntries([...new Set(slate.players.map(p=>p.team))].map(t=>[t,teamContext(slate.players,t)])),
    players:slate.players.map((p,i)=>({id:p.id,team:p.team,opponent:p.opponent,game:p.game,tipoff:p.tipoff,
      points:p.projection == null ? 0 : 20+(i%35),minutes:p.minutes ?? 0}))};
}

export function combinedFixture(slate, ids) {
  const value=structuredClone(slate);
  value.combinedReady=true;
  value.players.forEach(p=>{p.providerFlagsClear=p.providerClear;});
  const selected=ids.map(id=>value.players.find(p=>p.id===id));
  const original=selected.map(p=>({points:p.projection,minutes:p.minutes}));
  selected.forEach((p,i)=>{
    p.sources={sportsline:i===0?original[i].points:null,fuel:i===1?original[i].points:null};
    p.projection=null;p.sourceCount=i===2?0:1;p.providerClear=i===1;p.providerFlagsClear=true;
    if (i>0) p.minutes=null;
  });
  const model=modelFixture(value);
  ids.forEach((id,i)=>Object.assign(model.players.find(p=>p.id===id),original[i]));
  return {slate:value,model};
}
