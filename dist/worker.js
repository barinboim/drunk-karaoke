import {buildCorpus,analyzeSong,generate} from './engine.js';
import {parseAccents,withAccents} from './engine.js';
const dictionaryReady=Promise.all([
  fetch('data/dictionary.json').then(r=>{if(!r.ok)throw Error('Локальный словарь не найден');return r.json();}),
  fetch('data/accents.txt').then(r=>r.ok?r.text():'').catch(()=>''),
]).then(([base,extra])=>withAccents(new Map(Object.entries(base)),parseAccents(extra)));
let state;
self.onmessage=async({data})=>{
  try{
    const dictionary=await dictionaryFor(data.accents);
    // Only the seed changed? Reuse the index and the song analysis instead of rebuilding them.
    const fresh=Boolean(data.song||data.text!==undefined);
    if(fresh) {
      const song=data.song||state?.song,text=data.text!==undefined?data.text:state?.text;
      if(!song||text===undefined)throw Error('Сначала выбери песню и корпус');
      const lengths=[...new Set(song.lines.map(line=>line.notes.length))];
      state={song,text,corpus:buildCorpus(text,dictionary,{lengths,mode:data.mode}),analysis:analyzeSong(song,dictionary)};
    }
    if(!state)throw Error('Сначала выбери песню и корпус');
    const result=generate(state.song,state.corpus,data.seed,state.analysis);
    self.postMessage({id:data.id,version:result.lines,seed:data.seed,stats:{
      ...state.corpus.stats,
      songUnknownWords:[...new Set(state.analysis.templates.flatMap(t=>t.unknownWords))],
      groups:state.analysis.groups.length,lines:state.song.lines.length,
      dictionarySize:dictionary.size,
    }});
  }catch(error){self.postMessage({id:data.id,error:error.message});}
};
