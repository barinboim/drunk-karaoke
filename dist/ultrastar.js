// Tolerant UltraStar reader. Repairs real-world charts instead of rejecting them.
import {splitSyllables} from './engine.js';
const VOWEL=/[аеёиоуыэюяaeiouy]/i;
const CONFUSABLE={a:'а',e:'е',o:'о',p:'р',c:'с',y:'у',x:'х',k:'к',A:'А',B:'В',C:'С',E:'Е',H:'Н',K:'К',M:'М',O:'О',P:'Р',T:'Т',X:'Х'};
const languageCode=value=>{
  const text=String(value||'').toLowerCase();
  if(/fran|french|français|francais/.test(text))return 'fr';
  if(/germ|deutsch/.test(text))return 'de';
  if(/engl|english/.test(text))return 'en';
  if(/rus|рус/.test(text))return 'ru';
  return '';
};
// Charts typed on mixed keyboards hide Latin look-alikes inside Cyrillic words.
const healLatin=value=>/[а-яё]/i.test(value)?value.replace(/[a-zA-Z]/g,c=>CONFUSABLE[c]??c):value;
const vowels=value=>(value.match(/[аеёиоуыэюя]/gi)||[]).length;

function readRows(text) {
  const headers={},players=new Map();
  let player=1,offset=0,rows=[],current=[];
  const flush=()=>{if(!current.length)return;if(!players.has(player))players.set(player,[]);players.get(player).push(current);current=[];};
  const push=note=>{if(!players.has(player))players.set(player,[]);current.push(note);};
  for(const raw of text.replace(/^﻿/,'').split(/\r?\n/)) {
    // Trailing spaces are meaningful: in many charts they are the word boundary.
    const row=raw.replace(/[\r\n]+$/,'');
    if(!row.trim())continue;
    if(row.startsWith('#')){const split=row.indexOf(':');if(split>0)headers[row.slice(1,split).toUpperCase().trim()]=row.slice(split+1).trim();continue;}
    if(/^P\s*\d/.test(row)){flush();player=Number(row.replace(/^P\s*/,''))||1;offset=0;continue;}
    if(row.trim()==='E'||row.trim()==='e')break;
    if(row.startsWith('-')){
      flush();
      const jump=row.slice(1).trim().split(/\s+/).map(Number).filter(Number.isFinite);
      if(headers.RELATIVE?.toUpperCase()==='YES'&&jump.length)offset+=jump.length>1?jump[1]:jump[0];
      continue;
    }
    if(/^B\s+-?\d/.test(row)){ // tempo change: recorded so timing stays honest if a chart ever uses one
      const [,beat,value]=/^B\s+(-?\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)/.exec(row)||[];
      if(beat!==undefined)rows.push({tempo:Number(String(beat).replace(',','.'))+offset,bpm:Number(String(value).replace(',','.'))});
      continue;
    }
    const match=/^([:*FRG]) (-?\d+) (-?\d+) (-?\d+) ?(.*)$/.exec(row);
    if(!match)continue; // unknown row: skipped rather than fatal, charts carry stray notes
    const length=Number(match[3]);
    const text_=healLatin(match[5]);
    if(!text_.trim()&&!/^\s/.test(match[5]))continue;
    push({beat:Number(match[2])+offset,length:Math.max(1,length),pitch:Number(match[4]),text:text_,
      free:match[1]==='F',golden:match[1]==='*'});
  }
  flush();
  return {headers,players,tempos:rows};
}

// Word boundaries are marked by a leading space, but a good share of real charts puts the
// space at the END of the previous syllable instead. Left as is, a whole line glues into one
// word and every stress in it is lost. Detect the convention once and normalise to leading.
function normaliseSpacing(players) {
  const notes=[...players.values()].flat(2);
  const leading=notes.filter(n=>/^\s/.test(n.text)).length;
  const trailing=notes.filter(n=>/\s$/.test(n.text)).length;
  if(trailing<=leading)return;
  for(const blocks of players.values())
    for(const block of blocks)
      for(let i=block.length-1;i>0;i--){
        if(!/\s$/.test(block[i-1].text))continue;
        block[i-1].text=block[i-1].text.replace(/\s+$/,'');
        if(!/^\s/.test(block[i].text))block[i].text=' '+block[i].text;
      }
}

// Распев. Разметка тянет одну гласную тремя способами: знаком («бо-|о-|ой»,
// «ни|~и|~ит»), повтором буквы внутри ноты («реееее») или нотами-продолжениями
// из той же гласной («за|реее|еее|еее», «Ууууу|ууу»). Всё это один слог: если
// считать каждую букву слогом, движок ставит на одну протяжную «е» скороговорку
// из одиннадцати слогов. Одиночный повтор без знака почти всегда настоящий слог
// («Рос|си|и», «е|е» — её, «хо|ро|ше|е»), его не трогаем. Замер по 418 чартам:
// ~9 000 нот «~», 358 продолжений той же гласной, 32 ноты с тройным повтором.
const RU_VOWEL='аеёиоуыэюя';
const HELD_RUN=new RegExp(`([${RU_VOWEL}])\\1{2,}`,'gi');
const collapseRuns=text=>text.replace(HELD_RUN,'$1');
const partsOf=note=>note.parts||[{beat:note.beat,length:note.length,pitch:note.pitch,golden:note.golden}];
const extend=(head,note,sung)=>({...head,text:head.text+note.text,sung,
  length:note.beat+note.length-head.beat,golden:head.golden||note.golden,parts:[...partsOf(head),...partsOf(note)]});
const sungOf=note=>note.sung??collapseRuns(note.text.replace(/~/g,''));

// «~» и «-» без гласной продолжают предыдущий слог (распев или хвост «-м»),
// а не приклеиваются к следующему: иначе следующий слог начинается раньше времени.
function attachTails(notes) {
  const out=[];
  for(const note of notes) {
    const head=out.at(-1);
    if(head&&!VOWEL.test(note.text)&&/^[~\-]/.test(note.text)){
      out[out.length-1]=extend(head,note,sungOf(head)+note.text.replace(/^[~\-]+/,'').replace(/~/g,''));
      continue;
    }
    out.push(note);
  }
  return out;
}

function foldMelisma(slots) {
  const out=[];
  for(let i=0;i<slots.length;i++) {
    let head=slots[i];
    const end=/([аеёиоуыэюя])\1*$/.exec(head.text.toLowerCase().replace(/[~\-\s]+$/,''));
    if(!end){out.push(head);continue;}
    const vowel=end[1],chain=[],rests=[];
    let total=end[0].length;
    for(let j=i+1;j<slots.length;j++) {
      const text=slots[j].text;
      if(/^\s/.test(text))break;
      const match=new RegExp(`^(${vowel}+)([^${RU_VOWEL}]*)$`).exec(text.toLowerCase().replace(/^[~\-]+/,''));
      if(!match)break;
      chain.push(slots[j]);rests.push(match[2]);total+=match[1].length;
      if(/[а-яё]/.test(match[2]))break;          // согласная закрыла слог: «лю|бо|о|овь»
    }
    let take=chain.length;
    if(total<3){                                  // одиночный повтор — только со знаком
      take=0;
      for(const [k,note] of chain.entries()){
        const before=k?chain[k-1].text:head.text;
        if(!/[~\-]\s*$/.test(before)&&!/^[~\-]/.test(note.text))break;
        take++;
      }
    }
    if(!take){out.push(head);continue;}
    let sung=sungOf(head).replace(/[~\-]+(\s*)$/,'$1');
    for(let k=0;k<take;k++){
      const rest=rests[k].replace(/[~\-]/g,'');
      // Хвост слога переносит свою часть пробела: «ре |еее» на границе слова.
      sung+=rest;
      head=extend(head,chain[k],sung);
    }
    out.push(head);
    i+=take;
  }
  return out;
}

// Слог — одна гласная; повтор гласной внутри ноты («реееее») — всё ещё один слог.
function splitNote(note) {
  const lead=note.text.match(/^\s*/)[0],body=note.text.slice(lead.length);
  const masked=body.replace(HELD_RUN,(run,first)=>first+'ъ'.repeat(run.length-1));
  const parts=[];let from=0;
  for(const part of splitSyllables(masked)){parts.push(body.slice(from,from+part.length));from+=part.length;}
  return {lead,parts};
}

// One note may carry several vowels; karaoke needs one slot per syllable.
function toSlots(notes,language='ru') {
  const merged=[];let prefix=null;
  for(const note of attachTails(notes)) {
    if(!VOWEL.test(note.text)){
      prefix=prefix?{...prefix,text:prefix.text+note.text,length:note.beat+note.length-prefix.beat}:{...note};
      continue;
    }
    merged.push(prefix?{...note,beat:prefix.beat,length:note.beat+note.length-prefix.beat,text:prefix.text+note.text,
      sung:note.sung===undefined?undefined:prefix.text+note.sung}:{...note});
    prefix=null;
  }
  if(prefix&&merged.length){const last=merged.at(-1);last.text+=prefix.text;if(last.sung!==undefined)last.sung+=prefix.text;last.length=Math.max(last.length,prefix.beat+prefix.length-last.beat);}
  const slots=[];
  for(const note of merged) {
    const count=language==='ru'?vowels(collapseRuns(note.text)):1;
    if(count<2){slots.push(note);continue;}
    const {lead,parts}=splitNote(note),weights=parts.map(p=>Math.max(1,p.length)),total=weights.reduce((a,b)=>a+b,0);
    let used=0;
    parts.forEach((part,i)=>{
      const span=i===parts.length-1?note.length-used:Math.max(1,Math.round(note.length*weights[i]/total));
      const {parts:_,sung:__,...plain}=note;
      slots.push({...plain,beat:note.beat+used,length:Math.max(1,span),text:(i?'':lead)+part});
      used+=span;
    });
  }
  return language==='ru'?foldMelisma(slots):slots;
}

// original — как в разметке, для подписи; sung — что звучит, без распевов:
// по нему движок считает ударения и узнаёт повторы припева.
const joinText=parts=>parts.join('').replace(/\s+/g,' ').trim();
const texts=notes=>({original:joinText(notes.map(n=>n.text)),sung:joinText(notes.map(n=>n.sung??n.text))});

export function parseUltraStar(text,{voice='merge'}={}) {
  const {headers,players,tempos}=readRows(text);
  normaliseSpacing(players);
  const bpm=Number((headers.BPM||'').replace(',','.'));
  const gap=Number((headers.GAP||'0').replace(',','.'))/1000;
  if(!Number.isFinite(bpm)||bpm<=0)throw Error('В файле нет корректного #BPM.');
  if(!Number.isFinite(gap))throw Error('В файле нет корректного #GAP.');
  if(tempos.length)throw Error('Файл меняет темп по ходу песни — такая разметка пока не поддерживается.');
  const quarter=60/(bpm*4),at=beat=>gap+beat*quarter;
  const body=[...players.values()].flat(2).map(n=>n.text).join('');
  // Английская разметка размечена по слогам сразу, поэтому ноты не дробим:
  // в написании гласных больше, чем слогов («through» — одна нота, три гласные буквы).
  const language=languageCode(headers.LANGUAGE)||((body.match(/[a-z]/gi)||[]).length>(body.match(/[а-яё]/gi)||[]).length?'en':'ru');
  const voices=[...players.entries()].sort((a,b)=>a[0]-b[0]);
  if(!voices.length)throw Error('В файле нет нот.');
  const wanted=voice==='merge'?voices:voices.filter(([id])=>id===Number(voice)||voices.length===1);
  const lines=[];
  for(const [id,blocks] of (wanted.length?wanted:voices)) {
    for(const block of blocks) {
      const slots=toSlots(block,language);
      if(!slots.length)continue;
      const notes=slots.map(slot=>({text:slot.text,sung:sungOf(slot),beat:slot.beat,length:slot.length,pitch:slot.pitch,
        golden:Boolean(slot.golden),free:Boolean(slot.free),start:at(slot.beat),end:at(slot.beat+slot.length),
        // распев держит мелодию внутри слога: оценка пения сверяет каждый его кусок
        ...(slot.parts?{parts:slot.parts.map(part=>({pitch:part.pitch,golden:Boolean(part.golden),
          start:at(part.beat),end:at(part.beat+part.length)}))}:{})}));
      notes.sort((a,b)=>a.start-b.start||a.end-b.end);
      for(let i=1;i<notes.length;i++)if(notes[i].start<notes[i-1].end)notes[i-1].end=notes[i].start; // clip overlaps rather than fail
      lines.push({voice:id,notes,start:notes[0].start,end:notes.at(-1).end,...texts(notes)});
    }
  }
  if(!lines.length)throw Error('В файле нет вокальных строк с гласными.');
  lines.sort((a,b)=>a.start-b.start||a.voice-b.voice);
  const kept=[];
  for(const line of lines) { // duet parts that double each other collapse into one singable track
    const previous=kept.at(-1);
    if(previous&&line.start<previous.end-1e-6&&Math.min(line.end,previous.end)-line.start>(line.end-line.start)*.5)continue;
    if(previous&&line.start<previous.end)line.notes=line.notes.filter(n=>n.start>=previous.end-1e-6);
    if(!line.notes.length)continue;
    line.start=line.notes[0].start;Object.assign(line,texts(line.notes));
    if(!VOWEL.test(line.original))continue;
    kept.push(line);
  }
  // Разметка нередко сваливает несколько музыкальных фраз в одну строку: короткое
  // восклицание тонет в стене текста. Если внутри строки стоит сильный знак и после
  // него настоящая пауза — это граница фразы, и строку надо разделить.
  const PHRASE_GAP=0.25;
  // Вторая примета конца фразы — музыкальная, без всяких знаков: долгий распев,
  // а за ним тишина. Так устроен, например, зачин «На заре». Пороги подобраны
  // замером по всей коллекции: связка «распев плюс пауза» даёт 27 разрывов на
  // 6766 строк, тогда как одна только пауза разносит разметку на 253 куска.
  const HELD=1.5, HELD_GAP=0.5;
  const endsPhrase=(note,next)=>{
    const gap=next.start-note.end;
    if(/[!?.…]\s*$/.test(note.text)&&gap>=PHRASE_GAP)return true;
    return note.end-note.start>=HELD&&gap>=HELD_GAP;
  };
  const split=[];
  for(const line of kept){
    let from=0;
    for(let i=0;i<line.notes.length-1;i++){
      if(!endsPhrase(line.notes[i],line.notes[i+1]))continue;
      const part=line.notes.slice(from,i+1);
      if(part.length){split.push(part);from=i+1;}
    }
    const tail=line.notes.slice(from);
    if(tail.length)split.push(tail);
  }
  const phrases=split.map(notes=>({
    notes,
    ...texts(notes),
    start:notes[0].start,end:notes.at(-1).end,
    voice:notes[0].voice??1,
  })).filter(line=>VOWEL.test(line.original));
  kept.length=0;kept.push(...phrases);

  if(!kept.length)throw Error('В файле нет вокальных строк с гласными.');
  return {
    title:headers.TITLE||'Без названия',artist:headers.ARTIST||'Неизвестный исполнитель',
    bpm,gap,language,lines:kept,duration:kept.at(-1).end+3,
    media:{audio:headers.MP3||headers.AUDIO||'',instrumental:headers.INSTRUMENTAL||'',cover:headers.COVER||'',background:headers.BACKGROUND||''},
    voices:voices.length,
  };
}
