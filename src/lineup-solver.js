import solver from 'javascript-lp-solver';

// Workers freeze Date.now() during CPU-only work, so the library's timeout is
// not a reliable stop condition there. Bound matrix work on this model instance
// as well, without modifying global clocks or weakening the objective.
export function solveLineupModel(input,{maxWork=2_000_000_000}={}) {
  const model=new solver.Model(undefined,undefined,solver.selectBranchAndCutService(input)).loadJson(input),tableau=model.tableau;
  let work=0;
  for(const operation of ['simplex','pivot']){
    const original=tableau[operation];
    tableau[operation]=function(...args){
      work+=this.width*this.height;
      if(work>maxWork){
        const error=new Error('This lineup search is too complex for one build. Narrow the player pool or choose a smaller slate, then generate again.');
        error.status=503;error.code='solver_limit';throw error;
      }
      return original.apply(this,args);
    };
  }
  return solver.Solve(model);
}
