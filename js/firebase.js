import{initializeApp}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import{getDatabase,ref,set,get,push,onValue,query,limitToLast,update,runTransaction}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import{getAuth,createUserWithEmailAndPassword,signInWithEmailAndPassword,sendPasswordResetEmail,onAuthStateChanged,signOut,deleteUser}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
const FB={apiKey:"AIzaSyA9tbhMghPaZl9oYIZq8XB9gn_dwJpE9p4",authDomain:"sah-handicap-timp.firebaseapp.com",databaseURL:"https://sah-handicap-timp-default-rtdb.europe-west1.firebasedatabase.app",projectId:"sah-handicap-timp",storageBucket:"sah-handicap-timp.firebasestorage.app",messagingSenderId:"743890211052",appId:"1:743890211052:web:0fceec9669dcb4fe2855c9"};
const fbApp=initializeApp(FB);
const db=getDatabase(fbApp);
const auth=getAuth(fbApp);
const R=p=>ref(db,p);
const fSet=(p,v)=>set(R(p),v);
const fGet=async p=>{try{const s=await get(R(p));return s.exists()?s.val():null}catch{return null}};
const fOn=(p,cb)=>onValue(R(p),s=>cb(s.exists()?s.val():null));
const fPush=(p,v)=>push(R(p),v);
const fUpdate=(p,v)=>update(R(p),v);
/* Only the tail of a list — an ELO history can run to thousands of entries once
   bots play each other, and the profile chart never needs more than the end. */
const fGetLast=async(p,n)=>{try{const s=await get(query(R(p),limitToLast(n)));return s.exists()?s.val():null}catch{return null}};

/* Marks a flag as taken, atomically. Returns true to exactly one caller even if
   several clients race for it — the basis for "whoever is still connected
   settles this game, and only once". */
const fClaim=async p=>{
  try{const res=await runTransaction(R(p),cur=>cur?undefined:true);return!!res.committed;}
  catch{return false;}
};

/* Firebase handles, shared by the app and (later) the bot worker. */
export{fbApp,db,auth,R,fSet,fGet,fOn,fPush,fUpdate,fGetLast,fClaim};
export{createUserWithEmailAndPassword,signInWithEmailAndPassword,sendPasswordResetEmail,onAuthStateChanged,signOut,deleteUser};
