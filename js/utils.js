const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fs=s=>{if(s<=0)return'0:00';const m=Math.floor(s/60),sc=s%60;return`${m}:${sc.toString().padStart(2,'0')}`;};
function ft(ms){if(ms<=0)return'0.0';if(ms<15000){const s=Math.floor(ms/1000),d=Math.floor((ms%1000)/100);return`${s}.${d}`;}const s=Math.ceil(ms/1000),m=Math.floor(s/60);return`${m}:${(s%60).toString().padStart(2,'0')}`;}
const timeAgo=ts=>{const d=Math.floor((Date.now()-ts)/1000);if(d<60)return`${d}s`;if(d<3600)return`${Math.floor(d/60)}m`;if(d<86400)return`${Math.floor(d/3600)}h`;return`${Math.floor(d/86400)}d`;};
const h2hKey=(a,b)=>[a,b].sort().join('__');

export{esc,fs,ft,timeAgo,h2hKey};
