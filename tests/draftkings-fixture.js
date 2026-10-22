// Synthetic inputs for deterministic optimizer/UI checks, never published data.
export function draftKingsFixture() {
  const positions=['PG','SG','PG/SG','SF','PF','SF/PF','C','PF/C','SG/SF','PG','SF','C'];
  return {schemaVersion:1,platform:'draftkings',id:'dk-123',date:'2026-10-21',updatedAt:'2026-10-21T17:20:00Z',firstTip:'2026-10-21T23:00:00Z',injuryReportedAt:'2026-10-21T17:15:00Z',ready:true,salaryCap:50000,
    model:{name:'DraftKings projections'},sources:{},contestUrl:'https://www.draftkings.com/lineup/draftteam?draftGroupId=123',
    games:[{id:'a',away:'AAA',home:'BBB',matchup:'AAA@BBB',tipoff:'2026-10-21T23:00:00Z'},{id:'b',away:'CCC',home:'DDD',matchup:'CCC@DDD',tipoff:'2026-10-22T01:00:00Z'}],
    players:positions.map((position,i)=>({id:String(900+i),name:`Fixture Player ${i}`,position,team:['AAA','BBB','CCC','DDD'][i%4],opponent:['BBB','AAA','DDD','CCC'][i%4],game:i%4<2?'AAA@BBB':'CCC@DDD',salary:3800+i*400,projection:24+i*2,minutes:30,starter:true,starterStatus:'projected',sourceCount:1,sources:{fuel:24+i*2},providerClear:true,injury:'Not listed',newPlayer:i===10,tipoff:i%4<2?'2026-10-21T23:00:00Z':'2026-10-22T01:00:00Z'}))};
}
