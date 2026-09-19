import {buildCorpus,analyzeSong,generate,parseAccents,withAccents,detectLanguage} from './engine.js';

// Русские ударения: OpenRussian плюс общее дополнение проекта.
const baseReady=Promise.all([
  fetch('data/dictionary.json').then(r=>{if(!r.ok)throw Error('Локальный словарь не найден');return r.json();}),
  fetch('data/accents.txt').then(r=>r.ok?r.text():'').catch(()=>''),
]).then(([base,extra])=>withAccents(new Map(Object.entries(base)),parseAccents(extra)));

// У каждого датасета свой файл ударений — сборщики корпусов не правят общий.
const extraCache=new Map();
// CMUdict весит 3.6 МБ и нужен только англоязычным песням, поэтому тянем его лениво.
let englishReady=null;
const english=()=>englishReady??=fetch('data/cmudict.json')
  .then(r=>{if(!r.ok)throw Error('Словарь произношения не найден');return r.json();})
  .then(data=>new Map(Object.entries(data)));

async function lexiconFor(url,needEnglish){
  const base=await baseReady;
  let ru=base;
  if(url){
    if(!extraCache.has(url))
      extraCache.set(url,fetch(url).then(r=>r.ok?r.text():'').catch(()=>'').then(parseAccents));
    ru=withAccents(base,await extraCache.get(url));
  }
  return {ru,en:needEnglish?await english():null};
}

let state;
self.onmessage=async({data})=>{
  try{
    const song=data.song||state?.song;
    const text=data.text!==undefined?data.text:state?.text;
    // Только seed поменялся? Переиспользуем индекс и разбор песни, не собираем заново.
    const fresh=Boolean(data.song||data.text!==undefined);
    if(fresh){
      if(!song||text===undefined)throw Error('Сначала выбери песню и корпус');
      const needEnglish=song.language==='en'||(text!==''&&detectLanguage(text)==='en');
      const dictionary=await lexiconFor(data.accents,needEnglish);
      const lengths=[...new Set(song.lines.map(line=>line.notes.length))];
      state={song,text,words:dictionary.ru.size,
        corpus:buildCorpus(text,dictionary,{lengths,mode:data.mode}),
        analysis:analyzeSong(song,dictionary)};
    }
    if(!state)throw Error('Сначала выбери песню и корпус');
    const result=generate(state.song,state.corpus,data.seed,state.analysis);
    self.postMessage({id:data.id,version:result.lines,seed:data.seed,stats:{
      ...state.corpus.stats,
      songUnknownWords:[...new Set(state.analysis.templates.flatMap(t=>t.unknownWords))],
      groups:state.analysis.groups.length,lines:state.song.lines.length,
      language:state.analysis.language,
      dictionarySize:state.words,
    }});
  }catch(error){self.postMessage({id:data.id,error:error.message});}
};
