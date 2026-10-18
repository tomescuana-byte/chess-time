/* Copies the pure modules from the web app into functions/shared/ before every
   deploy. Only the functions folder is uploaded, so the server cannot import
   ../js directly — and keeping a second hand-written copy of the chess rules is
   exactly how the two would quietly drift apart.
   Paths resolve from this file, so it does not matter where it is run from. */
import{copyFileSync,mkdirSync}from'node:fs';
import{dirname,join}from'node:path';
import{fileURLToPath}from'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const from=join(here,'..','js');
const to=join(here,'shared');
const files=['engine.js','rating.js','bot-roster.js'];

mkdirSync(to,{recursive:true});
for(const f of files){
  copyFileSync(join(from,f),join(to,f));
  console.log(`copied ${f}`);
}
