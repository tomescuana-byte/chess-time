/* Starts the same Stockfish build the browser uses, inside a Cloud Function.
   The browser gets it as a Worker; here it is loaded directly, since there is
   no main thread to keep free. */
import{createRequire}from'node:module';
import{dirname,join}from'node:path';
import{fileURLToPath}from'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
const JS=join(here,'sf','stockfish.cjs');
const WASM=join(here,'sf','stockfish.wasm');

/* Resolves to {send, subscribe} — the two things sf-driver needs. */
export async function startStockfish(){
  const INIT=require(JS);
  const subs=[];
  const mod={
    locateFile:f=>f.includes('.wasm')?WASM:JS,
    listener:l=>subs.forEach(fn=>fn(l))
  };
  const factory=INIT();
  await factory(mod);
  // Emscripten can still be warming up after that promise settles.
  while(mod._isReady&&!mod._isReady())await new Promise(r=>setTimeout(r,10));
  return{
    send:c=>setImmediate(()=>mod.ccall('command',null,['string'],[c],{async:/^go\b/.test(c)})),
    subscribe:fn=>subs.push(fn)
  };
}
