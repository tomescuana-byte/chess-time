/* ═══ BLITZ ODDS — the bot ladder ═══
   Two scheduled jobs, nothing else:
     botPresence  marks which bots are around, every few minutes
     botLadder    plays bot-versus-bot games and moves their ratings

   Why games are played start to finish inside one invocation instead of a move
   at a time: these games exist to produce results, not to be watched. Simulating
   one costs a second or two of compute; streaming every move through the
   database would cost thousands of writes and reach every connected player.

   Everything stops when config/botsEnabled is false. */

import{onSchedule}from'firebase-functions/v2/scheduler';
import{logger}from'firebase-functions';
import{initializeApp}from'firebase-admin/app';
import{getDatabase}from'firebase-admin/database';

import{ib,legals,applyMove,TERM,pc}from'./shared/engine.js';
import{eloChg}from'./shared/rating.js';
import{BOTS,BOT_BY_NAME,onlineBotNames,botDepth,botBlunder,
        bestBotMove,maybeBlunder,evalBoard}from'./shared/bot-roster.js';

// The database URL is stated rather than inferred: the instance lives in
// europe-west1, and a default lookup has no reason to find it there.
initializeApp({databaseURL:'https://sah-handicap-timp-default-rtdb.europe-west1.firebasedatabase.app'});
const db=getDatabase();
const REGION='europe-west1';

const read=async p=>(await db.ref(p).get()).val();
const write=(p,v)=>db.ref(p).set(v);
const merge=(p,v)=>db.ref(p).update(v);

/* Settings live in the database so they can be changed without a deploy —
   including the switch that turns the whole thing off. */
async function settings(){
  const c=await read('config')||{};
  return{
    enabled:c.botsEnabled!==false,
    gamesPerRun:Math.min(120,Math.max(0,c.gamesPerRun??8)),
    maxSeconds:Math.min(240,Math.max(10,c.maxSeconds??120)),
    maxPlies:Math.min(400,Math.max(40,c.maxPlies??220))
  };
}

/* ── Presence ──────────────────────────────────────────────────────────────
   The roster decides who is around; this writes it where the app looks, so the
   count players see is real rather than computed separately on each device. */
export const botPresence=onSchedule(
  {schedule:'every 3 minutes',region:REGION,timeoutSeconds:60,memory:'256MiB',maxInstances:1},
  async()=>{
    const{enabled}=await settings();
    const online=enabled?onlineBotNames():new Set();
    const now=Date.now();
    const updates={};
    for(const b of BOTS){
      updates[b.name]=online.has(b.name)?{ts:now,status:'online'}:null;
    }
    await merge('presence',updates);
    logger.info(`presence: ${online.size} bots online`);
  });

/* ── The ladder ────────────────────────────────────────────────────────────
   Pairs bots of similar strength and plays them out. Ratings move the same way
   they do for people, so after enough games a bot's number means what it says. */
export const botLadder=onSchedule(
  {schedule:'every 10 minutes',region:REGION,timeoutSeconds:300,memory:'512MiB',maxInstances:1},
  async()=>{
    const cfg=await settings();
    if(!cfg.enabled){logger.info('bots disabled, skipping');return;}

    const deadline=Date.now()+cfg.maxSeconds*1000;
    let played=0,results={w:0,b:0,d:0};

    for(let i=0;i<cfg.gamesPerRun&&Date.now()<deadline;i++){
      const pair=await pickPair();
      if(!pair)break;
      const r=await playLadderGame(pair[0],pair[1],cfg.maxPlies);
      played++;
      results[r.outcome==='white'?'w':r.outcome==='black'?'b':'d']++;
    }
    logger.info(`ladder: ${played} games (W${results.w} B${results.b} D${results.d})`);
  });

/* Current ratings for the whole roster, falling back to each bot's seed. */
async function ratings(){
  const lb=await read('leaderboard')||{};
  return BOTS.map(b=>({name:b.name,elo:lb[b.name]?.elo??b.seed}));
}

/* Two bots close in rating. Close pairings are what actually sorts a ladder —
   a 1900 beating a 700 teaches the system almost nothing. */
async function pickPair(){
  const all=await ratings();
  if(all.length<2)return null;
  const a=all[Math.floor(Math.random()*all.length)];
  const near=all
    .filter(x=>x.name!==a.name&&Math.abs(x.elo-a.elo)<=300)
    .sort(()=>Math.random()-0.5);
  const b=near[0]||all.find(x=>x.name!==a.name);
  return b?[a,b]:null;
}

/* Plays one game to the end and writes both ratings. No clocks: these games are
   decided by the position, and a timeout would only record who ran out of
   simulated time. Unresolved games are adjudicated on material. */
async function playLadderGame(botA,botB,maxPlies){
  const whiteFirst=Math.random()<0.5;
  const white=whiteFirst?botA:botB, black=whiteFirst?botB:botA;
  const cfgFor=n=>{const e=BOT_BY_NAME[n.name];return{depth:botDepth(n.elo),blunder:botBlunder(n.elo),seed:e?.seed};};
  const wc=cfgFor(white), bc=cfgFor(black);

  let gs={board:ib(),turn:'w',castling:{wK:true,wQ:true,bK:true,bQ:true},
          enPassant:null,fullMoves:1,halfMoves:0,rep:{},status:'ongoing'};

  let plies=0;
  while(!TERM.includes(gs.status)&&plies<maxPlies){
    const side=gs.turn==='w'?wc:bc;
    // Depth 4 is affordable here because there is no clock to keep responsive.
    const best=bestBotMove(gs,gs.turn,side.depth);
    if(!best)break;
    const m=maybeBlunder(gs,gs.turn,best,side.blunder);
    gs=applyMove(gs,[m.fr,m.fc],[m.tr,m.tc],'q');
    plies++;
  }

  let outcome;
  if(gs.status==='white_wins')outcome='white';
  else if(gs.status==='black_wins')outcome='black';
  else if(TERM.includes(gs.status))outcome='draw';
  else{
    // Ran long: give it to whoever is clearly ahead, otherwise call it a draw.
    const score=evalBoard(gs.board);
    outcome=score>150?'white':score<-150?'black':'draw';
  }

  const wScore=outcome==='white'?1:outcome==='draw'?0.5:0;
  await settle(white,black,wScore);
  return{outcome,plies};
}

/* Writes both ratings and one history entry each. Ladder games carry no time
   odds, so the clock multiplier in eloChg is neutral (equal milliseconds). */
async function settle(white,black,wScore){
  const lb=await read('leaderboard')||{};
  const wE=lb[white.name]?.elo??white.elo;
  const bE=lb[black.name]?.elo??black.elo;
  const even=180000;
  const wC=eloChg(wE,bE,wScore,even,even);
  const bC=eloChg(bE,wE,1-wScore,even,even);
  const nw=Math.max(100,wE+wC), nb=Math.max(100,bE+bC);
  const ts=Date.now();
  const res=s=>s===1?'win':s===0?'loss':'draw';

  await merge('leaderboard',{
    [white.name]:{elo:nw,isBot:true},
    [black.name]:{elo:nb,isBot:true}
  });
  await Promise.all([
    db.ref(`history/${white.name}`).push({elo:nw,ts,opponent:black.name,result:res(wScore),eloDelta:wC,ladder:true}),
    db.ref(`history/${black.name}`).push({elo:nb,ts,opponent:white.name,result:res(1-wScore),eloDelta:bC,ladder:true})
  ]);
}
