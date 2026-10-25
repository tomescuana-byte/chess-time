/* Runs a bot's game inside the player's browser.
   The Stockfish build ships its own worker mode, so it is started directly as a
   Worker and driven over UCI from here — the search runs off the main thread
   and the clock never stutters. */
import{fSet,fGet}from'./firebase.js';
import{TERM,legals,applyMove,toFEN,uciToMove}from'./engine.js';
import{botThinkTime,searchMs,strengthFor,BOT_BY_NAME}from'./bot-roster.js';
import{makeEngine}from'./sf-driver.js';

const SF_URL='/sf/stockfish-17.1-lite-single-03e3232.js';

/* About seven megabytes, so it is fetched the first time a bot is actually
   needed rather than on page load, and kept for the rest of the session. */
let enginePromise=null;
function engine(){
  if(enginePromise)return enginePromise;
  enginePromise=(async()=>{
    const w=new Worker(SF_URL);
    const e=makeEngine({
      send:c=>w.postMessage(c),
      subscribe:fn=>w.addEventListener('message',ev=>fn(ev.data))
    });
    await e.init();
    return e;
  })().catch(err=>{enginePromise=null;throw err;});
  return enginePromise;
}
// Called when the player opens Play, so the download overlaps with them reading
// the options instead of making them wait once a game has started.
export function prewarmEngine(){engine().catch(()=>{});}

const stateOf=g=>({board:JSON.parse(g.boardJson),turn:g.turn,castling:g.castling,
  enPassant:g.enPassant||null,fullMoves:g.fullMoves,halfMoves:g.halfMoves||0,
  rep:g.rep||{},status:g.status});

/* Writes a bot's move. The board is re-read first: the search takes seconds, and
   in that time the opponent may have resigned, offered a draw, or the game may
   have ended on time — so the move is checked against the live position rather
   than the one the search started from. */
async function playBotMove(gid,botColor,m){
  if(!m)return;
  const g=await fGet(`games/${gid}`);
  if(!g||g.turn!==botColor||TERM.includes(g.status))return;
  const gs=stateOf(g);
  if(!legals(gs.board,m.fr,m.fc,gs).some(([tr,tc])=>tr===m.tr&&tc===m.tc))return;
  const ngs=applyMove(gs,[m.fr,m.fc],[m.tr,m.tc],m.promo||null);
  const el=Date.now()-g.lastMoveTs;
  const nW=botColor==='w'?Math.max(0,g.whiteMs-el):g.whiteMs;
  const nB=botColor==='b'?Math.max(0,g.blackMs-el):g.blackMs;
  await fSet(`games/${gid}`,{...g,boardJson:JSON.stringify(ngs.board),turn:ngs.turn,
    castling:ngs.castling,enPassant:ngs.enPassant,fullMoves:ngs.fullMoves,
    halfMoves:ngs.halfMoves,rep:ngs.rep,status:ngs.status,
    whiteMs:nW,blackMs:nB,lastMoveTs:Date.now(),drawOffer:null});
  // The rating is settled by the game listener in the app, not here.
  if(TERM.includes(ngs.status))clearInterval(botGameInterval);
}

/* ─── Bot game manager ─── */
let botGameInterval=null;
let botThinking=false;

function startBotGame(gid,botName,botColor,botEloVal){
  clearInterval(botGameInterval);
  botThinking=false;
  const elo=BOT_BY_NAME[botName]?.elo??botEloVal??1200;
  const strength=strengthFor(elo);

  botGameInterval=setInterval(async()=>{
    if(botThinking)return;
    const g=await fGet(`games/${gid}`);
    if(!g||TERM.includes(g.status)){clearInterval(botGameInterval);botThinking=false;return;}
    if(g.turn!==botColor)return;
    const elapsed=Date.now()-g.lastMoveTs;
    if(botColor==='w'&&elapsed>g.whiteMs)return;
    if(botColor==='b'&&elapsed>g.blackMs)return;
    botThinking=true;

    try{
      const gs=stateOf(g);
      // A forced reply should come back instantly, the way a person's would.
      let legalCount=0;
      for(let r=0;r<8&&legalCount<2;r++)for(let c=0;c<8&&legalCount<2;c++){
        const p=gs.board[r][c];
        if(p&&(p===p.toUpperCase()?'w':'b')===botColor)legalCount+=legals(gs.board,r,c,gs).length;
      }
      const thinkMs=botThinkTime(elo,g,botColor,legalCount<=1);
      const eng=await engine();
      await eng.setStrength(strength);

      const t0=Date.now();
      const uci=await eng.bestMove(toFEN(gs),searchMs(elo,thinkMs),strength.pickWorse,strength.multipv);
      // Sit on the move for the rest of the intended thinking time, so the pause
      // the opponent sees comes from the bot's character, not from how fast the
      // machine happens to be.
      const wait=thinkMs-(Date.now()-t0);
      if(wait>0)await new Promise(r=>setTimeout(r,wait));
      await playBotMove(gid,botColor,uciToMove(uci));
    }catch(err){
      // Nothing to fall back on: better to leave the turn alone and retry on the
      // next tick than to play a move the engine never chose.
      console.warn('bot move failed:',err&&err.message||err);
    }finally{botThinking=false;}
  },500);
}

export*from'./bot-roster.js';
export{startBotGame};
