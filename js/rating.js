/* The rating maths and the time-odds rule. Pure, and shared with the server.
   The handicap: equal ratings play 3+3; every 50 rating points moves 15 seconds,
   first down from the stronger player to a floor of 1:00, then up to the weaker
   one to a ceiling of 10:00. */
function calcAutoTime(eloA,eloB){const BASE=180,STEP=15,STEP_ELO=50,MIN_S=60,MAX_W=600;const diff=Math.abs(eloA-eloB),steps=Math.floor(diff/STEP_ELO);if(steps===0)return{strongerSec:BASE,weakerSec:BASE};const ph1=Math.floor((BASE-MIN_S)/STEP),s1=Math.min(steps,ph1);return{strongerSec:BASE-s1*STEP,weakerSec:Math.min(MAX_W,BASE+(steps-s1)*STEP)};}
function applyAutoTime(myElo,oppElo){const{strongerSec,weakerSec}=calcAutoTime(myElo,oppElo);const strong=myElo>=oppElo;return{mySec:strong?strongerSec:weakerSec,oppSec:strong?weakerSec:strongerSec};}
/* ── How much a result moves a rating ──────────────────────────────────────
   Three things scale it, and the order matters.

   The clock: beating someone who had four times your time counts for more than
   beating an equal, so K is multiplied by the time ratio, capped at 4.

   Being new: a newcomer's first result should move them a long way, because
   their starting 1000 is a guess. The multiplier runs 10, 9, 8 ... down to 1
   over their first ten rated games, after which they are rated like anyone else.

   And a hard ceiling. Those two multipliers compound: 32 x 4 x 10 is over a
   thousand points from a single game, which would throw a new player straight
   past the whole ladder and take their opponent down with them. No result moves
   a rating by more than MAX_SWING, whatever the arithmetic says. */
const PROVISIONAL_GAMES=10;
const MAX_SWING=200;
const provisionalMult=played=>Math.max(1,PROVISIONAL_GAMES-(played||0));

function eloChg(myE,oppE,score,myMs,oppMs,mult=1){
  const exp=1/(1+Math.pow(10,(oppE-myE)/400));
  const k=Math.round(32*Math.min(4,Math.max(0.5,oppMs/myMs)))*mult;
  const raw=Math.round(k*(score-exp));
  return Math.max(-MAX_SWING,Math.min(MAX_SWING,raw));
}

export{calcAutoTime,applyAutoTime,eloChg,provisionalMult,PROVISIONAL_GAMES,MAX_SWING};
