/* The bot roster and everything that defines how each one behaves.
   Pure: no DOM, no Firebase, no engine — the browser and the server both read
   it, so the bot you play is the bot that gets rated.

   Strength is no longer guessed. Stockfish calibrates itself: you hand it a
   rating and it plays at that rating. Our own knobs only cover the range below
   its floor of 1320, where it cannot aim any lower on its own. */
import{applyAutoTime}from'./rating.js';

/* Levels: 50 apart from 700 to 1800, where nearly every player will sit, then
   four further apart above that. Density belongs where the people are; the top
   few exist so that a strong player always has somewhere left to climb. */
const NAMES=[
  {name:'789',             flag:'China'},
  {name:'firstgrader',     flag:'USA'},
  {name:'thekid',          flag:'USA'},
  {name:'Pompkin',         flag:'Sweden'},
  {name:'meatball20',      flag:'USA'},
  {name:'JJLOVELOVE',      flag:'Thailand'},
  {name:'RabbitRain',      flag:'Japan'},
  {name:'Nounours Sucre',  flag:'France'},
  {name:'sorryimlikethis', flag:'Australia'},
  {name:'carzen17',        flag:'Japan'},
  {name:'Enni10',          flag:'Germany'},
  {name:'mikim',           flag:'Russia'},
  {name:'Julian1994',      flag:'Germany'},
  {name:'Onyx37',          flag:'France'},
  {name:'champion16',      flag:'Taiwan'},
  {name:'ElerCant',        flag:'Kazakhstan'},
  {name:'Norimsoo',        flag:'South Korea'},
  {name:'Chapelier7',      flag:'France'},
  {name:'MadCassowary',    flag:'France'},
  {name:'lincoln9818',     flag:'China'},
  {name:'sprockitz',       flag:'USA'},
  {name:'Weapenguin',      flag:'Canada'},
  {name:'Flosimelator',    flag:'Germany'},
  {name:'slywww2020',      flag:''},
  {name:'Komandor Tarkin', flag:'Poland'},
  {name:'ArsèneLupin44',   flag:'France'},
  {name:'Forevergm',       flag:''}
];
const LEVELS=[...Array(23).keys()].map(i=>700+i*50).concat([1900,2050,2300,2600]);
const BOTS=NAMES.map((b,i)=>({...b,elo:LEVELS[i],seed:LEVELS[i]}));

const BOT_NAMES=BOTS.map(b=>b.name);
const BOT_BY_NAME=Object.fromEntries(BOTS.map(b=>[b.name,b]));
const isBotName=n=>Object.prototype.hasOwnProperty.call(BOT_BY_NAME,n);
const botElo=idx=>BOTS[idx]?.elo??1000;

/* How to configure the engine for a given rating.
   At 1320 and above Stockfish aims at the rating itself. Below that it has no
   dial left, so we ask it for several candidate moves and sometimes take one
   that is not the best — a real move a weaker player might choose, rather than
   a random one. */
function strengthFor(elo){
  if(elo>=1320)return{limitStrength:true,uciElo:Math.min(3190,elo),skill:20,multipv:1,pickWorse:0};
  if(elo>=1250)return{limitStrength:false,uciElo:0,skill:3,multipv:3,pickWorse:0.20};
  if(elo>=1100)return{limitStrength:false,uciElo:0,skill:1,multipv:4,pickWorse:0.32};
  if(elo>=900) return{limitStrength:false,uciElo:0,skill:0,multipv:4,pickWorse:0.45};
  return         {limitStrength:false,uciElo:0,skill:0,multipv:5,pickWorse:0.62};
}

/* How long a bot sits on a move. Real players spend time in proportion to what
   is left on their clock, and they are erratic about it. Never so long that the
   bot flags on its own bookkeeping. */
function botThinkTime(elo,game,botColor,onlyMove){
  const left=(botColor==='w'?game.whiteMs:game.blackMs)||180000;
  if(onlyMove)return 300+Math.random()*500;        // forced reply: near-instant
  const movesLeft=Math.max(12,42-(game.fullMoves||1));
  const budget=left/movesLeft;
  let t=budget*(0.3+Math.random()*1.9);
  if(Math.random()<0.08)t*=2.5;                    // the occasional long think
  t=Math.min(t,left*0.22,25000);
  return Math.max(400,t);
}

/* Of the time a bot spends on a move, only part is actual calculation — the
   rest is it "looking at the board". Weak bots barely calculate at all. */
function searchMs(elo,thinkMs){
  const share=elo>=1800?0.6:elo>=1300?0.4:0.2;
  return Math.max(60,Math.min(2500,Math.round(thinkMs*share)));
}

/* Whether a bot takes the challenge. Bots that accept everything instantly read
   as machines; the delay and the refusals are most of what makes them feel real. */
function botAcceptsChallenge(botEloVal,myElo,myMs,botMs){
  const totalMin=(myMs+botMs)/120000;
  if(totalMin>25)return{ok:false,why:'is not up for a game that long right now.'};
  if(botMs<45000)return{ok:false,why:'does not want that little time on the clock.'};
  /* Lopsided clocks are the whole point of this app, so "unfair" cannot mean
     "uneven". Fair is whatever the rating gap justifies. */
  const fairSec=applyAutoTime(botEloVal,myElo).mySec;
  if(botMs<fairSec*1000*0.7)return{ok:false,why:'thinks those odds are too steep.'};
  if(Math.random()<0.22)return{ok:false,why:'declined the challenge.'};
  return{ok:true,why:''};
}
const botReplyDelay=()=>2500+Math.random()*11000;

/* Material only, from White's side. Used to decide whether a bot accepts a
   draw offer — not for playing, which Stockfish does. */
const MAT={p:100,n:320,b:330,r:500,q:900,k:0};
function materialScore(board){
  let s=0;
  for(const row of board)for(const p of row){
    if(!p)continue;
    const v=MAT[p.toLowerCase()]||0;
    s+=p===p.toUpperCase()?v:-v;
  }
  return s;
}

/* ─── Who is around right now ───
   A different slice of the roster is available each hour, derived from the clock
   alone so every client computes the same list. `(i + hour) % 3` rotates a third
   of the ladder, and because the roster is ordered by rating that third always
   spans weak to strong. Each bot keeps its own changeover moment, so arrivals
   and departures spread across the hour instead of all landing on the hour. */
function strHash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0);}
function onlineBotNames(ts=Date.now()){
  const out=new Set();
  BOTS.forEach((b,i)=>{
    const phase=strHash(b.name)%3600000;
    const hour=Math.floor((ts+phase)/3600000);
    if((i+hour)%3===0||strHash(b.name+':'+hour)%100<12)out.add(b.name);
  });
  return out;
}
const isBotOnline=(name,ts)=>onlineBotNames(ts).has(name);

function getBotPlayers(){
  const bots={},online=onlineBotNames();
  BOTS.forEach(b=>{bots[b.name]={elo:b.elo,isBot:true,nationality:b.flag,club:'',online:online.has(b.name)};});
  return bots;
}

export{BOTS,BOT_NAMES,BOT_BY_NAME,isBotName,isBotOnline,onlineBotNames,getBotPlayers,
       botElo,strengthFor,searchMs,botThinkTime,botAcceptsChallenge,botReplyDelay,
       materialScore};
