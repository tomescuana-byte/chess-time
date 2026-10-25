/* Drives a Stockfish instance over UCI.
   Loading the engine differs between a browser worker and the server, so this
   file takes a `send` and a line stream and knows nothing about either. */

export function makeEngine({send,subscribe}){
  const waiters=[];           // {test, resolve}
  let lines=[];               // output since the last search started

  subscribe(raw=>{
    const line=String(raw||'');
    lines.push(line);
    for(let i=waiters.length-1;i>=0;i--){
      if(waiters[i].test(line)){waiters.splice(i,1)[0].resolve(line);}
    }
  });

  const waitFor=(test,ms=30000)=>new Promise((resolve,reject)=>{
    const w={test,resolve};
    waiters.push(w);
    setTimeout(()=>{
      const i=waiters.indexOf(w);
      if(i>=0){waiters.splice(i,1);reject(new Error('engine timed out'));}
    },ms);
  });

  let current={};             // options already applied, to avoid resending

  async function init(){
    send('uci');
    await waitFor(l=>l.startsWith('uciok'));
    send('setoption name Threads value 1');
    send('setoption name Hash value 16');
    send('isready');
    await waitFor(l=>l.startsWith('readyok'));
  }

  async function setStrength(s){
    if(current.uciElo===s.uciElo&&current.skill===s.skill&&
       current.limitStrength===s.limitStrength&&current.multipv===s.multipv)return;
    send(`setoption name UCI_LimitStrength value ${s.limitStrength}`);
    if(s.limitStrength)send(`setoption name UCI_Elo value ${s.uciElo}`);
    send(`setoption name Skill Level value ${s.skill}`);
    send(`setoption name MultiPV value ${s.multipv}`);
    send('isready');
    await waitFor(l=>l.startsWith('readyok'));
    current={...s};
  }

  /* Returns the move as a UCI string. With MultiPV the engine reports several
     candidate lines; a weak bot sometimes plays one of the lesser ones, which
     is a move a weaker player would plausibly choose rather than a random one. */
  async function bestMove(fen,movetime,pickWorse=0,multipv=1){
    lines=[];
    send('position fen '+fen);
    send('go movetime '+Math.max(40,Math.round(movetime)));
    const done=await waitFor(l=>l.startsWith('bestmove'));
    const best=done.split(/\s+/)[1];
    if(!best||best==='(none)')return null;
    if(multipv<2||Math.random()>=pickWorse)return best;

    // Last reported first move of each line, keyed by its rank.
    const byRank=new Map();
    for(const l of lines){
      const m=/\bmultipv (\d+)\b.*?\bpv ([a-h][1-8][a-h][1-8][qrbn]?)/.exec(l);
      if(m)byRank.set(Number(m[1]),m[2]);
    }
    const alts=[...byRank.entries()].filter(([r])=>r>1).sort((a,b)=>a[0]-b[0]).map(([,mv])=>mv);
    if(!alts.length)return best;
    // Favour the near-misses over the worst option available.
    const weights=alts.map((_,i)=>1/(i+1));
    let roll=Math.random()*weights.reduce((a,b)=>a+b,0);
    for(let i=0;i<alts.length;i++){roll-=weights[i];if(roll<=0)return alts[i];}
    return alts[0];
  }

  return{init,setStrength,bestMove};
}
