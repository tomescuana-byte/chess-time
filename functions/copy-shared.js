/* Copies the pure modules from the web app into functions/shared/ before every
   deploy. Only the functions folder is uploaded, so the server cannot import
   ../js directly — and keeping a second hand-written copy of the chess rules is
   exactly how the two would quietly drift apart.
   Paths resolve from this file, so it does not matter where it is run from. */
import{copyFileSync,mkdirSync}from'node:fs';
import{dirname,join}from'node:path';
import{fileURLToPath}from'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const to=join(here,'shared');
mkdirSync(to,{recursive:true});
for(const f of ['engine.js','rating.js','bot-roster.js','sf-driver.js']){
  copyFileSync(join(here,'..','js',f),join(to,f));
  console.log(`copied ${f}`);
}

/* The engine itself, so the ladder plays with exactly the build the browser uses.
   It arrives as .cjs: this package is ESM, and the Stockfish build is CommonJS,
   so under a .js name Node would refuse to require it. */
const sfTo=join(here,'sf');
mkdirSync(sfTo,{recursive:true});
copyFileSync(join(here,'..','sf','stockfish-17.1-lite-single-03e3232.js'),join(sfTo,'stockfish.cjs'));
copyFileSync(join(here,'..','sf','stockfish-17.1-lite-single-03e3232.wasm'),join(sfTo,'stockfish.wasm'));
console.log('copied stockfish.cjs + stockfish.wasm');
