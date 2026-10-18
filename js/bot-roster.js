/* Bot roster, strength ladder, evaluation and move search.
   Pure: no DOM, no Firebase, no browser APIs — the server imports this file as
   it stands, so the bots that play on the ladder are the same bots you meet. */
import{pc,legals,applyMove}from'./engine.js';
import{applyAutoTime}from'./rating.js';

/* The roster. `seed` is where calibration should eventually place each bot — it is
   the starting rating only, and moves from there as the bot plays. Ratings are
   deliberately capped below 2000 so a strong human can realistically reach #1. */
const BOTS = [
  {name:'789',             flag:'China',       seed:650},
  {name:'firstgrader',     flag:'USA',         seed:720},
  {name:'thekid',          flag:'USA',         seed:800},
  {name:'Pompkin',         flag:'Sweden',      seed:880},
  {name:'meatball20',      flag:'USA',         seed:950},
  {name:'JJLOVELOVE',      flag:'Thailand',    seed:1010},
  {name:'RabbitRain',      flag:'Japan',       seed:1070},
  {name:'Nounours Sucre',  flag:'France',      seed:1130},
  {name:'sorryimlikethis', flag:'Australia',   seed:1180},
  {name:'carzen17',        flag:'Japan',       seed:1230},
  {name:'Enni10',          flag:'Germany',     seed:1280},
  {name:'mikim',           flag:'Russia',      seed:1320},
  {name:'Julian1994',      flag:'Germany',     seed:1360},
  {name:'Onyx37',          flag:'France',      seed:1400},
  {name:'champion16',      flag:'Taiwan',      seed:1440},
  {name:'ElerCant',        flag:'Kazakhstan',  seed:1480},
  {name:'Norimsoo',        flag:'South Korea', seed:1520},
  {name:'Chapelier7',      flag:'France',      seed:1560},
  {name:'MadCassowary',    flag:'France',      seed:1600},
  {name:'lincoln9818',     flag:'China',       seed:1650},
  {name:'sprockitz',       flag:'USA',         seed:1700},
  {name:'Weapenguin',      flag:'Canada',      seed:1750},
  {name:'Flosimelator',    flag:'Germany',     seed:1800},
  {name:'slywww2020',      flag:'',            seed:1850},
  {name:'Komandor Tarkin', flag:'Poland',      seed:1880},
  {name:'ArsèneLupin44',   flag:'France',      seed:1920},
  {name:'Forevergm',       flag:'',            seed:1950}
];
const BOT_NAMES = BOTS.map(b=>b.name);
const BOT_BY_NAME = Object.fromEntries(BOTS.map(b=>[b.name,b]));
const isBotName = n => Object.prototype.hasOwnProperty.call(BOT_BY_NAME,n);

function botElo(idx) {
  const b = BOTS[idx];
  return b ? b.seed : 1000;
}

/* Strength has two knobs, not one. Depth alone gave only three distinct bots
   across the whole ladder; the blunder rate is what separates 1200 from 1900.
   `blunder` is the chance of playing a deliberately worse move. */
function botDepth(elo) {
  if(elo < 800)  return 1;
  if(elo < 1200) return 2;
  if(elo < 1700) return 3;
  return 4;
}
function botBlunder(elo) {
  if(elo < 800)  return 0.45;
  if(elo < 1000) return 0.34;
  if(elo < 1200) return 0.26;
  if(elo < 1400) return 0.19;
  if(elo < 1600) return 0.13;
  if(elo < 1800) return 0.08;
  return 0.04;
}

/* How long a bot sits on a move. Real players spend time in proportion to what
   is left on their clock, not a fixed amount — and they are erratic about it.
   Never spends so long that the bot flags on its own bookkeeping. */
function botThinkTime(elo, game, botColor, onlyMove) {
  const left = (botColor === 'w' ? game.whiteMs : game.blackMs) || 180000;
  if(onlyMove) return 300 + Math.random() * 500;       // forced reply: near-instant
  const movesLeft = Math.max(12, 42 - (game.fullMoves || 1));
  const budget = left / movesLeft;
  let t = budget * (0.3 + Math.random() * 1.9);
  if(Math.random() < 0.08) t *= 2.5;                   // the occasional long think
  t = Math.min(t, left * 0.22, 25000);                 // never burn the clock down
  return Math.max(400, t);
}

/* Whether a bot takes the challenge. Bots that accept everything instantly read
   as machines; the delay and the refusals are most of what makes them feel real. */
function botAcceptsChallenge(botEloVal, myElo, myMs, botMs) {
  const totalMin = (myMs + botMs) / 120000;
  if(totalMin > 25) return {ok:false, why:'is not up for a game that long right now.'};
  if(botMs < 45000) return {ok:false, why:'does not want that little time on the clock.'};
  /* Lopsided clocks are the whole point of this app, so "unfair" cannot mean
     "uneven". Fair is whatever the rating gap justifies; the bot only objects to
     being given noticeably less than that. */
  const fairSec = applyAutoTime(botEloVal, myElo).mySec;
  if(botMs < fairSec * 1000 * 0.7) return {ok:false, why:'thinks those odds are too steep.'};
  if(Math.random() < 0.22) return {ok:false, why:'declined the challenge.'};
  return {ok:true, why:''};
}
// How long the bot "thinks about it" before answering a challenge.
const botReplyDelay = () => 2500 + Math.random() * 11000;

/* ─── Piece values ─── */
const PVAL = {P:100,N:320,B:330,R:500,Q:900,K:20000,p:-100,n:-320,b:-330,r:-500,q:-900,k:-20000};
const PST = {
  P:[0,0,0,0,0,0,0,0,50,50,50,50,50,50,50,50,10,10,20,30,30,20,10,10,5,5,10,25,25,10,5,5,0,0,0,20,20,0,0,0,5,-5,-10,0,0,-10,-5,5,5,10,10,-20,-20,10,10,5,0,0,0,0,0,0,0,0],
  N:[-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,5,5,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50],
  B:[-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,10,10,5,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,-10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20],
  R:[0,0,0,0,0,0,0,0,5,10,10,10,10,10,10,5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,0,0,0,5,5,0,0,0],
  Q:[-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5,0,0,5,5,5,5,0,-5,-10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20],
  K:[-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20]
};

function evalBoard(board) {
  let score = 0;
  for(let r=0;r<8;r++) for(let c=0;c<8;c++) {
    const p=board[r][c];if(!p)continue;
    const col=pc(p),isW=col==='w',sym=p.toUpperCase();
    const baseVal=isW?PVAL[sym]:-PVAL[sym];
    const pstIdx=isW?r*8+c:(7-r)*8+c;
    const pstVal=(PST[sym]?PST[sym][pstIdx]:0)*(isW?1:-1);
    score+=baseVal+pstVal;
  }
  return score;
}

function minimax(board,depth,alpha,beta,isMax,gs) {
  if(depth===0) return evalBoard(board);
  const color=isMax?'w':'b';
  const moves=[];
  for(let r=0;r<8;r++) for(let c=0;c<8;c++) {
    if(!board[r][c]||pc(board[r][c])!==color)continue;
    const lm=legals(board,r,c,gs);
    for(const[tr,tc] of lm) moves.push({fr:r,fc:c,tr,tc});
  }
  if(!moves.length) return isMax?-99999:99999;
  if(isMax){
    let best=-Infinity;
    for(const m of moves){
      const nb=board.map(r=>[...r]);
      const p=nb[m.fr][m.fc];nb[m.tr][m.tc]=p;nb[m.fr][m.fc]=null;
      const ngs={...gs,board:nb,turn:color==='w'?'b':'w',enPassant:null,castling:gs.castling};
      best=Math.max(best,minimax(nb,depth-1,alpha,beta,false,ngs));
      alpha=Math.max(alpha,best);
      if(beta<=alpha)break;
    }
    return best;
  }else{
    let best=Infinity;
    for(const m of moves){
      const nb=board.map(r=>[...r]);
      const p=nb[m.fr][m.fc];nb[m.tr][m.tc]=p;nb[m.fr][m.fc]=null;
      const ngs={...gs,board:nb,turn:color==='w'?'b':'w',enPassant:null,castling:gs.castling};
      best=Math.min(best,minimax(nb,depth-1,alpha,beta,true,ngs));
      beta=Math.min(beta,best);
      if(beta<=alpha)break;
    }
    return best;
  }
}

function bestBotMove(gs,color,depth) {
  const board=gs.board;
  const moves=[];
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    if(!board[r][c]||pc(board[r][c])!==color)continue;
    const lm=legals(board,r,c,gs);
    for(const[tr,tc] of lm) moves.push({fr:r,fc:c,tr,tc});
  }
  if(!moves.length)return null;
  // Shuffle for variety at low depths
  moves.sort(()=>Math.random()-0.5);
  const isMax=color==='w';
  let best=isMax?-Infinity:Infinity,bestMove=moves[0];
  for(const m of moves){
    const nb=board.map(r=>[...r]);
    const p=nb[m.fr][m.fc];nb[m.tr][m.tc]=p;nb[m.fr][m.fc]=null;
    const ngs={...gs,board:nb,turn:color==='w'?'b':'w',enPassant:null,castling:gs.castling};
    const val=minimax(nb,depth-1,-Infinity,Infinity,!isMax,ngs);
    if(isMax?val>best:val<best){best=val;bestMove=m;}
  }
  return bestMove;
}

/* Every legal move for `color`, each scored one ply deep. Cheap enough to run on
   the main thread, and it is all we need to pick a believable mistake. */
function scoredMoves(gs,color){
  const board=gs.board,out=[];
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    if(!board[r][c]||pc(board[r][c])!==color)continue;
    for(const[tr,tc] of legals(board,r,c,gs)){
      const nb=board.map(row=>[...row]);
      nb[tr][tc]=nb[r][c];nb[r][c]=null;
      out.push({m:{fr:r,fc:c,tr,tc},v:evalBoard(nb)});
    }
  }
  return out;
}

/* Weaker bots don't search less — they search the same and then sometimes play
   something other than what they found. Picking from the upper-middle of the
   move list gives an inaccuracy a human would make, not a random catastrophe. */
function maybeBlunder(gs,color,bestMove,rate){
  if(!bestMove||Math.random()>=rate)return bestMove;
  const scored=scoredMoves(gs,color);
  if(scored.length<3)return bestMove;
  scored.sort((a,b)=>color==='w'?b.v-a.v:a.v-b.v);
  const hi=Math.max(1,Math.floor(scored.length*0.6));
  const pick=scored[1+Math.floor(Math.random()*hi)]||scored[1];
  return pick?pick.m:bestMove;
}

/* ─── Inject bots into allPlayers (display only) ─── */
/* ─── Who is around right now ───
   A different slice of the roster is available each hour. It is derived from the
   clock alone, so every client computes the same list with no server and no
   stored state. `(i + hour) % 3` rotates a third of the ladder — and because the
   roster is ordered by rating, that third always spans weak to strong, so there
   is someone near any player's level. The hash adds a few extra so the number
   moves between hours instead of sitting at exactly nine. */
function strHash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0);}
function onlineBotNames(ts=Date.now()){
  const out=new Set();
  BOTS.forEach((b,i)=>{
    // Each one keeps its own clock, so arrivals and departures are spread across
    // the hour instead of everybody changing at once on the hour mark.
    const phase=strHash(b.name)%3600000;
    const hour=Math.floor((ts+phase)/3600000);
    if((i+hour)%3===0||strHash(b.name+':'+hour)%100<12)out.add(b.name);
  });
  return out;
}
const isBotOnline=(name,ts)=>onlineBotNames(ts).has(name);

function getBotPlayers(){
  const bots={},online=onlineBotNames();
  BOTS.forEach(b=>{bots[b.name]={elo:b.seed,isBot:true,nationality:b.flag,club:'',online:online.has(b.name)};});
  return bots;
}

export{BOTS,BOT_NAMES,BOT_BY_NAME,isBotName,isBotOnline,onlineBotNames,getBotPlayers,
       botElo,botDepth,botBlunder,botThinkTime,botAcceptsChallenge,botReplyDelay,
       evalBoard,minimax,bestBotMove,scoredMoves,maybeBlunder};
