import{fSet,fGet,fPush}from'./firebase.js';
import{h2hKey}from'./utils.js';

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
  const pD=await fGet(`players/${playerName}`);
  const pE=pD?.elo||1000;
  const iWMs=game.initWhiteMs||game.whiteMs,iBMs=game.initBlackMs||game.blackMs;
  const myMs=playerColor==='w'?iWMs:iBMs,oppMs=playerColor==='w'?iBMs:iWMs;
  const pChg=eloChg(pE,botEloVal,pScore,myMs,oppMs);
  const nPE=pE+pChg;
  const pH=[...(pD?.eloHistory||[]),{elo:nPE,ts:Date.now(),gameId:gid,opponent:game.botName||'Bot',result:pScore===1?'win':pScore===0?'loss':'draw',eloDelta:pChg}];
  await fSet(`players/${playerName}`,{...(pD||{}),elo:nPE,eloHistory:pH.slice(-50)});
  // Also update bot's ELO in Firebase so leaderboard reflects it
  const botName=game.botName;
  if(botName){
    const botD=await fGet(`players/${botName}`);
    const botCurElo=botD?.elo??botEloVal;
    const botScore=1-pScore;
    const botChg=eloChg(botCurElo,pE,botScore,oppMs,myMs);
    const nBotE=Math.max(100,botCurElo+botChg);
    const botH=[...(botD?.eloHistory||[]),{elo:nBotE,ts:Date.now(),gameId:gid,opponent:playerName,result:botScore===1?'win':botScore===0?'loss':'draw',eloDelta:botChg}];
    await fSet(`players/${botName}`,{...(botD||{}),elo:nBotE,eloHistory:botH.slice(-50),isBot:true});
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
  const[wD,bD]=await Promise.all([fGet(`players/${game.white}`),fGet(`players/${game.black}`)]);
  const wE=wD?.elo||1000,bE=bD?.elo||1000;
  const iW=game.initWhiteMs||game.whiteMs,iB=game.initBlackMs||game.blackMs;
  const wC=eloChg(wE,bE,wSc,iW,iB),bC=eloChg(bE,wE,bSc,iB,iW);
  const ts=Date.now(),nwE=wE+wC,nbE=bE+bC;
  const wH=[...(wD?.eloHistory||[]),{elo:nwE,ts,gameId:gid,opponent:game.black,result:wSc===1?'win':wSc===0?'loss':'draw',eloDelta:wC}];
  const bH=[...(bD?.eloHistory||[]),{elo:nbE,ts,gameId:gid,opponent:game.white,result:bSc===1?'win':bSc===0?'loss':'draw',eloDelta:bC}];
  await Promise.all([fSet(`players/${game.white}`,{...(wD||{}),elo:nwE,eloHistory:wH.slice(-50)}),fSet(`players/${game.black}`,{...(bD||{}),elo:nbE,eloHistory:bH.slice(-50)})]);
  const key=h2hKey(game.white,game.black);const h=await fGet(`h2h/${key}`)||{};
  await fSet(`h2h/${key}`,{...h,[game.white]:(h[game.white]||0)+(wSc===1?1:0),[game.black]:(h[game.black]||0)+(bSc===1?1:0),draws:(h.draws||0)+(wSc===0.5?1:0)});
  const rec={gid,white:game.white,black:game.black,wScore:wSc,bScore:bSc,wEloDelta:wC,bEloDelta:bC,ts,initWhiteMs:iW,initBlackMs:iB};
  await Promise.all([fPush(`playerGames/${game.white}`,rec),fPush(`playerGames/${game.black}`,rec)]);
}


export{calcAutoTime,applyAutoTime,eloChg,finalizeGame,finalizeBotGame,resetBotEloLock};
