/* ═══ BLITZ ODDS — app shell ═══
   State, rendering, and every screen. Everything that is not UI lives next door:
     engine.js   chess rules          elo.js       ratings + time handicap
     bots.js     bot roster + search  firebase.js  backend handles
     pieces.js   piece artwork        utils.js     formatting helpers
   Keep logic the server-side bot worker will need out of this file. */
import{fSet,fGet,fOn,fPush,auth,createUserWithEmailAndPassword,signInWithEmailAndPassword,sendPasswordResetEmail,onAuthStateChanged,signOut,deleteUser}from'./firebase.js';
import{pc,TERM,ib,legals,applyMove,premoveValid}from'./engine.js';
import{esc,fs,ft,timeAgo,h2hKey}from'./utils.js';
import{pi}from'./pieces.js';
import{applyAutoTime,finalizeGame,finalizeBotGame,resetBotEloLock}from'./elo.js';
import{BOT_NAMES,botElo,botDepth,startBotGame,getBotPlayers}from'./bots.js';

/* ═══ SESSION ═══
   Firebase Auth owns the session (persisted in localStorage by the SDK).
   We never store a password anywhere. The old 'chsess' key is purged on sight. */
const purgeLegacySession=()=>{try{localStorage.removeItem('chsess');}catch{}};
const AUTH_ERR={
  'auth/email-already-in-use':'That email is already registered. Sign in instead.',
  'auth/invalid-email':'Invalid email address.',
  'auth/weak-password':'Password must be at least 6 characters.',
  'auth/missing-password':'Password required.',
  'auth/invalid-credential':'Wrong email or password.',
  'auth/wrong-password':'Wrong email or password.',
  'auth/user-not-found':'Wrong email or password.',
  'auth/too-many-requests':'Too many attempts. Wait a minute and try again.',
  'auth/network-request-failed':'Network error. Check your connection.',
  'auth/operation-not-allowed':'Email sign-in is not enabled for this project yet.',
  'auth/configuration-not-found':'Authentication is not set up for this project yet.',
  'auth/unauthorized-domain':'This domain is not authorised for sign-in.',
  'auth/user-disabled':'This account has been disabled.'
};
const authErr=e=>AUTH_ERR[e?.code]||(e?.code?`Sign-in error (${e.code})`:'Something went wrong. Try again.');

/* ═══ DRAG STATE (pointer-based) ═══ */
const DS={on:false,fr:null,fc:null};
function initDrag(){
  document.addEventListener('pointermove',e=>{
    if(!DS.on)return;
    e.preventDefault();
    const g=document.getElementById('drag-ghost');
    if(g){g.style.left=e.clientX+'px';g.style.top=e.clientY+'px';}
  },{passive:false});
  document.addEventListener('pointerup',e=>{
    if(!DS.on)return;
    const board=document.getElementById('chboard');
    if(board&&DS.fr!==null){
      const rect=board.getBoundingClientRect();
      const px=e.clientX-rect.left,py=e.clientY-rect.top;
      if(px>=0&&px<rect.width&&py>=0&&py<rect.height){
        const myC=S.gInfo?.white===S.user?'w':'b';
        const flip=myC==='b';
        const dc=Math.floor(px/(rect.width/8)),dr=Math.floor(py/(rect.height/8));
        const tr=flip?7-dr:dr,tc=flip?7-dc:dc;
        W._mv(DS.fr,DS.fc,tr,tc);
      }
    }
    stopDrag();
  });
  document.addEventListener('pointercancel',stopDrag);
}
function stopDrag(){
  const g=document.getElementById('drag-ghost');if(g)g.style.display='none';
  // Restore dimmed piece
  const orig=document.querySelector('.sq-dragging');
  if(orig){orig.classList.remove('sq-dragging');const img=orig.querySelector('img');if(img)img.style.opacity='';}
  DS.on=false;DS.fr=null;DS.fc=null;
}

/* ═══ STATE ═══ */
const S={
  screen:'boot',user:null,uid:null,
  aMode:'login',aUser:'',aEmail:'',aPass:'',aErr:'',aBusy:false,
  fpMode:false,fpEmail:'',fpMsg:'',fpErr:'',
  pickErr:'',
  allPlayers:{},presence:{},
  inChalls:[],outChall:null,
  challDlg:false,challTarget:'',challColor:'r',wTimeSec:180,bTimeSec:180,challH2h:null,autoTime:false,
  sort:'elo',
  chatMsgs:[],
  gid:null,gInfo:null,gs:null,sel:null,lMv:[],promo:null,premove:null,
  dispMs:{w:0,b:0},
  specGid:null,specGInfo:null,specGs:null,specDispMs:{w:0,b:0},
  profileTarget:null,profileData:null,profileGames:[],profileTab:'stats'
};
let hbId=null,clockId=null,unsubs=[];
function unsub(){unsubs.forEach(u=>{try{u()}catch{}});unsubs=[];}

/* ═══ RENDER — preserves chat input ═══ */
function render(){
  // Save chat input value and focus state before re-render
  const ci=document.getElementById('chat-in');
  const chatVal=ci?ci.value:'';
  const chatFocus=document.activeElement===ci;

  const el=document.getElementById('app');if(!el)return;
  if(S.screen==='boot')el.innerHTML=bootHtml();
  else if(S.screen==='auth')el.innerHTML=authHtml();
  else if(S.screen==='pickname')el.innerHTML=pickNameHtml();
  else if(S.screen==='lobby')el.innerHTML=lobbyHtml();
  else if(S.screen==='game')el.innerHTML=gameHtml();
  else if(S.screen==='spectate')el.innerHTML=spectateHtml();
  else if(S.screen==='profile')el.innerHTML=profileHtml();

  // Restore chat input
  if(S.screen==='lobby'){
    const nci=document.getElementById('chat-in');
    if(nci&&chatVal){nci.value=chatVal;if(chatFocus){nci.focus();nci.setSelectionRange(chatVal.length,chatVal.length);}}
    // Scroll messages to bottom
    const msgs=document.getElementById('chat-msgs');if(msgs)msgs.scrollTop=msgs.scrollHeight;
  }
}

// Update only chat messages div (called from Firebase chat listener)
function patchChat(){
  const el=document.getElementById('chat-msgs');
  if(!el)return;
  el.innerHTML=chatMsgsHtml();
  el.scrollTop=el.scrollHeight;
}

function chatMsgsHtml(){
  if(!S.chatMsgs.length)return'<p style="color:#3d3a36;text-align:center;padding:1.5rem;font-size:.85rem">No messages yet</p>';
  return S.chatMsgs.map(m=>`<div style="padding:4px 0;border-bottom:1px solid #2a2927;font-size:.83rem;line-height:1.5"><span style="color:#759900;font-weight:600">${esc(m.user)}</span><span style="color:#6b6a69;font-size:.72rem;margin:0 5px">${timeAgo(m.ts)}</span><span style="color:#d0cdc8">${esc(m.text)}</span></div>`).join('');
}

/* ═══ TIME CTRL HTML ═══ */
function tcHtml(which,val){
  const p=[60,180,300,600],l=['1m','3m','5m','10m'];
  const isW=which==='w';
  const accent=isW?'#e8d090':'#9ab8d8';
  const bg=isW?'#2a2500':'#001828';
  const border=isW?'#8a7030':'#2c5a8c';
  return`<div style="background:${bg};border:1px solid ${border};border-radius:8px;padding:12px;margin-bottom:10px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <span style="font-size:1.05rem;font-weight:800;color:${accent};letter-spacing:.04em">${isW?'♔ WHITE':'♚ BLACK'}</span>
      <span id="tc-lbl-${which}" style="font-size:2rem;font-weight:800;font-family:monospace;color:${accent};letter-spacing:2px;background:rgba(0,0,0,.3);padding:4px 14px;border-radius:6px">${fs(val)}</span>
    </div>
    <div style="display:flex;gap:4px;margin-bottom:8px">
      ${p.map((s,i)=>`<button onclick="W.setT('${which}',${s})" style="flex:1;padding:6px 0;border-radius:5px;border:1px solid ${val===s?border:'#3d3a36'};background:${val===s?bg:'#161512'};color:${val===s?accent:'#bab9b8'};font-size:.82rem;font-weight:${val===s?'800':'600'};cursor:pointer">${l[i]}</button>`).join('')}
    </div>
    <div style="display:flex;align-items:center;gap:4px">
      <button onclick="W.adjT('${which}',-60)" class="tc-adj" style="border-color:${border}">−1m</button>
      <button onclick="W.adjT('${which}',-15)" class="tc-adj" style="border-color:${border}">−15s</button>
      <div style="flex:1;text-align:center;font-size:.75rem;color:#6b6a69">adjust</div>
      <button onclick="W.adjT('${which}',15)" class="tc-adj" style="border-color:${border}">+15s</button>
      <button onclick="W.adjT('${which}',60)" class="tc-adj" style="border-color:${border}">+1m</button>
    </div>
  </div>`;
}

/* ═══ AUTH (Firebase Authentication) ═══
   Identity lives in Firebase Auth; the DB only maps uid <-> username.
     usernames/{username} = uid   (uniqueness lock, write-once)
     uidNames/{uid}       = username
     players/{username}   = { uid, elo, ... }
   The rest of the app still works with S.user = username, unchanged. */
const NAME_RE=/^[a-z0-9_]{2,20}$/;
const START_ELO=1000;

const newPlayer=uid=>({uid,elo:START_ELO,joined:Date.now(),nationality:'',club:'',eloHistory:[{elo:START_ELO,ts:Date.now()}]});

async function ensurePlayer(name,uid){
  const p=await fGet(`players/${name}`);
  if(!p)await fSet(`players/${name}`,newPlayer(uid));
  else if(p.uid!==uid)await fSet(`players/${name}`,{...p,uid});
}

// Claims a username for a uid. Returns '' on success, or an error message.
async function claimUsername(uid,name){
  if(!NAME_RE.test(name))return'Username: 2-20 chars (a-z, 0-9, _)';
  const owner=await fGet(`usernames/${name}`);
  if(owner&&owner!==uid)return'That username is taken.';
  // A rejected write is almost always the rules, not a race — don't blame the name for it.
  const denied=e=>e?.code==='PERMISSION_DENIED'||/permission.?denied/i.test(e?.message||'');
  try{await fSet(`usernames/${name}`,uid);}
  catch(e){return denied(e)?'Server refused the write — database rules are not configured.':'That username is taken.';}
  try{await fSet(`uidNames/${uid}`,name);await ensurePlayer(name,uid);}
  catch(e){return denied(e)?'Server refused the write — database rules are not configured.':'Could not finish your profile. Try again.';}
  return'';
}

function bootHtml(){
  return`<div style="display:flex;justify-content:center;align-items:center;height:100svh;color:#6b6a69">Loading...</div>`;
}

function pickNameHtml(){
  return`<div style="display:flex;justify-content:center;align-items:center;min-height:100svh;padding:1rem"><div style="background:#1f1e1d;border-radius:12px;padding:2rem;width:100%;max-width:360px;border:1px solid #2a2927">
    <h2 style="color:#f0ede8;margin-bottom:.5rem;font-size:1.1rem">Choose your username</h2>
    <p style="color:#6b6a69;font-size:.85rem;margin-bottom:1rem">This is the name other players will see. It cannot be changed later.</p>
    <input type="text" id="pkn" placeholder="Username (2-20 chars)" autocapitalize="none" autocomplete="username" style="margin-bottom:10px" onkeydown="if(event.key==='Enter')W.pickName()">
    ${S.pickErr?`<p style="color:#cc4444;font-size:.85rem;margin-bottom:10px">${esc(S.pickErr)}</p>`:''}
    <div style="display:flex;gap:8px">
      <button onclick="W.logout()" class="btn-o" style="flex:1">Sign out</button>
      <button onclick="W.pickName()" class="btn-g" style="flex:2"${S.aBusy?' disabled':''}>${S.aBusy?'...':'Continue'}</button>
    </div>
  </div></div>`;
}

function authHtml(){
  if(S.fpMode)return`<div style="display:flex;justify-content:center;align-items:center;min-height:100svh;padding:1rem"><div style="background:#1f1e1d;border-radius:12px;padding:2rem;width:100%;max-width:360px;border:1px solid #2a2927">
    <h2 style="color:#f0ede8;margin-bottom:.5rem;font-size:1.1rem">🔑 Reset password</h2>
    <p style="color:#6b6a69;font-size:.85rem;margin-bottom:1rem">Enter your email and we'll send you a link to set a new password.</p>
    <input type="email" id="fpe" placeholder="Email address" value="${esc(S.fpEmail)}" autocomplete="email" style="margin-bottom:10px" onkeydown="if(event.key==='Enter')W.fpSub()">
    ${S.fpMsg?`<p style="color:#a8c000;font-size:.88rem;margin-bottom:10px">${esc(S.fpMsg)}</p>`:''}
    ${S.fpErr?`<p style="color:#cc4444;font-size:.85rem;margin-bottom:10px">${esc(S.fpErr)}</p>`:''}
    <div style="display:flex;gap:8px">
      <button onclick="W.fpBack()" class="btn-o" style="flex:1">← Back</button>
      <button onclick="W.fpSub()" class="btn-g" style="flex:2"${S.aBusy?' disabled':''}>${S.aBusy?'Sending...':'Send reset link'}</button>
    </div>
  </div></div>`;
  const reg=S.aMode==='register';
  return`<div style="display:flex;justify-content:center;align-items:center;min-height:100svh;padding:1rem"><div style="background:#1f1e1d;border-radius:12px;padding:2rem;width:100%;max-width:380px;border:1px solid #2a2927"><div style="text-align:center;margin-bottom:1.75rem"><div style="font-size:2.5rem;margin-bottom:.4rem">♟</div><h1 style="font-size:1.4rem;font-weight:700;color:#f0ede8">Blitz Odds</h1><p style="color:#6b6a69;font-size:.8rem;margin-top:3px">Chess with time odds</p></div>
  <div style="display:flex;gap:4px;margin-bottom:1.5rem;background:#161512;border-radius:8px;padding:4px"><button onclick="W.aMode('login')" style="flex:1;padding:8px;border-radius:6px;border:none;font-weight:600;font-size:.85rem;background:${reg?'transparent':'#759900'};color:${reg?'#6b6a69':'#fff'}">Sign in</button><button onclick="W.aMode('register')" style="flex:1;padding:8px;border-radius:6px;border:none;font-weight:600;font-size:.85rem;background:${reg?'#759900':'transparent'};color:${reg?'#fff':'#6b6a69'}">Register</button></div>
  <div style="display:flex;flex-direction:column;gap:10px">
    ${reg?`<input type="text" id="au" placeholder="Username (2-20 chars)" value="${esc(S.aUser)}" autocapitalize="none" autocomplete="username" onkeydown="if(event.key==='Enter')W.auth()">`:``}
    <input type="email" id="ae" placeholder="Email address" value="${esc(S.aEmail)}" autocomplete="email" onkeydown="if(event.key==='Enter')W.auth()">
    <input type="password" id="ap" placeholder="${reg?'Password (min 6 chars)':'Password'}" autocomplete="${reg?'new-password':'current-password'}" onkeydown="if(event.key==='Enter')W.auth()">
    ${S.aErr?`<p style="color:#cc4444;font-size:.85rem">${esc(S.aErr)}</p>`:''}
    <button onclick="W.auth()" class="btn-g" style="width:100%;margin-top:2px"${S.aBusy?' disabled':''}>${S.aBusy?'...':(reg?'Create account':'Sign in')}</button>
    ${reg?``:`<button onclick="W.fpStart()" style="background:transparent;border:none;color:#6b6a69;font-size:.82rem;text-decoration:underline;padding:2px">Forgot password?</button>`}
  </div></div></div>`;
}
window.W={};
W.aMode=m=>{S.aMode=m;S.aErr='';render();};
W.fpStart=()=>{S.fpMode=true;S.fpMsg='';S.fpErr='';render();};
W.fpBack=()=>{S.fpMode=false;S.fpErr='';render();};

W.fpSub=async()=>{
  const e=(document.getElementById('fpe')?.value||'').trim().toLowerCase();
  S.fpEmail=e;S.fpMsg='';S.fpErr='';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)){S.fpErr='Invalid email.';render();return;}
  S.aBusy=true;render();
  try{
    await sendPasswordResetEmail(auth,e);
    // Firebase does not reveal whether the address exists — keep the wording neutral.
    S.fpMsg='If an account exists for that email, a reset link is on its way. Check your spam folder too.';
  }catch(err){S.fpErr=authErr(err);}
  S.aBusy=false;render();
};

W.auth=async()=>{
  const u=(document.getElementById('au')?.value||'').trim().toLowerCase();
  const e=(document.getElementById('ae')?.value||'').trim().toLowerCase();
  const p=document.getElementById('ap')?.value||'';
  const reg=S.aMode==='register';
  S.aUser=u;S.aEmail=e;S.aErr='';
  if(!e||!p||(reg&&!u)){S.aErr='All fields required.';render();return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)){S.aErr='Invalid email.';render();return;}
  if(reg&&!NAME_RE.test(u)){S.aErr='Username: 2-20 chars (a-z, 0-9, _)';render();return;}
  if(reg&&p.length<6){S.aErr='Password must be at least 6 characters.';render();return;}
  S.aBusy=true;render();
  try{
    if(reg){
      if(await fGet(`usernames/${u}`)){S.aErr='That username is taken.';S.aBusy=false;render();return;}
      regInProgress=true;
      const cred=await createUserWithEmailAndPassword(auth,e,p);
      const err=await claimUsername(cred.user.uid,u);
      regInProgress=false;
      if(err){S.uid=cred.user.uid;S.pickErr=err;S.aBusy=false;S.screen='pickname';render();return;}
      S.aBusy=false;await resolveUser(cred.user);
    }else{
      const cred=await signInWithEmailAndPassword(auth,e,p);
      S.aBusy=false;await resolveUser(cred.user);
    }
  }catch(err){
    regInProgress=false;
    S.aErr=authErr(err);S.aBusy=false;render();
  }
};

W.pickName=async()=>{
  const n=(document.getElementById('pkn')?.value||'').trim().toLowerCase();
  const user=auth.currentUser;
  if(!user){S.screen='auth';render();return;}
  S.pickErr='';S.aBusy=true;render();
  const err=await claimUsername(user.uid,n);
  S.aBusy=false;
  if(err){S.pickErr=err;render();return;}
  await resolveUser(user);
};

/* Single entry point: whatever Firebase says about the session decides the screen. */
let regInProgress=false,resolving=false;
async function resolveUser(fbUser){
  if(!fbUser){S.user=null;S.uid=null;S.screen='auth';render();return;}
  if(resolving)return;
  resolving=true;
  try{
    S.uid=fbUser.uid;
    const name=await fGet(`uidNames/${fbUser.uid}`);
    if(!name){S.screen='pickname';render();return;}
    S.user=name;S.aErr='';
    await ensurePlayer(name,fbUser.uid);
    startLobby();
  }finally{resolving=false;}
}

/* ═══ LOBBY ═══ */
function startLobby(){
  S.screen='lobby';S.gid=null;S.gInfo=null;S.gs=null;S.outChall=null;S.inChalls=[];S.premove=null;S.profileTarget=null;
  clearInterval(hbId);
  const beat=()=>fSet(`presence/${S.user}`,{ts:Date.now(),status:'online'});
  beat();hbId=setInterval(beat,5000);
  unsub();
  const u1=fOn('presence',d=>{S.presence=d||{};if(S.screen==='lobby')render();});
  const u2=fOn('players',d=>{S.allPlayers=d||{};if(S.screen==='lobby')render();});
  const u3=fOn('challenges',d=>{
    if(!d){S.inChalls=[];if(S.screen==='lobby')render();return;}
    const mine=[];
    for(const[id,ch]of Object.entries(d)){
      if(!ch)continue;
      if(ch.to===S.user&&ch.status==='pending')mine.push({...ch,id});
      if(ch.from===S.user&&ch.status==='accepted'&&ch.gameId&&!ch.joined){fSet(`challenges/${id}`,{...ch,joined:true});S.outChall=null;fGet(`games/${ch.gameId}`).then(g=>{if(g)enterGame(ch.gameId,g);});return;}
      if(ch.from===S.user&&ch.status==='declined'){fSet(`challenges/${id}`,{...ch,status:'closed'});S.outChall=null;if(S.screen==='lobby')render();}
    }
    S.inChalls=mine;if(S.screen==='lobby')render();
  });
  // Chat: ONLY updates the messages div, never touches the input
  const u4=fOn('chat',d=>{
    S.chatMsgs=d?Object.values(d).sort((a,b)=>a.ts-b.ts).slice(-60):[];
    patchChat();
  });
  unsubs.push(u1,u2,u3,u4);
  render();
}

function pStatus(n){const now=Date.now(),p=S.presence[n];if(!p||now-p.ts>15000)return'inactive';return p.status||'online';}
function pGameId(n){return S.presence[n]?.gameId||null;}

function lobbyHtml(){
  const botPlrs=getBotPlayers();
  const botNames=new Set(BOT_NAMES);
  const botList=Object.entries(botPlrs).map(([k,v])=>({name:k,elo:S.allPlayers[k]?.elo??v.elo??1000,status:'online',gameId:null,isBot:true}));
  // exclude bots from the real-player list to avoid duplicates
  let pl=[...Object.entries(S.allPlayers).filter(([k])=>!botNames.has(k)).map(([k,v])=>({name:k,elo:v.elo||1000,status:pStatus(k),gameId:pGameId(k)})),...botList];
  if(S.sort==='elo')pl.sort((a,b)=>b.elo-a.elo);else pl.sort((a,b)=>a.name.localeCompare(b.name));
  const myElo=S.allPlayers[S.user]?.elo||1000;
  const myRank=pl.findIndex(p=>p.name===S.user)+1;
  const dot=s=>`<span style="width:8px;height:8px;border-radius:50%;background:${s==='online'?'#759900':s==='ingame'?'#cc4444':'#3d3a36'};display:inline-block;flex-shrink:0"></span>`;
  const inC=S.inChalls.length?`<div class="card"><h3 style="margin:0 0 8px;color:#c8a400;font-size:.85rem">⚔ Challenges received</h3>${S.inChalls.map(ch=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#161512;border-radius:6px;margin-bottom:5px;gap:6px;flex-wrap:wrap"><div><b style="color:#f0ede8">${esc(ch.from)}</b><span style="color:#c8a400;font-size:.8rem;margin-left:5px">${S.allPlayers[ch.from]?.elo||1000}</span><div style="color:#6b6a69;font-size:.76rem;margin-top:1px">♔${fs(ch.whiteMs/1000)} | ♚${fs(ch.blackMs/1000)} — you: <span style="color:#759900">${ch.challColor==='w'?'black':'white'}</span></div></div><div style="display:flex;gap:5px"><button onclick="W.accept('${esc(ch.id)}')" class="btn-g" style="padding:5px 10px;font-size:.82rem">Accept</button><button onclick="W.decline('${esc(ch.id)}')" class="btn-r" style="padding:5px 10px;font-size:.82rem">Decline</button></div></div>`).join('')}</div>`:'';
  const outC=S.outChall?`<div style="background:#1f1e1d;border-radius:8px;padding:10px 14px;margin-bottom:10px;border:1px solid #2a2927;border-left:3px solid #c8a400;display:flex;justify-content:space-between;align-items:center"><span style="color:#c8a400;font-size:.88rem">⏳ Sent to <b>${esc(S.outChall.to)}</b>...</span><button onclick="W.cancelC()" class="btn-o" style="padding:4px 10px;font-size:.78rem">Cancel</button></div>`:'';
  const rows=pl.map((p,i)=>{
    const isMe=p.name===S.user,canC=p.status==='online'&&!S.outChall&&!isMe,canW=p.status==='ingame'&&p.gameId&&!p.isBot;
    return`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:${isMe?'#1a2a1a':'#161512'};border-radius:6px;margin-bottom:4px;border:${isMe?'1px solid #2a4a2a':'1px solid transparent'}">
      <div style="display:flex;align-items:center;gap:7px;min-width:0">
        <span style="color:#6b6a69;font-size:.72rem;min-width:20px;text-align:right">#${i+1}</span>
        ${dot(p.status)}
        <div><div style="display:flex;align-items:center;gap:5px">
          <button onclick="W.openProf('${esc(p.name)}')" style="background:none;border:none;padding:0;color:${p.status==='inactive'?'#6b6a69':isMe?'#a8c000':'#f0ede8'};font-weight:700;font-size:.9rem;cursor:pointer;text-decoration:underline;text-underline-offset:2px">${esc(p.name)}${isMe?' ◀':''}</button>
          <span style="color:#c8a400;font-size:.8rem;font-weight:600">${p.elo}</span>
          ${p.isBot?'':p.status==='ingame'?`<span style="color:#cc4444;font-size:.7rem">playing</span>`:p.status==='inactive'?`<span style="color:#3d3a36;font-size:.7rem">offline</span>`:''}
        </div></div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        ${canC?`<button onclick="W.openC('${esc(p.name)}')" class="btn-b">Challenge</button>`:''}
        ${canW?`<button onclick="W.spectate('${esc(p.gameId)}')" class="btn-v">Watch</button>`:''}
      </div>
    </div>`;
  }).join('');

  const dlg=challDlgHtml(myElo);
  return`<div style="max-width:560px;margin:0 auto;padding:.75rem">
  <div style="display:flex;justify-content:space-between;align-items:center;padding-top:.5rem;margin-bottom:1rem">
    <div><h1 style="font-size:1.2rem;font-weight:700;color:#f0ede8">♟ Lobby</h1>
    <p style="font-size:.78rem"><button onclick="W.openProf('${esc(S.user)}')" style="background:none;border:none;padding:0;color:#759900;font-weight:700;cursor:pointer;text-decoration:underline;font-size:.78rem">${esc(S.user)}</button> <span style="color:#c8a400">ELO ${myElo}</span> <span style="color:#6b6a69">#${myRank}</span></p></div>
    <div style="display:flex;gap:5px;align-items:center">
      <button onclick="W.sort('elo')" class="sort-btn${S.sort==='elo'?' active':''}">ELO</button>
      <button onclick="W.sort('alpha')" class="sort-btn${S.sort==='alpha'?' active':''}">A-Z</button>
      <button onclick="W.logout()" class="btn-o" style="padding:5px 12px;font-size:.82rem">Logout</button>
    </div>
  </div>
  ${inC}${outC}
  <div class="card" style="padding:10px"><h3 style="margin:0 0 8px;font-size:.82rem;color:#6b6a69">Leaderboard (${pl.length})</h3>${rows}</div>
  <div class="card">
    <h3 style="margin:0 0 8px;font-size:.85rem;color:#6b6a69">💬 Chat</h3>
    <div id="chat-msgs" style="height:150px;overflow-y:auto;margin-bottom:8px">${chatMsgsHtml()}</div>
    <div style="display:flex;gap:6px">
      <input type="text" id="chat-in" placeholder="Message..." maxlength="200" onkeydown="if(event.key==='Enter'){W.sendChat();event.preventDefault();}" style="flex:1;padding:8px 10px;font-size:.9rem">
      <button onclick="W.sendChat()" class="btn-g" style="padding:8px 14px;font-size:.9rem">→</button>
    </div>
  </div>
</div>${dlg}`;
}

function challDlgHtml(myElo){
  if(!S.challDlg)return'';
  const botPlrs2=getBotPlayers();
  const oppElo=S.allPlayers[S.challTarget]?.elo??(botPlrs2[S.challTarget]?.elo??1000);
  const dis=S.autoTime?'style="opacity:.4;pointer-events:none"':'';
  return`<div style="position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;justify-content:center;align-items:flex-start;z-index:100;padding:1rem;overflow-y:auto" onmousedown="if(event.target===this)W.closeC()">
  <div style="background:#1f1e1d;border-radius:12px;padding:1.5rem;width:100%;max-width:400px;border:1px solid #2a2927;margin:auto" onmousedown="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem">
      <div><h2 style="font-size:1rem;color:#f0ede8">⚔ Challenge ${esc(S.challTarget)}</h2>
      <div style="font-size:.8rem;margin-top:3px"><span style="color:#c8a400">You: ${myElo}</span> <span style="color:#c8a400;margin-left:8px">${esc(S.challTarget)}: ${oppElo}</span></div></div>
      ${S.challH2h?`<div style="text-align:right;font-size:.76rem;color:#6b6a69;line-height:1.7"><div>W:<b style="color:#759900">${S.challH2h.myWins}</b> D:<b style="color:#c8a400">${S.challH2h.draws}</b> L:<b style="color:#cc4444">${S.challH2h.oppWins}</b></div></div>`:''}
    </div>
    <p style="margin:0 0 7px;color:#bab9b8;font-size:.83rem">You play as:</p>
    <div style="display:flex;gap:5px;margin-bottom:1rem">
      <button onclick="W.cColor('w')" style="flex:1;padding:7px;border-radius:6px;border:2px solid ${S.challColor==='w'?'#759900':'#3d3a36'};background:${S.challColor==='w'?'#2a3a00':'#161512'};color:${S.challColor==='w'?'#a8c000':'#bab9b8'};cursor:pointer;font-weight:600;font-size:.8rem">White ♔</button>
      <button onclick="W.cColor('r')" style="flex:1;padding:7px;border-radius:6px;border:2px solid ${S.challColor==='r'?'#759900':'#3d3a36'};background:${S.challColor==='r'?'#2a3a00':'#161512'};color:${S.challColor==='r'?'#a8c000':'#bab9b8'};cursor:pointer;font-weight:600;font-size:.8rem">🎲 Random</button>
      <button onclick="W.cColor('b')" style="flex:1;padding:7px;border-radius:6px;border:2px solid ${S.challColor==='b'?'#759900':'#3d3a36'};background:${S.challColor==='b'?'#2a3a00':'#161512'};color:${S.challColor==='b'?'#a8c000':'#bab9b8'};cursor:pointer;font-weight:600;font-size:.8rem">Black ♚</button>
    </div>
    <button onclick="W.toggleAuto()" style="width:100%;padding:9px;border-radius:6px;font-weight:700;font-size:.88rem;margin-bottom:12px;border:2px solid ${S.autoTime?'#759900':'#3d3a36'};background:${S.autoTime?'#2a3a00':'#161512'};color:${S.autoTime?'#a8c000':'#bab9b8'};cursor:pointer">
      ⚡ Auto (ELO handicap)${S.autoTime?` — ♔${fs(S.wTimeSec)} | ♚${fs(S.bTimeSec)}`:''}
    </button>
    <div ${dis}>${tcHtml('w',S.wTimeSec)}${tcHtml('b',S.bTimeSec)}</div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button onclick="W.closeC()" class="btn-o" style="flex:1">Cancel</button>
      <button onclick="W.send()" class="btn-g" style="flex:2">Send challenge</button>
    </div>
  </div></div>`;
}

W.sort=s=>{S.sort=s;render();};
W.setT=(w,v)=>{if(S.autoTime)return;if(w==='w')S.wTimeSec=Math.min(600,Math.max(0,+v));else S.bTimeSec=Math.min(600,Math.max(0,+v));render();};
W.adjT=(w,d)=>{W.setT(w,(w==='w'?S.wTimeSec:S.bTimeSec)+d);};
W.toggleAuto=()=>{S.autoTime=!S.autoTime;if(S.autoTime){const botPlrsAT=getBotPlayers();const myEloAT=S.allPlayers[S.user]?.elo||1000;const oppEloAT=botPlrsAT[S.challTarget]?botPlrsAT[S.challTarget].elo:(S.allPlayers[S.challTarget]?.elo||1000);const{mySec,oppSec}=applyAutoTime(myEloAT,oppEloAT);const mw=S.challColor==='w';S.wTimeSec=mw?mySec:oppSec;S.bTimeSec=mw?oppSec:mySec;}render();};
W.sendChat=async()=>{const inp=document.getElementById('chat-in');const txt=(inp?.value||'').trim();if(!txt||!S.user)return;await fPush('chat',{user:S.user,text:txt,ts:Date.now()});if(inp){inp.value='';inp.focus();}};
W.openC=async t=>{S.challTarget=t;S.challDlg=true;S.challH2h=null;S.autoTime=false;render();const h=await fGet(`h2h/${h2hKey(S.user,t)}`);S.challH2h=h?{myWins:h[S.user]||0,oppWins:h[t]||0,draws:h.draws||0}:{myWins:0,oppWins:0,draws:0};if(S.challDlg)render();};
W.closeC=()=>{S.challDlg=false;render();};
W.cColor=c=>{S.challColor=c;render();};
W.send=async()=>{
  const id=`${S.user}_${S.challTarget}_${Date.now()}`;
  const rc=S.challColor==='r'?(Math.random()<0.5?'w':'b'):S.challColor;
  let wMs=S.wTimeSec*1000,bMs=S.bTimeSec*1000;
  const botPlrs=getBotPlayers();
  const isBot=!!botPlrs[S.challTarget];
  if(S.autoTime){
    const myElo=S.allPlayers[S.user]?.elo||1000;
    const oppElo=isBot?(S.allPlayers[S.challTarget]?.elo??botElo(BOT_NAMES.indexOf(S.challTarget))):S.allPlayers[S.challTarget]?.elo||1000;
    const{mySec,oppSec}=applyAutoTime(myElo,oppElo);
    const mw=rc==='w';wMs=(mw?mySec:oppSec)*1000;bMs=(mw?oppSec:mySec)*1000;
  }
  if(isBot){
    // Instant bot game
    const white=rc==='w'?S.user:S.challTarget,black=rc==='w'?S.challTarget:S.user;
    const botColor=rc==='w'?'b':'w'; // bot plays opposite of user
    const botEloVal=S.allPlayers[S.challTarget]?.elo??botElo(BOT_NAMES.indexOf(S.challTarget));
    const depth=botDepth(botEloVal);
    const game={white,black,whiteMs:wMs,blackMs:bMs,initWhiteMs:wMs,initBlackMs:bMs,lastMoveTs:Date.now(),boardJson:JSON.stringify(ib()),turn:'w',castling:{wK:true,wQ:true,bK:true,bQ:true},enPassant:null,fullMoves:1,status:'ongoing',eloUpdated:false,isBot:true,botName:S.challTarget,botColor,botElo:botEloVal,botDepth:depth};
    await fSet(`games/${id}`,game);
    S.challDlg=false;
    enterGame(id,game);
    // Start bot engine
    startBotGame(id,S.challTarget,botColor,botEloVal,depth);
    return;
  }
  await fSet(`challenges/${id}`,{from:S.user,to:S.challTarget,challColor:rc,whiteMs:wMs,blackMs:bMs,status:'pending',ts:Date.now()});
  S.outChall={from:S.user,to:S.challTarget,whiteMs:wMs,blackMs:bMs,id};S.challDlg=false;render();
};
W.cancelC=async()=>{if(!S.outChall)return;await fSet(`challenges/${S.outChall.id}`,{...S.outChall,status:'cancelled'});S.outChall=null;render();};
W.accept=async id=>{
  const ch=S.inChalls.find(c=>c.id===id);if(!ch)return;
  const white=ch.challColor==='w'?ch.from:ch.to,black=ch.challColor==='w'?ch.to:ch.from;
  const game={white,black,whiteMs:ch.whiteMs,blackMs:ch.blackMs,initWhiteMs:ch.whiteMs,initBlackMs:ch.blackMs,lastMoveTs:Date.now(),boardJson:JSON.stringify(ib()),turn:'w',castling:{wK:true,wQ:true,bK:true,bQ:true},enPassant:null,fullMoves:1,status:'ongoing',eloUpdated:false};
  await fSet(`games/${id}`,game);await fSet(`challenges/${id}`,{...ch,status:'accepted',gameId:id});
  enterGame(id,game);
};
W.decline=async id=>{const ch=S.inChalls.find(c=>c.id===id);if(ch)await fSet(`challenges/${id}`,{...ch,status:'declined'});};
W.logout=async()=>{clearInterval(hbId);unsub();if(S.user)await fSet(`presence/${S.user}`,{ts:0,status:'offline'});S.user=null;S.uid=null;try{await signOut(auth);}catch{}S.screen='auth';render();};

/* ═══ PROFILE ═══ */
W.openProf=async name=>{S.profileTarget=name;S.profileData=null;S.profileGames=[];S.profileTab='stats';S.screen='profile';render();const[pd,pg]=await Promise.all([fGet(`players/${name}`),fGet(`playerGames/${name}`)]);S.profileData=pd||{elo:1000};S.profileGames=pg?Object.values(pg).sort((a,b)=>b.ts-a.ts):[];if(S.screen==='profile')render();};
W.profTab=t=>{S.profileTab=t;render();};
W.saveProf=async()=>{const nat=(document.getElementById('pn')?.value||'').trim().slice(0,50),club=(document.getElementById('pc')?.value||'').trim().slice(0,50);const p=await fGet(`players/${S.profileTarget}`);await fSet(`players/${S.profileTarget}`,{...p,nationality:nat,club});S.profileData={...S.profileData,nationality:nat,club};render();};
W.backLobby=()=>{S.screen='lobby';render();};
W.deleteAccount=async()=>{
  if(!confirm('Permanently delete your account and all data? This cannot be undone.'))return;
  if(!confirm('Are you sure? All your games, ELO and profile will be deleted forever.'))return;
  const u=S.user,fbUser=auth.currentUser;
  if(!u||!fbUser)return;
  // DB first, while the rules can still match this uid; the auth user goes last.
  try{
    await Promise.all([
      fSet(`players/${u}`,null),
      fSet(`presence/${u}`,null),
      fSet(`playerGames/${u}`,null),
      fSet(`usernames/${u}`,null),
      fSet(`uidNames/${fbUser.uid}`,null)
    ]);
  }catch{alert('Could not delete your data. Try again in a moment.');return;}
  clearInterval(hbId);unsub();
  try{await deleteUser(fbUser);}
  catch(e){
    // Firebase refuses to delete an account signed in long ago.
    if(e?.code==='auth/requires-recent-login'){
      alert('Your data was deleted. For security, sign in once more to remove the login itself.');
    }
    try{await signOut(auth);}catch{}
  }
  S.user=null;S.uid=null;S.screen='auth';render();
};

function profileHtml(){
  const name=S.profileTarget,pd=S.profileData;
  const myElo=pd?.elo||1000;
  const allP=Object.entries(S.allPlayers).sort((a,b)=>b[1].elo-a[1].elo);
  const rank=allP.findIndex(([k])=>k===name)+1;
  const isMe=name===S.user;
  if(!pd)return`<div style="max-width:560px;margin:0 auto;padding:1rem"><button onclick="W.backLobby()" class="btn-o" style="margin-bottom:1rem">← Lobby</button><div style="text-align:center;padding:3rem;color:#6b6a69">Loading...</div></div>`;
  const tabs=[['stats','Stats'],['games','Games'],['rivals','Rivals'],isMe?['edit','Edit']:null].filter(Boolean);
  let body='';
  if(S.profileTab==='stats'){
    const hist=pd?.eloHistory||[];
    if(hist.length>1){
      const elos=hist.map(h=>h.elo),mn=Math.min(...elos)-20,mx=Math.max(...elos)+20;
      const W2=320,H=100,pad=16;
      const pts=hist.map((h,i)=>`${pad+i*(W2-2*pad)/(hist.length-1)},${H-pad-(h.elo-mn)/(mx-mn)*(H-2*pad)}`).join(' ');
      body=`<div class="card" style="padding:10px"><div style="font-size:.8rem;color:#6b6a69;margin-bottom:6px">ELO progression</div><svg width="100%" viewBox="0 0 ${W2} ${H}"><polyline points="${pts}" fill="none" stroke="#759900" stroke-width="2"/>${hist.map((h,i)=>`<circle cx="${pad+i*(W2-2*pad)/(hist.length-1)}" cy="${H-pad-(h.elo-mn)/(mx-mn)*(H-2*pad)}" r="2.5" fill="#a8c000"/>`).join('')}<text x="${pad}" y="${H-2}" font-size="10" fill="#6b6a69">${hist[0]?.elo}</text><text x="${W2-pad}" y="${H-2}" font-size="10" fill="#6b6a69" text-anchor="end">${hist[hist.length-1]?.elo}</text></svg></div>`;
    } else body='<p style="color:#3d3a36;text-align:center;padding:1rem;font-size:.85rem">Play more games to see chart</p>';
  }
  if(S.profileTab==='games'){
    const rec=(S.profileGames||[]).slice(0,10);
    body=!rec.length?'<p style="color:#3d3a36;text-align:center;padding:1rem;font-size:.85rem">No games yet</p>':
    `<div class="card" style="padding:0;overflow:hidden">${rec.map(g=>{const iW=g.white===name;const opp=iW?g.black:g.white;const sc=iW?g.wScore:g.bScore;const dl=iW?g.wEloDelta:g.bEloDelta;const res=sc===1?'Win':sc===0?'Loss':'Draw';const rc2=sc===1?'#759900':sc===0?'#cc4444':'#c8a400';return`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #2a2927"><div><b style="color:${rc2};font-size:.85rem">${res}</b> <span style="color:#bab9b8;font-size:.82rem">vs ${esc(opp)}</span><div style="color:#6b6a69;font-size:.72rem">♔${fs(g.initWhiteMs/1000)} | ♚${fs(g.initBlackMs/1000)} · ${timeAgo(g.ts)}</div></div><span style="color:${dl>=0?'#759900':'#cc4444'};font-weight:700;font-size:.88rem">${dl>0?'+':''}${dl}</span></div>`;}).join('')}</div>`;
  }
  if(S.profileTab==='rivals'){
    const oC={};(S.profileGames||[]).forEach(g=>{const o=g.white===name?g.black:g.white;oC[o]=(oC[o]||0)+1;});
    const top5=Object.entries(oC).sort((a,b)=>b[1]-a[1]).slice(0,5);
    body=!top5.length?'<p style="color:#3d3a36;text-align:center;padding:1rem;font-size:.85rem">No opponents yet</p>':
    `<div class="card" style="padding:0;overflow:hidden">${top5.map(([opp,cnt],i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #2a2927"><div style="display:flex;align-items:center;gap:8px"><span style="color:#6b6a69;font-size:.8rem">#${i+1}</span><button onclick="W.openProf('${esc(opp)}')" style="background:none;border:none;color:#f0ede8;font-weight:700;cursor:pointer;text-decoration:underline;font-size:.88rem">${esc(opp)}</button><span style="color:#c8a400;font-size:.8rem">${S.allPlayers[opp]?.elo||'—'}</span></div><span style="color:#6b6a69;font-size:.8rem">${cnt} game${cnt>1?'s':''}</span></div>`).join('')}</div>`;
  }
  if(S.profileTab==='edit'&&isMe){
    body=`<div class="card"><div style="display:flex;flex-direction:column;gap:10px"><div><label style="font-size:.82rem;color:#bab9b8;display:block;margin-bottom:5px">Nationality</label><input type="text" id="pn" placeholder="e.g. Romania 🇷🇴" value="${esc(pd?.nationality||'')}" maxlength="50"></div><div><label style="font-size:.82rem;color:#bab9b8;display:block;margin-bottom:5px">Club</label><input type="text" id="pc" placeholder="e.g. Chess Club" value="${esc(pd?.club||'')}" maxlength="50"></div><button onclick="W.saveProf()" class="btn-g" style="width:100%">Save</button>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid #2a2927">
        <p style="font-size:.78rem;color:#6b6a69;margin-bottom:8px">Danger zone</p>
        <button onclick="W.deleteAccount()" style="width:100%;padding:9px;border-radius:6px;border:1px solid #882020;background:transparent;color:#cc4444;cursor:pointer;font-weight:600;font-size:.85rem">Delete my account</button>
      </div></div></div>`;
  }
  return`<div style="max-width:560px;margin:0 auto;padding:.75rem;padding-top:1rem">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:44px;height:44px;border-radius:50%;background:#2a3a00;display:flex;align-items:center;justify-content:center;font-size:1.3rem;border:2px solid #759900">${esc(name[0].toUpperCase())}</div>
      <div><h2 style="color:#f0ede8;font-size:1.1rem">${esc(name)}</h2><div style="font-size:.78rem;color:#6b6a69">${pd?.nationality||''} ${pd?.club?'· '+pd.club:''}</div></div>
    </div>
    <button onclick="W.backLobby()" class="btn-o" style="padding:5px 12px;font-size:.82rem">← Lobby</button>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:1rem">
    <div class="card" style="text-align:center;padding:10px"><div style="color:#6b6a69;font-size:.72rem">ELO</div><div style="font-size:1.3rem;font-weight:700;color:#c8a400">${myElo}</div></div>
    <div class="card" style="text-align:center;padding:10px"><div style="color:#6b6a69;font-size:.72rem">Rank</div><div style="font-size:1.3rem;font-weight:700;color:#f0ede8">#${rank||'—'}</div></div>
    <div class="card" style="text-align:center;padding:10px"><div style="color:#6b6a69;font-size:.72rem">Games</div><div style="font-size:1.3rem;font-weight:700;color:#f0ede8">${(S.profileGames||[]).length}</div></div>
  </div>
  <div style="display:flex;gap:4px;background:#161512;border-radius:8px;padding:4px;margin-bottom:1rem">${tabs.map(([t,l])=>`<button onclick="W.profTab('${t}')" class="tab${S.profileTab===t?' active':''}">${l}</button>`).join('')}</div>
  ${body}
  </div>`;
}

/* ═══ GAME ═══ */
function enterGame(gid,game){
  clearInterval(hbId);unsub();
  S.gid=gid;S.gInfo=game;
  S.gs={board:JSON.parse(game.boardJson),turn:game.turn,castling:game.castling,enPassant:game.enPassant||null,fullMoves:game.fullMoves,status:game.status};
  S.sel=null;S.lMv=[];S.promo=null;S.premove=null;S.screen='game';
  if(game.isBot&&game.botName&&game.botColor&&!TERM.includes(game.status)){
    resetBotEloLock();
    startBotGame(gid,game.botName,game.botColor,game.botElo||1000,game.botDepth||2);
  }
  fSet(`presence/${S.user}`,{ts:Date.now(),status:'ingame',gameId:gid});
  hbId=setInterval(()=>fSet(`presence/${S.user}`,{ts:Date.now(),status:'ingame',gameId:gid}),5000);
  render();
  const u=fOn(`games/${gid}`,g=>{
    if(!g)return;S.gInfo=g;
    S.gs={board:JSON.parse(g.boardJson),turn:g.turn,castling:g.castling,enPassant:g.enPassant||null,fullMoves:g.fullMoves,status:g.status};
    if(TERM.includes(g.status)&&!g.eloUpdated){if(g.isBot)finalizeBotGame(g,gid,S.user);else finalizeGame(g,gid,S.user);}
    const myC=g.white===S.user?'w':'b';
    if(S.premove?.from&&S.premove?.to&&g.turn===myC&&!TERM.includes(g.status)){
      const{from,to}=S.premove;S.premove=null;
      const mv=legals(S.gs.board,from[0],from[1],S.gs);
      if(mv.some(([mr,mc])=>mr===to[0]&&mc===to[1])){
        const pp=S.gs.board[from[0]][from[1]];
        if(pp?.toLowerCase()==='p'&&(to[0]===0||to[0]===7)){S.promo={from,to};S.sel=null;S.lMv=[];render();return;}
        execMove(from,to,null);return;
      }
    }
    if(S.screen==='game'&&!DS.on)render(); // skip render if user is mid-drag
  });
  unsubs.push(u);
}

/* ═══ BOARD HTML ═══ */
function boardHtml(gs,sel,lMv,premove,myC,readOnly=false){
  const flip=myC==='b';
  const rows=flip?[7,6,5,4,3,2,1,0]:[0,1,2,3,4,5,6,7];
  const cols=flip?[7,6,5,4,3,2,1,0]:[0,1,2,3,4,5,6,7];
  const ls=new Set(lMv.map(([r,c])=>`${r},${c}`));
  const pmF=premove?.from?`${premove.from[0]},${premove.from[1]}`:null;
  const pmT=premove?.to?`${premove.to[0]},${premove.to[1]}`:null;
  const inChkC=gs.status==='check'?gs.turn:null;
  let kp=null;if(inChkC){const K=inChkC==='w'?'K':'k';for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(gs.board[r][c]===K)kp=`${r},${c}`;}
  return`<div id="chboard" style="display:grid;grid-template-columns:repeat(8,1fr);width:100%;aspect-ratio:1;border-radius:3px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.6)">
  ${rows.map(r=>cols.map(c=>{
    const piece=gs.board[r][c],key=`${r},${c}`;
    const il=(r+c)%2===0;
    const isSel=sel&&sel[0]===r&&sel[1]===c;
    const isPmF=pmF===key,isPmT=pmT===key,isChk=kp===key,isLeg=ls.has(key);
    let bg=il?'#f0d9b5':'#b58863';
    if(isSel)bg=il?'#7fc97f':'#5a9a5a';
    if(isChk)bg='radial-gradient(ellipse at center,#ff4444 0%,#cc0000 30%,rgba(160,0,0,0) 90%)';
    if(isPmF||isPmT)bg=il?'#a7c5e0':'#7da0c0';
    const myC2=!readOnly&&piece?pc(piece):null;
    const canDrag=!readOnly&&myC2&&myC2===(S.gInfo?.white===S.user?'w':'b');
    const ptrDown=readOnly?'':canDrag?`onpointerdown="W.pdDown(event,${r},${c})"`:'';
    const click=readOnly?'':`onclick="W.sq(${r},${c})"`;
    const dimmed=DS.on&&DS.fr===r&&DS.fc===c;
    return`<div class="sq" ${click} ${ptrDown} style="background:${bg};${canDrag?'cursor:grab;':''}touch-action:none">
      ${isLeg&&!piece?`<div class="dot"></div>`:''}
      ${isLeg&&piece?`<div class="cap-ring"></div>`:''}
      ${piece?`<img src="${pi(piece)}" alt="" style="width:86%;height:86%;pointer-events:none;display:block;${dimmed?'opacity:.2;':''}">`:''}
    </div>`;
  }).join('')).join('')}
  </div>`;
}

/* ═══ POINTER DRAG HANDLERS ═══ */
W.pdDown=(e,r,c)=>{
  const{gs,gInfo,user}=S;
  if(!gs||!gInfo||TERM.includes(gs.status))return;
  const myC=gInfo.white===user?'w':'b',piece=gs.board[r][c];
  if(!piece||pc(piece)!==myC)return;
  e.preventDefault();e.stopPropagation();
  DS.on=true;DS.fr=r;DS.fc=c;
  const g=document.getElementById('drag-ghost');
  if(g){g.src=pi(piece);g.style.display='block';g.style.left=e.clientX+'px';g.style.top=e.clientY+'px';const sqSz=Math.floor(document.getElementById('chboard')?.getBoundingClientRect().width/8)||50;g.style.width=sqSz+'px';g.style.height=sqSz+'px';}
  if(gs.turn===myC){S.premove=null;S.sel=[r,c];S.lMv=legals(gs.board,r,c,gs);}
  else{S.premove={from:[r,c]};S.sel=null;S.lMv=[];}
  render();
};

W._mv=(fr,fc,tr,tc)=>{
  const{gs,gInfo,user}=S;
  if(!gs||!gInfo||TERM.includes(gs.status))return;
  const myC=gInfo.white===user?'w':'b';
  if(gs.turn!==myC){
    if(fr!==null&&fc!==null){const piece=gs.board[fr][fc];if(piece&&pc(piece)===myC&&premoveValid(piece,fr,fc,tr,tc)){S.premove={from:[fr,fc],to:[tr,tc]};render();}}
    return;
  }
  S.premove=null;
  if(fr===tr&&fc===tc){render();return;}
  const mv=legals(gs.board,fr,fc,gs);
  if(mv.some(([lr,lc])=>lr===tr&&lc===tc)){
    const pp=gs.board[fr][fc];
    if(pp?.toLowerCase()==='p'&&(tr===0||tr===7)){S.promo={from:[fr,fc],to:[tr,tc]};S.sel=null;S.lMv=[];render();return;}
    execMove([fr,fc],[tr,tc],null);S.sel=null;S.lMv=[];
  } else if(gs.board[tr][tc]&&pc(gs.board[tr][tc])===myC){
    S.sel=[tr,tc];S.lMv=legals(gs.board,tr,tc,gs);render();
  } else{S.sel=null;S.lMv=[];render();}
};

W.sq=(r,c)=>{
  if(DS.on)return;
  const{gs,gInfo,user,sel,lMv}=S;
  if(!gs||!gInfo||TERM.includes(gs.status))return;
  const myC=gInfo.white===user?'w':'b',piece=gs.board[r][c];
  if(gs.turn!==myC){
    if(!S.premove?.from){if(piece&&pc(piece)===myC){S.premove={from:[r,c]};render();}}
    else if(!S.premove.to){
      if(piece&&pc(piece)===myC){S.premove={from:[r,c]};render();}
      else{
        const pfr=S.premove.from,pp=gs.board[pfr[0]][pfr[1]];
        if(pp&&premoveValid(pp,pfr[0],pfr[1],r,c)){S.premove={from:pfr,to:[r,c]};render();}
        else{S.premove=null;render();}
      }
    }
    else{S.premove=null;render();}
    return;
  }
  S.premove=null;
  if(sel&&lMv.some(([lr,lc])=>lr===r&&lc===c)){
    const pp=gs.board[sel[0]][sel[1]];
    if(pp?.toLowerCase()==='p'&&(r===0||r===7)){S.promo={from:sel,to:[r,c]};S.sel=null;S.lMv=[];render();return;}
    execMove(sel,[r,c],null);S.sel=null;S.lMv=[];return;
  }
  if(piece&&pc(piece)===myC){S.sel=[r,c];S.lMv=legals(gs.board,r,c,gs);}
  else{S.sel=null;S.lMv=[];}
  render();
};
W.promo=p=>{if(!S.promo)return;execMove(S.promo.from,S.promo.to,p);S.promo=null;};

async function execMove(from,to,promo){
  const{gInfo,gs,user,gid}=S;if(!gInfo||!gs||!gid)return;
  const myC=gInfo.white===user?'w':'b';
  const el=Date.now()-gInfo.lastMoveTs;
  const nW=myC==='w'?Math.max(0,gInfo.whiteMs-el):gInfo.whiteMs;
  const nB=myC==='b'?Math.max(0,gInfo.blackMs-el):gInfo.blackMs;
  const ngs=applyMove(gs,from,to,promo);
  const ng={...gInfo,boardJson:JSON.stringify(ngs.board),turn:ngs.turn,castling:ngs.castling,enPassant:ngs.enPassant,fullMoves:ngs.fullMoves,status:ngs.status,whiteMs:nW,blackMs:nB,lastMoveTs:Date.now()};
  S.gs=ngs;S.gInfo=ng;await fSet(`games/${gid}`,ng);
  if(TERM.includes(ngs.status)&&!ng.eloUpdated){if(ng.isBot)finalizeBotGame(ng,gid,S.user);else finalizeGame(ng,gid,S.user);}
  render();
}
W.resign=async()=>{const{gInfo,gs,user,gid}=S;if(!gInfo||!gid)return;const st=gInfo.white===user?'resigned_white':'resigned_black';const upd={...gInfo,boardJson:JSON.stringify(gs.board),status:st};await fSet(`games/${gid}`,upd);S.gInfo={...gInfo,status:st};S.gs={...gs,status:st};finalizeGame(upd,gid,S.user);render();};
W.leave=()=>{unsub();startLobby();};

function gameHtml(){
  const{gs,gInfo,user,dispMs,sel,lMv,promo,premove}=S;
  if(!gs||!gInfo)return`<div style="display:flex;justify-content:center;align-items:center;height:100svh;color:#6b6a69">Connecting...</div>`;
  const myC=gInfo.white===user?'w':'b',fin=TERM.includes(gs.status);
  const oppC=myC==='w'?'b':'w';
  const oppN=myC==='w'?gInfo.black:gInfo.white,myN=myC==='w'?gInfo.white:gInfo.black;
  const oppMs=dispMs[oppC],myMs=dispMs[myC],oppA=gs.turn===oppC&&!fin,myA=gs.turn===myC&&!fin;
  const oppElo=S.allPlayers[oppN]?.elo||1000,myElo=S.allPlayers[myN]?.elo||1000;
  const sm=()=>({white_wins:'White wins — checkmate!',black_wins:'Black wins — checkmate!',draw_stalemate:'Draw — stalemate!',white_timeout:'Black wins — time!',black_timeout:'White wins — time!',resigned_white:'Black wins — resign!',resigned_black:'White wins — resign!',check:'Check!'}[gs.status]||(gs.turn==='w'?'White to move':'Black to move'));
  const clk=(n,elo,ms,act,me,id)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:${act?'#2a3a00':'#1f1e1d'};border-radius:6px;border:1px solid ${act?'#759900':'#2a2927'}"><div style="display:flex;align-items:center;gap:7px"><img src="${pi(me?(myC==='w'?'K':'k'):(myC==='w'?'k':'K'))}" style="width:20px;height:20px;opacity:.7"><span style="font-weight:600;font-size:.88rem;color:${act?'#a8c000':'#bab9b8'}">${esc(n)}${me?' (you)':''}</span><span style="font-size:.75rem;color:#c8a400">${elo}</span>${me&&premove?.to?`<span style="font-size:.7rem;color:#7da0c0">pre</span>`:''}</div><span id="${id}" style="font-size:${ms<15000?'1.45rem':'1.6rem'};font-weight:700;font-family:monospace;color:${ms<10000?'#cc4444':act?'#a8c000':'#f0ede8'}">${ft(ms)}</span></div>`;
  const promoHtml=promo?`<div style="position:fixed;inset:0;background:rgba(0,0,0,.9);display:flex;justify-content:center;align-items:center;z-index:200"><div style="background:#1f1e1d;border-radius:12px;padding:1.5rem;text-align:center;border:1px solid #2a2927"><p style="margin:0 0 1rem;color:#bab9b8;font-size:.9rem">Promotion:</p><div style="display:flex;gap:8px">${['q','r','b','n'].map(p=>`<button onclick="W.promo('${p}')" style="width:68px;height:68px;border-radius:8px;border:2px solid #3d3a36;background:#161512;cursor:pointer;padding:6px"><img src="${pi(myC==='w'?p.toUpperCase():p)}" style="width:100%;height:100%"></button>`).join('')}</div></div></div>`:'';
  const overHtml=fin?`<div style="position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;justify-content:center;align-items:center;z-index:100"><div style="background:#1f1e1d;border-radius:12px;padding:2rem;text-align:center;max-width:300px;margin:1rem;border:1px solid #3d3a36;box-shadow:0 8px 40px rgba(0,0,0,.8)"><div style="font-size:3rem;margin-bottom:1rem">${(['white_wins','black_timeout','resigned_black'].includes(gs.status))?'♔':(['black_wins','white_timeout','resigned_white'].includes(gs.status))?'♚':'🤝'}</div><h2 style="margin:0 0 8px;color:#f0ede8;font-size:1.1rem">${sm()}</h2><p style="color:#6b6a69;margin:0 0 1.5rem;font-size:.85rem">Game over</p><button onclick="W.leave()" class="btn-g" style="padding:.7rem 2rem;width:100%">← Back to Lobby</button></div></div>`:'';
  return`<div style="background:#161512;min-height:100svh;display:flex;flex-direction:column;padding:8px 10px;gap:6px;max-width:520px;margin:0 auto;box-sizing:border-box">
  <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0"><span style="color:${gs.status==='check'?'#c8a400':'#6b6a69'};font-weight:600;font-size:.82rem">${sm()}</span><div style="display:flex;gap:6px">${!fin?`<button onclick="W.resign()" style="padding:5px 12px;border-radius:5px;border:1px solid #882020;background:transparent;color:#cc4444;cursor:pointer;font-size:.78rem">Resign</button>`:''}${fin?`<button onclick="W.leave()" class="btn-g" style="padding:5px 12px;font-size:.8rem">← Lobby</button>`:''}</div></div>
  ${clk(oppN,oppElo,oppMs,oppA,false,'co')}
  <div style="width:min(calc(100vw - 20px),calc(100svh - 210px));aspect-ratio:1;margin:0 auto;flex-shrink:0">${boardHtml(gs,sel,lMv,premove,myC,false)}</div>
  ${clk(myN,myElo,myMs,myA,true,'cm')}
</div>${promoHtml}${overHtml}`;
}

/* ═══ SPECTATE ═══ */
W.spectate=async gid=>{const g=await fGet(`games/${gid}`);if(!g)return;S.specGid=gid;S.specGInfo=g;S.specGs={board:JSON.parse(g.boardJson),turn:g.turn,castling:g.castling,enPassant:g.enPassant||null,fullMoves:g.fullMoves,status:g.status};S.specDispMs={w:g.whiteMs,b:g.blackMs};S.screen='spectate';render();const u=fOn(`games/${gid}`,upd=>{if(!upd)return;S.specGInfo=upd;S.specGs={board:JSON.parse(upd.boardJson),turn:upd.turn,castling:upd.castling,enPassant:upd.enPassant||null,fullMoves:upd.fullMoves,status:upd.status};if(S.screen==='spectate')render();});unsubs.push(u);};
W.leaveSpec=()=>{unsub();startLobby();};
function spectateHtml(){
  const{specGs:gs,specGInfo:g,specDispMs:dMs}=S;if(!gs||!g)return`<div style="display:flex;justify-content:center;align-items:center;height:100svh;color:#6b6a69">Loading...</div>`;
  const fin=TERM.includes(gs.status),sm=()=>({white_wins:'White wins!',black_wins:'Black wins!',draw_stalemate:'Draw!',check:'Check!'}[gs.status]||(gs.turn==='w'?'White to move':'Black to move'));
  const wE=S.allPlayers[g.white]?.elo||1000,bE=S.allPlayers[g.black]?.elo||1000;
  const clk=(n,elo,ms,act,id)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:${act?'#2a3a00':'#1f1e1d'};border-radius:6px;border:1px solid ${act?'#759900':'#2a2927'}"><div style="display:flex;align-items:center;gap:8px"><span style="font-weight:600;font-size:.88rem;color:${act?'#a8c000':'#bab9b8'}">${esc(n)}</span><span style="font-size:.75rem;color:#c8a400">${elo}</span></div><span id="${id}" style="font-size:1.6rem;font-weight:700;font-family:monospace;color:${ms<10000?'#cc4444':act?'#a8c000':'#f0ede8'}">${ft(ms)}</span></div>`;
  return`<div style="background:#161512;min-height:100svh;display:flex;flex-direction:column;padding:8px 10px;gap:6px;max-width:520px;margin:0 auto;box-sizing:border-box"><div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0"><span style="color:#6b6a69;font-weight:600;font-size:.82rem">👁 Watching — ${sm()}</span><button onclick="W.leaveSpec()" class="btn-o" style="padding:5px 12px;font-size:.78rem">← Lobby</button></div>
  ${clk(g.black,bE,dMs.b,gs.turn==='b'&&!fin,'sco')}
  <div style="width:min(calc(100vw - 20px),calc(100svh - 210px));aspect-ratio:1;margin:0 auto;flex-shrink:0">${boardHtml(gs,null,[],null,'w',true)}</div>
  ${clk(g.white,wE,dMs.w,gs.turn==='w'&&!fin,'scw')}</div>`;
}

/* ═══ CLOCK ═══ */
clearInterval(clockId);
clockId=setInterval(()=>{
  const g=S.gInfo;
  if(g&&!TERM.includes(g.status)){
    const el=Date.now()-g.lastMoveTs;
    S.dispMs={w:g.turn==='w'?Math.max(0,g.whiteMs-el):g.whiteMs,b:g.turn==='b'?Math.max(0,g.blackMs-el):g.blackMs};
    if(g.turn==='w'&&el>g.whiteMs){const u={...g,status:'white_timeout'};fSet(`games/${S.gid}`,u);S.gInfo=u;S.gs={...S.gs,status:'white_timeout'};if(S.screen==='game')render();return;}
    if(g.turn==='b'&&el>g.blackMs){const u={...g,status:'black_timeout'};fSet(`games/${S.gid}`,u);S.gInfo=u;S.gs={...S.gs,status:'black_timeout'};if(S.screen==='game')render();return;}
  }else if(g)S.dispMs={w:g.whiteMs,b:g.blackMs};
  if(S.screen==='game'){const myC=S.user&&g?.white===S.user?'w':'b';const cm=document.getElementById('cm'),co=document.getElementById('co');if(cm)cm.textContent=ft(S.dispMs[myC]);if(co)co.textContent=ft(S.dispMs[myC==='w'?'b':'w']);}
  const sg=S.specGInfo;
  if(sg&&S.screen==='spectate'&&!TERM.includes(sg.status)){const el=Date.now()-sg.lastMoveTs;S.specDispMs={w:sg.turn==='w'?Math.max(0,sg.whiteMs-el):sg.whiteMs,b:sg.turn==='b'?Math.max(0,sg.blackMs-el):sg.blackMs};const sw=document.getElementById('scw'),sb=document.getElementById('sco');if(sw)sw.textContent=ft(S.specDispMs.w);if(sb)sb.textContent=ft(S.specDispMs.b);}
},100);

/* ═══ INIT ═══ */
initDrag();
purgeLegacySession();
render();
// Firebase restores the session itself; this fires once on load and on every sign-in/out.
onAuthStateChanged(auth,u=>{if(regInProgress)return;resolveUser(u);});
