/* The rating maths and the time-odds rule. Pure, and shared with the server.
   The handicap: equal ratings play 3+3; every 50 rating points moves 15 seconds,
   first down from the stronger player to a floor of 1:00, then up to the weaker
   one to a ceiling of 10:00. */
function calcAutoTime(eloA,eloB){const BASE=180,STEP=15,STEP_ELO=50,MIN_S=60,MAX_W=600;const diff=Math.abs(eloA-eloB),steps=Math.floor(diff/STEP_ELO);if(steps===0)return{strongerSec:BASE,weakerSec:BASE};const ph1=Math.floor((BASE-MIN_S)/STEP),s1=Math.min(steps,ph1);return{strongerSec:BASE-s1*STEP,weakerSec:Math.min(MAX_W,BASE+(steps-s1)*STEP)};}
function applyAutoTime(myElo,oppElo){const{strongerSec,weakerSec}=calcAutoTime(myElo,oppElo);const strong=myElo>=oppElo;return{mySec:strong?strongerSec:weakerSec,oppSec:strong?weakerSec:strongerSec};}
function eloChg(myE,oppE,score,myMs,oppMs){const exp=1/(1+Math.pow(10,(oppE-myE)/400));return Math.round(Math.round(32*Math.min(4,Math.max(0.5,oppMs/myMs)))*(score-exp));}

export{calcAutoTime,applyAutoTime,eloChg};
