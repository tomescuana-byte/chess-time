/* Runs a bot's game inside the player's browser: a Web Worker does the search
   so the clock never stutters. The thinking itself lives in bot-roster.js. */
import{fSet,fGet}from'./firebase.js';
import{TERM,legals,applyMove}from'./engine.js';
import{botThinkTime,bestBotMove,maybeBlunder,scoredMoves}from'./bot-roster.js';

/* ─── Bot search, off the main thread ───
   A module worker loading the real engine, not a copy of it pasted into a
   string. The old inline copy had already drifted: it still treated stalemate
   as a win, long after that was fixed everywhere else. */
const _workerUrl=new URL("./bot-worker.js",import.meta.url);

const stateOf=g=>({board:JSON.parse(g.boardJson),turn:g.turn,castling:g.castling,
  enPassant:g.enPassant||null,fullMoves:g.fullMoves,halfMoves:g.halfMoves||0,
  rep:g.rep||{},status:g.status});

/* Writes a bot's move. The board is re-read first: the search takes seconds,
   and in that time the opponent may have resigned, offered a draw or the game
   may have ended on time, so the move is re-checked against the live position
   rather than the one the search started from. */
async function playBotMove(gid,botColor,m){
  if(!m)return;
  const g=await fGet(`games/${gid}`);
  if(!g||g.turn!==botColor||TERM.includes(g.status))return;
  const gs=stateOf(g);
  if(!legals(gs.board,m.fr,m.fc,gs).some(([tr,tc])=>tr===m.tr&&tc===m.tc))return;
  const ngs=applyMove(gs,[m.fr,m.fc],[m.tr,m.tc],null);
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

/* ─── Bot Game Manager ─── */
let botGameInterval=null;
let botThinking=false;
let botWorker=null;
function startBotGame(gid,botName,botColor,botEloVal,depth,blunder=0){
  clearInterval(botGameInterval);
  botThinking=false;
  if(botWorker){botWorker.terminate();botWorker=null;}
  botGameInterval=setInterval(async()=>{
    if(botThinking)return;
    const g=await fGet(`games/${gid}`);
    if(!g||TERM.includes(g.status)){clearInterval(botGameInterval);botThinking=false;return;}
    if(g.turn!==botColor)return;
    const elapsed=Date.now()-g.lastMoveTs;
    if(botColor==='w'&&elapsed>g.whiteMs)return;
    if(botColor==='b'&&elapsed>g.blackMs)return;
    botThinking=true;
    // A forced reply should come back instantly, the way a person's would.
    let onlyMove=false;
    try{
      const gsPeek={board:JSON.parse(g.boardJson),turn:g.turn,castling:g.castling,enPassant:g.enPassant||null,fullMoves:g.fullMoves,halfMoves:g.halfMoves||0,rep:g.rep||{},status:g.status};
      onlyMove=scoredMoves(gsPeek,botColor).length<=1;
    }catch{}
    // Use Web Worker so main thread (clock, UI) never blocks
    setTimeout(async()=>{
      try{
        const gF=await fGet(`games/${gid}`);
        if(!gF||gF.turn!==botColor||TERM.includes(gF.status)){botThinking=false;return;}
        const gsF={board:JSON.parse(gF.boardJson),turn:gF.turn,castling:gF.castling,enPassant:gF.enPassant||null,fullMoves:gF.fullMoves,halfMoves:gF.halfMoves||0,rep:gF.rep||{},status:gF.status};
        // Spin up a fresh worker for this move
        if(botWorker)botWorker.terminate();
        // Module workers need a real server and a browser that supports them.
        // Where either is missing, the move is searched here instead.
        let workerSupported=true;
        try{botWorker=new Worker(_workerUrl,{type:'module'});}catch(e){workerSupported=false;}
        if(!workerSupported){
          const m=maybeBlunder(gsF,botColor,bestBotMove(gsF,botColor,Math.min(depth,2)),blunder);
          await playBotMove(gid,botColor,m);
          botThinking=false;
          return;
        }
        botWorker.onmessage=async(e)=>{
          try{
            botWorker=null;
            await playBotMove(gid,botColor,maybeBlunder(gsF,botColor,e.data.move,blunder));
          }finally{botThinking=false;}
        };
        // If the worker cannot start, search here rather than leaving the bot
        // sitting there — a bot that stops moving looks like a frozen game.
        botWorker.onerror=async()=>{
          if(botWorker){botWorker.terminate();botWorker=null;}
          try{
            const g2=await fGet(`games/${gid}`);
            if(!g2||g2.turn!==botColor||TERM.includes(g2.status))return;
            const gs2=stateOf(g2);
            await playBotMove(gid,botColor,maybeBlunder(gs2,botColor,bestBotMove(gs2,botColor,Math.min(depth,2)),blunder));
          }catch{}
          finally{botThinking=false;}
        };
        botWorker.postMessage({gs:gsF,color:botColor,depth});
      }catch(err){botThinking=false;}
    },botThinkTime(botEloVal,g,botColor,onlyMove));
  },500);
}

export*from'./bot-roster.js';
export{startBotGame};
