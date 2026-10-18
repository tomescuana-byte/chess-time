import{fSet,fGet,fPush,fUpdate}from'./firebase.js';
import{h2hKey}from'./utils.js';

/* ── Where a rating lives ──────────────────────────────────────────────────
   leaderboard/{name} = { elo, isBot }   small, and every client subscribes to it
   players/{name}     = identity + profile fields, read on demand
   history/{name}     = one pushed entry per game, read only when a profile opens
   Keeping the history out of the subscribed node is what makes bots playing
   round the clock affordable: a rating change pushes ~40 bytes to each client
   instead of the whole players tree. */
const readElo=async name=>(await fGet(`leaderboard/${name}/elo`))??(await fGet(`players/${name}/elo`))??null;
async function writeRating(name,elo,isBot,entry){
  await fUpdate(`leaderboard/${name}`,{elo,isBot:!!isBot});
  await fPush(`history/${name}`,entry);
}

function calcAutoTime(eloA,eloB){const BASE=180,STEP=15,STEP_ELO=50,MIN_S=60,MAX_W=600;const diff=Math.abs(eloA-eloB),steps=Math.floor(diff/STEP_ELO);if(steps===0)return{strongerSec:BASE,weakerSec:BASE};const ph1=Math.floor((BASE-MIN_S)/STEP),s1=Math.min(steps,ph1);return{strongerSec:BASE-s1*STEP,weakerSec:Math.min(MAX_W,BASE+(steps-s1)*STEP)};}
function applyAutoTime(myElo,oppElo){const{strongerSec,weakerSec}=calcAutoTime(myElo,oppElo);const strong=myElo>=oppElo;return{mySec:strong?strongerSec:weakerSec,oppSec:strong?weakerSec:strongerSec};}

function eloChg(myE,oppE,score,myMs,oppMs){const exp=1/(1+Math.pow(10,(oppE-myE)/400));return Math.round(Math.round(32*Math.min(4,Math.max(0.5,oppMs/myMs)))*(score-exp));}

/* Settles a human-vs-bot game: both the player's and the bot's rating are written.
   `me` is the human playing it, passed in rather than read from UI state so this
   file stays free of any dependency on the interface. */
let _botEloLock=false; // in-memory lock — set synchronously before any await
function resetBotEloLock(){_botEloLock=false;}
async function finalizeBotGame(game,gid,me){
  if(_botEloLock||game.eloUpdated)return;
  _botEloLock=true; // grabbed synchronously — second concurrent call sees true immediately
  await fSet(`games/${gid}`,{...game,eloUpdated:true});
  const playerName=me;
  const playerColor=game.white===me?'w':'b';
  const botEloVal=game.botElo||1000;
  let pScore;
  if(['white_wins','black_timeout','resigned_black'].includes(game.status))pScore=playerColor==='w'?1:0;
  else if(['black_wins','white_timeout','resigned_white'].includes(game.status))pScore=playerColor==='w'?0:1;
  else pScore=0.5;
  const pE=(await readElo(playerName))??1000;
  const iWMs=game.initWhiteMs||game.whiteMs,iBMs=game.initBlackMs||game.blackMs;
  const myMs=playerColor==='w'?iWMs:iBMs,oppMs=playerColor==='w'?iBMs:iWMs;
  // Casual games and direct challenges are played for their own sake: the result
  // is recorded, the ratings do not move.
  const rated=game.rated!==false;
  const pChg=rated?eloChg(pE,botEloVal,pScore,myMs,oppMs):0;
  const nPE=pE+pChg,ts=Date.now();
  if(rated){
    await writeRating(playerName,nPE,false,{elo:nPE,ts,gameId:gid,opponent:game.botName||'Bot',result:pScore===1?'win':pScore===0?'loss':'draw',eloDelta:pChg});
    const botName=game.botName;
    if(botName){
      const botCurElo=(await readElo(botName))??botEloVal;
      const botScore=1-pScore;
      const botChg=eloChg(botCurElo,pE,botScore,oppMs,myMs);
      const nBotE=Math.max(100,botCurElo+botChg);
      await writeRating(botName,nBotE,true,{elo:nBotE,ts,gameId:gid,opponent:playerName,result:botScore===1?'win':botScore===0?'loss':'draw',eloDelta:botChg});
    }
  }
  const wScore=playerColor==='w'?pScore:(1-pScore),bScore=playerColor==='b'?pScore:(1-pScore);
  const rec={gid,white:game.white,black:game.black,wScore,bScore,wEloDelta:playerColor==='w'?pChg:0,bEloDelta:playerColor==='b'?pChg:0,ts:Date.now(),initWhiteMs:iWMs,initBlackMs:iBMs};
  await fPush(`playerGames/${playerName}`,rec);
}

/* Regular (human vs human) ELO: only white player runs this to avoid double-update */
// `me` is the player running this code: only White settles the game, so the two
// clients never both write ELO.
async function finalizeGame(game,gid,me){
  if(game.isBot)return; // bot games handled by finalizeBotGame
  if(game.white!==me||game.eloUpdated)return;
  await fSet(`games/${gid}`,{...game,eloUpdated:true});
  let wSc,bSc;
  if(['white_wins','black_timeout','resigned_black'].includes(game.status)){wSc=1;bSc=0;}
  else if(['black_wins','white_timeout','resigned_white'].includes(game.status)){wSc=0;bSc=1;}
  else{wSc=0.5;bSc=0.5;}
  const[wE0,bE0]=await Promise.all([readElo(game.white),readElo(game.black)]);
  const wE=wE0??1000,bE=bE0??1000;
  const iW=game.initWhiteMs||game.whiteMs,iB=game.initBlackMs||game.blackMs;
  const rated=game.rated!==false;
  const wC=rated?eloChg(wE,bE,wSc,iW,iB):0,bC=rated?eloChg(bE,wE,bSc,iB,iW):0;
  const ts=Date.now(),nwE=wE+wC,nbE=bE+bC;
  if(rated)await Promise.all([
    writeRating(game.white,nwE,false,{elo:nwE,ts,gameId:gid,opponent:game.black,result:wSc===1?'win':wSc===0?'loss':'draw',eloDelta:wC}),
    writeRating(game.black,nbE,false,{elo:nbE,ts,gameId:gid,opponent:game.white,result:bSc===1?'win':bSc===0?'loss':'draw',eloDelta:bC})
  ]);
  const key=h2hKey(game.white,game.black);const h=await fGet(`h2h/${key}`)||{};
  await fSet(`h2h/${key}`,{...h,[game.white]:(h[game.white]||0)+(wSc===1?1:0),[game.black]:(h[game.black]||0)+(bSc===1?1:0),draws:(h.draws||0)+(wSc===0.5?1:0)});
  const rec={gid,white:game.white,black:game.black,wScore:wSc,bScore:bSc,wEloDelta:wC,bEloDelta:bC,ts,initWhiteMs:iW,initBlackMs:iB};
  await Promise.all([fPush(`playerGames/${game.white}`,rec),fPush(`playerGames/${game.black}`,rec)]);
}


export{calcAutoTime,applyAutoTime,eloChg,finalizeGame,finalizeBotGame,resetBotEloLock};
