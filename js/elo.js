import{fSet,fGet,fPush,fUpdate,fClaim}from'./firebase.js';
import{h2hKey}from'./utils.js';
import{calcAutoTime,applyAutoTime,eloChg,provisionalMult}from'./rating.js';

/* ── Where a rating lives ──────────────────────────────────────────────────
   leaderboard/{name} = { elo, isBot }   small, and every client subscribes to it
   players/{name}     = identity + profile fields, read on demand
   history/{name}     = one pushed entry per game, read only when a profile opens
   Keeping the history out of the subscribed node is what makes bots playing
   round the clock affordable: a rating change pushes ~40 bytes to each client
   instead of the whole players tree. */
const readElo=async name=>(await fGet(`leaderboard/${name}/elo`))??(await fGet(`players/${name}/elo`))??null;
const readRow=async name=>(await fGet(`leaderboard/${name}`))||{};

/* The multiplier a player's next rated game carries. Bots never get it: their
   rating is set deliberately, not discovered. */
const multFor=row=>row.isBot?1:provisionalMult(row.games);

async function writeRating(name,elo,isBot,entry,games){
  await fUpdate(`leaderboard/${name}`,{elo,isBot:!!isBot,games:(games||0)+1});
  await fPush(`history/${name}`,entry);
}


/* Settles a human-vs-bot game: both the player's and the bot's rating are written.
   `me` is the human playing it, passed in rather than read from UI state so this
   file stays free of any dependency on the interface. */
let _botEloLock=false; // in-memory lock — set synchronously before any await
function resetBotEloLock(){_botEloLock=false;}
async function finalizeBotGame(game,gid,me){
  if(_botEloLock||game.eloUpdated)return;
  _botEloLock=true; // grabbed synchronously — second concurrent call sees true immediately
  if(!await fClaim(`games/${gid}/eloUpdated`)){_botEloLock=false;return;}
  const playerName=me;
  const playerColor=game.white===me?'w':'b';
  const botEloVal=game.botElo||1000;
  let pScore;
  if(['white_wins','black_timeout','resigned_black'].includes(game.status))pScore=playerColor==='w'?1:0;
  else if(['black_wins','white_timeout','resigned_white'].includes(game.status))pScore=playerColor==='w'?0:1;
  else pScore=0.5;
  const pRow=await readRow(playerName);
  const pE=pRow.elo??1000;
  const iWMs=game.initWhiteMs||game.whiteMs,iBMs=game.initBlackMs||game.blackMs;
  const myMs=playerColor==='w'?iWMs:iBMs,oppMs=playerColor==='w'?iBMs:iWMs;
  // Casual games and direct challenges are played for their own sake: the result
  // is recorded, the ratings do not move.
  const rated=game.rated!==false;
  const pChg=rated?eloChg(pE,botEloVal,pScore,myMs,oppMs,multFor(pRow)):0;
  const nPE=pE+pChg,ts=Date.now();
  if(rated){
    await writeRating(playerName,nPE,false,{elo:nPE,ts,gameId:gid,opponent:game.botName||'Unknown',result:pScore===1?'win':pScore===0?'loss':'draw',eloDelta:pChg},pRow.games);
    const botName=game.botName;
    if(botName){
      const bRow=await readRow(botName);
      const botCurElo=bRow.elo??botEloVal;
      const botScore=1-pScore;
      const botChg=eloChg(botCurElo,pE,botScore,oppMs,myMs,1);
      const nBotE=Math.max(100,botCurElo+botChg);
      await writeRating(botName,nBotE,true,{elo:nBotE,ts,gameId:gid,opponent:playerName,result:botScore===1?'win':botScore===0?'loss':'draw',eloDelta:botChg},bRow.games);
    }
  }
  const wScore=playerColor==='w'?pScore:(1-pScore),bScore=playerColor==='b'?pScore:(1-pScore);
  const rec={gid,white:game.white,black:game.black,wScore,bScore,wEloDelta:playerColor==='w'?pChg:0,bEloDelta:playerColor==='b'?pChg:0,ts:Date.now(),initWhiteMs:iWMs,initBlackMs:iBMs};
  await fPush(`playerGames/${playerName}`,rec);
}

/* Regular (human vs human) ELO: only white player runs this to avoid double-update */
/* Either player settles the game — whoever gets there first wins an atomic claim
   on the eloUpdated flag, and the other backs off. Previously only White could
   settle, so if White closed the tab at the end nobody ever wrote the ratings
   and the result was silently lost for both players. */
async function finalizeGame(game,gid,me){
  if(game.isBot)return; // bot games handled by finalizeBotGame
  if(game.eloUpdated||(game.white!==me&&game.black!==me))return;
  if(!await fClaim(`games/${gid}/eloUpdated`))return;
  let wSc,bSc;
  if(['white_wins','black_timeout','resigned_black'].includes(game.status)){wSc=1;bSc=0;}
  else if(['black_wins','white_timeout','resigned_white'].includes(game.status)){wSc=0;bSc=1;}
  else{wSc=0.5;bSc=0.5;}
  const[wRow,bRow]=await Promise.all([readRow(game.white),readRow(game.black)]);
  const wE=wRow.elo??1000,bE=bRow.elo??1000;
  const iW=game.initWhiteMs||game.whiteMs,iB=game.initBlackMs||game.blackMs;
  const rated=game.rated!==false;
  // Each side's own newcomer multiplier: a first-timer can swing a long way
  // while the established opponent moves by a normal amount.
  const wC=rated?eloChg(wE,bE,wSc,iW,iB,multFor(wRow)):0;
  const bC=rated?eloChg(bE,wE,bSc,iB,iW,multFor(bRow)):0;
  const ts=Date.now(),nwE=wE+wC,nbE=bE+bC;
  if(rated)await Promise.all([
    writeRating(game.white,nwE,false,{elo:nwE,ts,gameId:gid,opponent:game.black,result:wSc===1?'win':wSc===0?'loss':'draw',eloDelta:wC},wRow.games),
    writeRating(game.black,nbE,false,{elo:nbE,ts,gameId:gid,opponent:game.white,result:bSc===1?'win':bSc===0?'loss':'draw',eloDelta:bC},bRow.games)
  ]);
  const key=h2hKey(game.white,game.black);const h=await fGet(`h2h/${key}`)||{};
  await fSet(`h2h/${key}`,{...h,[game.white]:(h[game.white]||0)+(wSc===1?1:0),[game.black]:(h[game.black]||0)+(bSc===1?1:0),draws:(h.draws||0)+(wSc===0.5?1:0)});
  const rec={gid,white:game.white,black:game.black,wScore:wSc,bScore:bSc,wEloDelta:wC,bEloDelta:bC,ts,initWhiteMs:iW,initBlackMs:iB};
  await Promise.all([fPush(`playerGames/${game.white}`,rec),fPush(`playerGames/${game.black}`,rec)]);
}


export{calcAutoTime,applyAutoTime,eloChg,finalizeGame,finalizeBotGame,resetBotEloLock};
