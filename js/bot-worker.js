/* The bot's search, off the main thread so the clock never stutters.
   It imports the same modules as everything else — there is no second copy of
   the chess rules here, which is how the browser bots and the ladder bots stay
   the same players. */
import{bestBotMove}from'./bot-roster.js';

self.onmessage=e=>{
  const{gs,color,depth}=e.data||{};
  try{
    self.postMessage({move:bestBotMove(gs,color,depth)});
  }catch(err){
    self.postMessage({move:null,error:String(err)});
  }
};
