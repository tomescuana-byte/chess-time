/* Bot roster, evaluation and the in-browser move search. */
import{fSet,fGet}from'./firebase.js';
import{pc,TERM,legals,applyMove}from'./engine.js';

const BOT_NAMES = [
  // Legende ale șahului
  "DeepKnight","IronCastle","SilverBishop","GoldenPawn","CrimsonQueen",
  "ShadowRook","FrostKing","StormKnight","VoidMaster","PhantomGambit",
  // Stiluri de joc
  "BlitzWolf","TacticFox","StratosMind","EndgameGhost","OpeningTrap",
  "SicilianDragon","KingsGambit","QueensPawn","NimzoWitch","CatalanOwl",
  // Nume inventive
  "Vortex64","MatrixBishop","NeuralRook","QuantumPawn","AlphaForge",
  "CipherKing","ByteKnight","LogicQueen","BinaryBlade","HexMaster",
  // Personaje mitologice/fantastică
  "AresGambit","HermesBlitz","AthenaEnd","ZeusStrike","PoseidonRook",
  "LokiTactic","OdinForge","ThorCastle","FreyaQueen","ValkyriePawn",
  // Natură și cosmos
  "NebulaMind","CosmosRook","SolarBishop","LunarKnight","AuroraQueen",
  "TwilightKing","EclipseForge","StarlightPawn","CometBlitz","NovaStrike",
  // Animale de putere
  "OnyxPanther","CrimsonHawk","IronWolf","SilverFalcon","AzureDragon",
  "GoldenEagle","ShadowLynx","FrostBear","ThunderRaven","StoneGolem",
  // Elemente
  "EmberRook","TidalBishop","GaleKnight","GraniteQueen","FluxPawn",
  "CinderKing","MistralEnd","AbyssGambit","InfernoBlitz","TerraForge",
  // Clasic elegant
  "MaestroNoir","GrandVizier","SilkRook","VelvetKnight","EbonyQueen",
  "IvoryKing","ObsidianPawn","QuartzBishop","SapphireEnd","RubyGambit",
  // Misterios
  "EnigmaX","ShadowCode","CrypticMind","ArcaneRook","MysticForge",
  "OracleKnight","ProphetQueen","SeerKing","AugurPawn","OmenBishop"
];

// ELO distribution: 600-2400, weighted toward middle
function botElo(idx) {
  const elos = [
    600,650,700,720,750,780,800,820,850,880,
    900,920,950,980,1000,1020,1050,1080,1100,1120,
    1150,1180,1200,1220,1250,1280,1300,1320,1350,1380,
    1400,1420,1450,1480,1500,1520,1550,1580,1600,1620,
    1650,1680,1700,1720,1750,1780,1800,1820,1850,1880,
    1900,1920,1950,1980,2000,2020,2050,2080,2100,2120,
    2150,2180,2200,2220,2250,2280,2300,2320,2350,2380,
    2400,2350,2300,2250,2200,2150,2100,2050,2000,1950,
    1900,1850,1800,1750,1700,1650,1600,1550,1500,1450,
    1400,1350,1300,1250,1200,1150,1100,1050,1000,950
  ];
  return elos[idx % elos.length];
}

// Depth based on ELO — capped at 3 so worker finishes in <1s
function botDepth(elo) {
  if(elo < 1000) return 1;
  if(elo < 1400) return 2;
  return 3;
}

// Think time (ms) — short delay so it feels natural, worker adds its own time
function botThinkTime(elo) {
  const base = elo < 1000 ? 200 : elo < 1500 ? 400 : 600;
  return base + Math.random() * 400;
}

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

/* ─── Bot Web Worker (runs minimax off main thread so clock never freezes) ─── */
const _botWorkerCode="\nconst pc=p=>p?(p===p.toUpperCase()?'w':'b'):null;\nconst inB=(r,c)=>r>=0&&r<8&&c>=0&&c<8;\nfunction atk(board,r,c,by){const W=by==='w';const[Pn,Kn,Rk,Bi,Qu,Ki]=W?['P','N','R','B','Q','K']:['p','n','r','b','q','k'];const pr=W?r+1:r-1;if(inB(pr,c-1)&&board[pr][c-1]===Pn)return true;if(inB(pr,c+1)&&board[pr][c+1]===Pn)return true;for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])if(inB(r+dr,c+dc)&&board[r+dr][c+dc]===Kn)return true;for(const[dr,dc]of[[0,1],[0,-1],[1,0],[-1,0]]){let nr=r+dr,nc=c+dc;while(inB(nr,nc)){if(board[nr][nc]){if(board[nr][nc]===Rk||board[nr][nc]===Qu)return true;break;}nr+=dr;nc+=dc;}}for(const[dr,dc]of[[1,1],[1,-1],[-1,1],[-1,-1]]){let nr=r+dr,nc=c+dc;while(inB(nr,nc)){if(board[nr][nc]){if(board[nr][nc]===Bi||board[nr][nc]===Qu)return true;break;}nr+=dr;nc+=dc;}}for(const[dr,dc]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])if(inB(r+dr,c+dc)&&board[r+dr][c+dc]===Ki)return true;return false;}\nfunction fKp(b,col){const K=col==='w'?'K':'k';for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(b[r][c]===K)return[r,c];return null;}\nfunction inChk(b,col){const p=fKp(b,col);return p?atk(b,p[0],p[1],col==='w'?'b':'w'):false;}\nfunction raw(board,r,c,cas,ep){const piece=board[r][c];if(!piece)return[];const color=pc(piece),p=piece.toLowerCase();const isF=sq=>pc(sq)===color,isE=sq=>sq&&pc(sq)!==color;const mv=[];if(p==='p'){const d=color==='w'?-1:1,st=color==='w'?6:1;if(inB(r+d,c)&&!board[r+d][c]){mv.push([r+d,c]);if(r===st&&!board[r+2*d][c])mv.push([r+2*d,c]);}for(const dc of[-1,1]){if(!inB(r+d,c+dc))continue;if(isE(board[r+d][c+dc]))mv.push([r+d,c+dc]);if(ep&&ep[0]===r+d&&ep[1]===c+dc)mv.push([r+d,c+dc]);}}if(p==='n')for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])if(inB(r+dr,c+dc)&&!isF(board[r+dr][c+dc]))mv.push([r+dr,c+dc]);if(p==='b'||p==='q')for(const[dr,dc]of[[1,1],[1,-1],[-1,1],[-1,-1]]){let nr=r+dr,nc=c+dc;while(inB(nr,nc)){if(isF(board[nr][nc]))break;mv.push([nr,nc]);if(board[nr][nc])break;nr+=dr;nc+=dc;}}if(p==='r'||p==='q')for(const[dr,dc]of[[0,1],[0,-1],[1,0],[-1,0]]){let nr=r+dr,nc=c+dc;while(inB(nr,nc)){if(isF(board[nr][nc]))break;mv.push([nr,nc]);if(board[nr][nc])break;nr+=dr;nc+=dc;}}if(p==='k'){for(const[dr,dc]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])if(inB(r+dr,c+dc)&&!isF(board[r+dr][c+dc]))mv.push([r+dr,c+dc]);const opp=color==='w'?'b':'w';if(color==='w'&&r===7&&c===4){if(cas.wK&&!board[7][5]&&!board[7][6]&&!atk(board,7,4,opp)&&!atk(board,7,5,opp)&&!atk(board,7,6,opp))mv.push([7,6]);if(cas.wQ&&!board[7][1]&&!board[7][2]&&!board[7][3]&&!atk(board,7,4,opp)&&!atk(board,7,3,opp)&&!atk(board,7,2,opp))mv.push([7,2]);}if(color==='b'&&r===0&&c===4){if(cas.bK&&!board[0][5]&&!board[0][6]&&!atk(board,0,4,opp)&&!atk(board,0,5,opp)&&!atk(board,0,6,opp))mv.push([0,6]);if(cas.bQ&&!board[0][1]&&!board[0][2]&&!board[0][3]&&!atk(board,0,4,opp)&&!atk(board,0,3,opp)&&!atk(board,0,2,opp))mv.push([0,2]);}}return mv;}\nfunction legals(board,r,c,gs){const piece=board[r][c];if(!piece)return[];const color=pc(piece);return raw(board,r,c,gs.castling,gs.enPassant).filter(([tr,tc])=>{let nb=board.map(row=>[...row]);nb[tr][tc]=nb[r][c];nb[r][c]=null;const p=piece.toLowerCase();if(p==='p'&&gs.enPassant&&tr===gs.enPassant[0]&&tc===gs.enPassant[1]&&!board[tr][tc])nb[color==='w'?tr+1:tr-1][tc]=null;if(p==='k'){const rr=color==='w'?7:0;if(c===4&&tc===6){nb[rr][5]=nb[rr][7];nb[rr][7]=null;}if(c===4&&tc===2){nb[rr][3]=nb[rr][0];nb[rr][0]=null;}}return!inChk(nb,color);});}\nfunction anyLeg(board,color,gs){for(let r=0;r<8;r++)for(let c=0;c<8;c++){if(!board[r][c]||pc(board[r][c])!==color)continue;if(legals(board,r,c,gs).length>0)return true;}return false;}\nconst PVAL={P:100,N:320,B:330,R:500,Q:900,K:20000,p:-100,n:-320,b:-330,r:-500,q:-900,k:-20000};\nconst PST={P:[0,0,0,0,0,0,0,0,50,50,50,50,50,50,50,50,10,10,20,30,30,20,10,10,5,5,10,25,25,10,5,5,0,0,0,20,20,0,0,0,5,-5,-10,0,0,-10,-5,5,5,10,10,-20,-20,10,10,5,0,0,0,0,0,0,0,0],N:[-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,5,5,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50],B:[-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,10,10,5,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,-10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20],R:[0,0,0,0,0,0,0,0,5,10,10,10,10,10,10,5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,0,0,0,5,5,0,0,0],Q:[-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5,0,0,5,5,5,5,0,-5,-10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20],K:[-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20]};\nfunction evalBoard(board){let score=0;for(let r=0;r<8;r++)for(let c=0;c<8;c++){const p=board[r][c];if(!p)continue;const col=pc(p),isW=col==='w',sym=p.toUpperCase();const baseVal=isW?PVAL[sym]:-PVAL[sym];const pstIdx=isW?r*8+c:(7-r)*8+c;const pstVal=(PST[sym]?PST[sym][pstIdx]:0)*(isW?1:-1);score+=baseVal+pstVal;}return score;}\nfunction minimax(board,depth,alpha,beta,isMax,gs){if(depth===0)return evalBoard(board);const color=isMax?'w':'b';const moves=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++){if(!board[r][c]||pc(board[r][c])!==color)continue;const lm=legals(board,r,c,gs);for(const[tr,tc]of lm)moves.push({fr:r,fc:c,tr,tc});}if(!moves.length)return isMax?-99999:99999;if(isMax){let best=-Infinity;for(const m of moves){const nb=board.map(r=>[...r]);const p=nb[m.fr][m.fc];nb[m.tr][m.tc]=p;nb[m.fr][m.fc]=null;const ngs={...gs,board:nb,turn:'b',enPassant:null};best=Math.max(best,minimax(nb,depth-1,alpha,beta,false,ngs));alpha=Math.max(alpha,best);if(beta<=alpha)break;}return best;}else{let best=Infinity;for(const m of moves){const nb=board.map(r=>[...r]);const p=nb[m.fr][m.fc];nb[m.tr][m.tc]=p;nb[m.fr][m.fc]=null;const ngs={...gs,board:nb,turn:'w',enPassant:null};best=Math.min(best,minimax(nb,depth-1,alpha,beta,true,ngs));beta=Math.min(beta,best);if(beta<=alpha)break;}return best;}}\nfunction bestBotMove(gs,color,depth){const board=gs.board;const moves=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++){if(!board[r][c]||pc(board[r][c])!==color)continue;const lm=legals(board,r,c,gs);for(const[tr,tc]of lm)moves.push({fr:r,fc:c,tr,tc});}if(!moves.length)return null;moves.sort(()=>Math.random()-0.5);const isMax=color==='w';let best=isMax?-Infinity:Infinity,bestMove=moves[0];for(const m of moves){const nb=board.map(r=>[...r]);const p=nb[m.fr][m.fc];nb[m.tr][m.tc]=p;nb[m.fr][m.fc]=null;const ngs={...gs,board:nb,turn:color==='w'?'b':'w',enPassant:null};const val=minimax(nb,depth-1,-Infinity,Infinity,!isMax,ngs);if(isMax?val>best:val<best){best=val;bestMove=m;}}return bestMove;}\nself.onmessage=function(e){const{gs,color,depth}=e.data;const move=bestBotMove(gs,color,depth);self.postMessage({move});};\n";
const _botWorkerBlob=new Blob([_botWorkerCode],{type:'application/javascript'});
const _botWorkerUrl=URL.createObjectURL(_botWorkerBlob);

/* ─── Bot Game Manager ─── */
let botGameInterval=null;
let botThinking=false;
let botWorker=null;
function startBotGame(gid,botName,botColor,botEloVal,depth){
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
    // Use Web Worker so main thread (clock, UI) never blocks
    setTimeout(async()=>{
      try{
        const gF=await fGet(`games/${gid}`);
        if(!gF||gF.turn!==botColor||TERM.includes(gF.status)){botThinking=false;return;}
        const gsF={board:JSON.parse(gF.boardJson),turn:gF.turn,castling:gF.castling,enPassant:gF.enPassant||null,fullMoves:gF.fullMoves,status:gF.status};
        // Spin up a fresh worker for this move
        if(botWorker)botWorker.terminate();
        // Workers need a server (https/http). If file://, fall back to sync.
        let workerSupported=true;
        try{botWorker=new Worker(_botWorkerUrl);}catch(e){workerSupported=false;}
        if(!workerSupported){
          // Synchronous fallback (depth capped at 2 to keep it fast)
          const m=bestBotMove(gsF,botColor,Math.min(depth,2));
          if(!m){botThinking=false;return;}
          const gF2=await fGet(`games/${gid}`);
          if(!gF2||gF2.turn!==botColor||TERM.includes(gF2.status)){botThinking=false;return;}
          const gsF2={board:JSON.parse(gF2.boardJson),turn:gF2.turn,castling:gF2.castling,enPassant:gF2.enPassant||null,fullMoves:gF2.fullMoves,status:gF2.status};
          const legalNow=legals(gsF2.board,m.fr,m.fc,gsF2);
          if(!legalNow.some(([tr,tc])=>tr===m.tr&&tc===m.tc)){botThinking=false;return;}
          const ngs=applyMove(gsF2,[m.fr,m.fc],[m.tr,m.tc],null);
          const el2=Date.now()-gF2.lastMoveTs;
          const nW=botColor==='w'?Math.max(0,gF2.whiteMs-el2):gF2.whiteMs;
          const nB=botColor==='b'?Math.max(0,gF2.blackMs-el2):gF2.blackMs;
          const ng={...gF2,boardJson:JSON.stringify(ngs.board),turn:ngs.turn,castling:ngs.castling,enPassant:ngs.enPassant,fullMoves:ngs.fullMoves,status:ngs.status,whiteMs:nW,blackMs:nB,lastMoveTs:Date.now()};
          await fSet(`games/${gid}`,ng);
          if(TERM.includes(ngs.status))clearInterval(botGameInterval);
          botThinking=false;
          return;
        }
        botWorker.onmessage=async(e)=>{
          try{
            botWorker=null;
            const m=e.data.move;
            if(!m){botThinking=false;return;}
            // Final check: re-fetch to make sure turn hasn't changed
            const gF2=await fGet(`games/${gid}`);
            if(!gF2||gF2.turn!==botColor||TERM.includes(gF2.status)){botThinking=false;return;}
            const gsF2={board:JSON.parse(gF2.boardJson),turn:gF2.turn,castling:gF2.castling,enPassant:gF2.enPassant||null,fullMoves:gF2.fullMoves,status:gF2.status};
            // Validate the move is still legal on the fresh board
            const legalNow=legals(gsF2.board,m.fr,m.fc,gsF2);
            if(!legalNow.some(([tr,tc])=>tr===m.tr&&tc===m.tc)){botThinking=false;return;}
            const ngs=applyMove(gsF2,[m.fr,m.fc],[m.tr,m.tc],null);
            const el2=Date.now()-gF2.lastMoveTs;
            const nW=botColor==='w'?Math.max(0,gF2.whiteMs-el2):gF2.whiteMs;
            const nB=botColor==='b'?Math.max(0,gF2.blackMs-el2):gF2.blackMs;
            const ng={...gF2,boardJson:JSON.stringify(ngs.board),turn:ngs.turn,castling:ngs.castling,enPassant:ngs.enPassant,fullMoves:ngs.fullMoves,status:ngs.status,whiteMs:nW,blackMs:nB,lastMoveTs:Date.now()};
            await fSet(`games/${gid}`,ng);
            if(TERM.includes(ngs.status)){
              clearInterval(botGameInterval);
              // ELO finalization handled by Firebase listener via finalizeBotGame
            }
          }finally{botThinking=false;}
        };
        botWorker.onerror=()=>{botThinking=false;if(botWorker){botWorker.terminate();botWorker=null;}};
        botWorker.postMessage({gs:gsF,color:botColor,depth});
      }catch(err){botThinking=false;}
    },botThinkTime(botEloVal));
  },500);
}
/* ─── Inject bots into allPlayers (display only) ─── */
function getBotPlayers(){
  const bots={};
  BOT_NAMES.forEach((name,i)=>{
    bots[name]={elo:botElo(i),isBot:true};
  });
  return bots;
}


export{BOT_NAMES,botElo,botDepth,botThinkTime,evalBoard,bestBotMove,startBotGame,getBotPlayers};
