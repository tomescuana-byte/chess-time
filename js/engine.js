const pc=p=>p?(p===p.toUpperCase()?'w':'b'):null;
const inB=(r,c)=>r>=0&&r<8&&c>=0&&c<8;
const TERM=['white_wins','black_wins','draw_stalemate','white_timeout','black_timeout','resigned_white','resigned_black',
            'draw_fifty','draw_repetition','draw_material','draw_agreed'];
function ib(){const b=Array(8).fill(null).map(()=>Array(8).fill(null));b[0]=['r','n','b','q','k','b','n','r'];b[1]=Array(8).fill('p');b[6]=Array(8).fill('P');b[7]=['R','N','B','Q','K','B','N','R'];return b;}

/* ── Draws ─────────────────────────────────────────────────────────────────
   Without these a dead position just runs the clock out, which in a game built
   on time odds is the worst possible ending: the player who is ahead loses to
   an empty board. */

// Identity of a position for repetition purposes: men, side to move, castling
// rights and the en-passant square. Two positions differing in any of those
// are not the same position.
// Ranks are separated by "-" and not the usual "/": these strings are stored as
// database keys, and Firebase rejects a key containing . # $ / [ or ].
function posKey(board,turn,cas,ep){
  let s='';
  for(let r=0;r<8;r++){let empty=0;
    for(let c=0;c<8;c++){const p=board[r][c];if(p){if(empty){s+=empty;empty=0;}s+=p;}else empty++;}
    if(empty)s+=empty;s+='-';}
  return s+turn+(cas.wK?'K':'')+(cas.wQ?'Q':'')+(cas.bK?'k':'')+(cas.bQ?'q':'')+(ep?`e${ep[0]}${ep[1]}`:'');
}

// Neither side could deliver mate even with the most cooperative play.
function insufficientMaterial(board){
  const men=[];
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    const p=board[r][c];if(!p)continue;
    const t=p.toLowerCase();
    if(t==='p'||t==='r'||t==='q')return false;   // any of these can still mate
    if(t!=='k')men.push({t,col:pc(p),sq:(r+c)%2});
  }
  if(men.length===0)return true;                 // bare kings
  if(men.length===1)return true;                 // king and a single minor
  // Two bishops on the same colour squares can never mate, whoever owns them.
  if(men.length===2&&men[0].t==='b'&&men[1].t==='b'&&men[0].sq===men[1].sq)return true;
  return false;
}
function atk(board,r,c,by){const W=by==='w';const[Pn,Kn,Rk,Bi,Qu,Ki]=W?['P','N','R','B','Q','K']:['p','n','r','b','q','k'];const pr=W?r+1:r-1;if(inB(pr,c-1)&&board[pr][c-1]===Pn)return true;if(inB(pr,c+1)&&board[pr][c+1]===Pn)return true;for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])if(inB(r+dr,c+dc)&&board[r+dr][c+dc]===Kn)return true;for(const[dr,dc]of[[0,1],[0,-1],[1,0],[-1,0]]){let nr=r+dr,nc=c+dc;while(inB(nr,nc)){if(board[nr][nc]){if(board[nr][nc]===Rk||board[nr][nc]===Qu)return true;break;}nr+=dr;nc+=dc;}}for(const[dr,dc]of[[1,1],[1,-1],[-1,1],[-1,-1]]){let nr=r+dr,nc=c+dc;while(inB(nr,nc)){if(board[nr][nc]){if(board[nr][nc]===Bi||board[nr][nc]===Qu)return true;break;}nr+=dr;nc+=dc;}}for(const[dr,dc]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])if(inB(r+dr,c+dc)&&board[r+dr][c+dc]===Ki)return true;return false;}
function fKp(b,col){const K=col==='w'?'K':'k';for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(b[r][c]===K)return[r,c];return null;}
function inChk(b,col){const p=fKp(b,col);return p?atk(b,p[0],p[1],col==='w'?'b':'w'):false;}
function raw(board,r,c,cas,ep){const piece=board[r][c];if(!piece)return[];const color=pc(piece),p=piece.toLowerCase();const isF=sq=>pc(sq)===color,isE=sq=>sq&&pc(sq)!==color;const mv=[];if(p==='p'){const d=color==='w'?-1:1,st=color==='w'?6:1;if(inB(r+d,c)&&!board[r+d][c]){mv.push([r+d,c]);if(r===st&&!board[r+2*d][c])mv.push([r+2*d,c]);}for(const dc of[-1,1]){if(!inB(r+d,c+dc))continue;if(isE(board[r+d][c+dc]))mv.push([r+d,c+dc]);if(ep&&ep[0]===r+d&&ep[1]===c+dc)mv.push([r+d,c+dc]);}}if(p==='n')for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])if(inB(r+dr,c+dc)&&!isF(board[r+dr][c+dc]))mv.push([r+dr,c+dc]);if(p==='b'||p==='q')for(const[dr,dc]of[[1,1],[1,-1],[-1,1],[-1,-1]]){let nr=r+dr,nc=c+dc;while(inB(nr,nc)){if(isF(board[nr][nc]))break;mv.push([nr,nc]);if(board[nr][nc])break;nr+=dr;nc+=dc;}}if(p==='r'||p==='q')for(const[dr,dc]of[[0,1],[0,-1],[1,0],[-1,0]]){let nr=r+dr,nc=c+dc;while(inB(nr,nc)){if(isF(board[nr][nc]))break;mv.push([nr,nc]);if(board[nr][nc])break;nr+=dr;nc+=dc;}}if(p==='k'){for(const[dr,dc]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])if(inB(r+dr,c+dc)&&!isF(board[r+dr][c+dc]))mv.push([r+dr,c+dc]);const opp=color==='w'?'b':'w';if(color==='w'&&r===7&&c===4){if(cas.wK&&!board[7][5]&&!board[7][6]&&!atk(board,7,4,opp)&&!atk(board,7,5,opp)&&!atk(board,7,6,opp))mv.push([7,6]);if(cas.wQ&&!board[7][1]&&!board[7][2]&&!board[7][3]&&!atk(board,7,4,opp)&&!atk(board,7,3,opp)&&!atk(board,7,2,opp))mv.push([7,2]);}if(color==='b'&&r===0&&c===4){if(cas.bK&&!board[0][5]&&!board[0][6]&&!atk(board,0,4,opp)&&!atk(board,0,5,opp)&&!atk(board,0,6,opp))mv.push([0,6]);if(cas.bQ&&!board[0][1]&&!board[0][2]&&!board[0][3]&&!atk(board,0,4,opp)&&!atk(board,0,3,opp)&&!atk(board,0,2,opp))mv.push([0,2]);}}return mv;}
function legals(board,r,c,gs){const piece=board[r][c];if(!piece)return[];const color=pc(piece);return raw(board,r,c,gs.castling,gs.enPassant).filter(([tr,tc])=>{let nb=board.map(row=>[...row]);nb[tr][tc]=nb[r][c];nb[r][c]=null;const p=piece.toLowerCase();if(p==='p'&&gs.enPassant&&tr===gs.enPassant[0]&&tc===gs.enPassant[1]&&!board[tr][tc])nb[color==='w'?tr+1:tr-1][tc]=null;if(p==='k'){const rr=color==='w'?7:0;if(c===4&&tc===6){nb[rr][5]=nb[rr][7];nb[rr][7]=null;}if(c===4&&tc===2){nb[rr][3]=nb[rr][0];nb[rr][0]=null;}}return!inChk(nb,color);});}
function anyLeg(board,color,gs){for(let r=0;r<8;r++)for(let c=0;c<8;c++){if(!board[r][c]||pc(board[r][c])!==color)continue;if(legals(board,r,c,gs).length>0)return true;}return false;}
function applyMove(gs,from,to,promo=null){const{board,turn,castling,enPassant}=gs;const piece=board[from[0]][from[1]],color=turn,p=piece.toLowerCase();let nb=board.map(r=>[...r]);const pp=promo?(color==='w'?promo.toUpperCase():promo.toLowerCase()):piece;nb[to[0]][to[1]]=(p==='p'&&(to[0]===0||to[0]===7))?pp:piece;nb[from[0]][from[1]]=null;let nc={...castling},nep=null;if(p==='p'&&enPassant&&to[0]===enPassant[0]&&to[1]===enPassant[1]&&!board[to[0]][to[1]])nb[color==='w'?to[0]+1:to[0]-1][to[1]]=null;if(p==='p'&&Math.abs(to[0]-from[0])===2)nep=[(from[0]+to[0])/2,from[1]];if(p==='k'){const rr=color==='w'?7:0;if(from[1]===4&&to[1]===6){nb[rr][5]=nb[rr][7];nb[rr][7]=null;}if(from[1]===4&&to[1]===2){nb[rr][3]=nb[rr][0];nb[rr][0]=null;}if(color==='w'){nc.wK=false;nc.wQ=false;}else{nc.bK=false;nc.bQ=false;}}if(p==='r'){if(from[0]===7&&from[1]===7)nc.wK=false;if(from[0]===7&&from[1]===0)nc.wQ=false;if(from[0]===0&&from[1]===7)nc.bK=false;if(from[0]===0&&from[1]===0)nc.bQ=false;}if(to[0]===7&&to[1]===7)nc.wK=false;if(to[0]===7&&to[1]===0)nc.wQ=false;if(to[0]===0&&to[1]===7)nc.bK=false;if(to[0]===0&&to[1]===0)nc.bQ=false;const nt=color==='w'?'b':'w';
  // A pawn move or a capture makes every earlier position unreachable, so both
  // the fifty-move count and the repetition window restart there.
  const captured=!!board[to[0]][to[1]]||(p==='p'&&enPassant&&to[0]===enPassant[0]&&to[1]===enPassant[1]);
  const irreversible=p==='p'||captured;
  const halfMoves=irreversible?0:(gs.halfMoves||0)+1;
  const key=posKey(nb,nt,nc,nep);
  const rep=irreversible?{[key]:1}:{...(gs.rep||{}),[key]:((gs.rep||{})[key]||0)+1};
  const ngs={board:nb,turn:nt,castling:nc,enPassant:nep,fullMoves:gs.fullMoves+(color==='b'?1:0),halfMoves,rep};
  const has=anyLeg(nb,nt,ngs),chk=inChk(nb,nt);
  let status='ongoing';
  if(!has)status=chk?(nt==='w'?'black_wins':'white_wins'):'draw_stalemate';
  else if(insufficientMaterial(nb))status='draw_material';
  else if(rep[key]>=3)status='draw_repetition';
  else if(halfMoves>=100)status='draw_fifty';   // 50 moves by each side
  else if(chk)status='check';
  return{...ngs,status};}

function premoveValid(piece, fr, fc, tr, tc) {
  if(fr===tr&&fc===tc)return false;
  const p=piece.toLowerCase(),color=pc(piece);
  const dr=tr-fr,dc=tc-fc,adr=Math.abs(dr),adc=Math.abs(dc);
  if(p==='p'){
    const d=color==='w'?-1:1,st=color==='w'?6:1;
    // forward 1 or 2 from start
    if(dc===0&&dr===d)return true;
    if(dc===0&&dr===2*d&&fr===st)return true;
    // diagonal capture
    if(adc===1&&dr===d)return true;
    return false;
  }
  if(p==='n')return(adr===2&&adc===1)||(adr===1&&adc===2);
  if(p==='b')return adr===adc&&adr>0;
  if(p==='r')return(dr===0||dc===0)&&(adr+adc>0);
  if(p==='q')return(adr===adc&&adr>0)||((dr===0||dc===0)&&adr+adc>0);
  if(p==='k'){
    // normal king move
    if(adr<=1&&adc<=1)return true;
    // castling
    if(adr===0&&adc===2)return true;
    return false;
  }
  return false;
}

/* Pure rules engine — no DOM, no Firebase. Safe to reuse server-side. */
export{pc,inB,TERM,ib,atk,fKp,inChk,raw,legals,anyLeg,applyMove,premoveValid,posKey,insufficientMaterial};
