// Tolerant UltraStar reader. Repairs real-world charts instead of rejecting them.
import {splitSyllables} from './engine.js';
const VOWEL=/[аеёиоуыэюяaeiouy]/i;
const CONFUSABLE={a:'а',e:'е',o:'о',p:'р',c:'с',y:'у',x:'х',k:'к',A:'А',B:'В',C:'С',E:'Е',H:'Н',K:'К',M:'М',O:'О',P:'Р',T:'Т',X:'Х'};
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

// One note may carry several vowels; karaoke needs one slot per syllable.
function toSlots(notes,language='ru') {
  const merged=[];let prefix=null;
  for(const note of notes) {
    if(!VOWEL.test(note.text)){
      prefix=prefix?{...prefix,text:prefix.text+note.text,length:note.beat+note.length-prefix.beat}:{...note};
      continue;
    }
    merged.push(prefix?{...note,beat:prefix.beat,length:note.beat+note.length-prefix.beat,text:prefix.text+note.text}:{...note});
    prefix=null;
  }
  if(prefix&&merged.length){const last=merged.at(-1);last.text+=prefix.text;last.length=Math.max(last.length,prefix.beat+prefix.length-last.beat);}
  const slots=[];
  for(const note of merged) {
    const count=language==='en'?1:vowels(note.text);
    if(count<2){slots.push(note);continue;}
    const lead=note.text.match(/^\s*/)[0],body=note.text.slice(lead.length);
    const parts=splitSyllables(body),weights=parts.map(p=>Math.max(1,p.length)),total=weights.reduce((a,b)=>a+b,0);
    let used=0;
    parts.forEach((part,i)=>{
      const span=i===parts.length-1?note.length-used:Math.max(1,Math.round(note.length*weights[i]/total));
      slots.push({...note,beat:note.beat+used,length:Math.max(1,span),text:(i?'':lead)+part});
      used+=span;
    });
  }
  return slots;
}

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
  const language=(body.match(/[a-z]/gi)||[]).length>(body.match(/[а-яё]/gi)||[]).length?'en':'ru';
  const voices=[...players.entries()].sort((a,b)=>a[0]-b[0]);
  if(!voices.length)throw Error('В файле нет нот.');
  const wanted=voice==='merge'?voices:voices.filter(([id])=>id===Number(voice)||voices.length===1);
  const lines=[];
  for(const [id,blocks] of (wanted.length?wanted:voices)) {
    for(const block of blocks) {
      const slots=toSlots(block,language);
      if(!slots.length)continue;
      const notes=slots.map(slot=>({text:slot.text,beat:slot.beat,length:slot.length,pitch:slot.pitch,
        golden:Boolean(slot.golden),free:Boolean(slot.free),start:at(slot.beat),end:at(slot.beat+slot.length)}));
      notes.sort((a,b)=>a.start-b.start||a.end-b.end);
      for(let i=1;i<notes.length;i++)if(notes[i].start<notes[i-1].end)notes[i-1].end=notes[i].start; // clip overlaps rather than fail
      lines.push({voice:id,notes,original:notes.map(n=>n.text).join('').replace(/\s+/g,' ').trim(),start:notes[0].start,end:notes.at(-1).end});
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
    line.start=line.notes[0].start;line.original=line.notes.map(n=>n.text).join('').replace(/\s+/g,' ').trim();
    if(!VOWEL.test(line.original))continue;
    kept.push(line);
  }
  // Разметка нередко сваливает несколько музыкальных фраз в одну строку: короткое
  // восклицание тонет в стене текста. Если внутри строки стоит сильный знак и после
  // него настоящая пауза — это граница фразы, и строку надо разделить.
  const PHRASE_GAP=0.25;
  const split=[];
  for(const line of kept){
    let from=0;
    for(let i=0;i<line.notes.length-1;i++){
      if(!/[!?.…]\s*$/.test(line.notes[i].text))continue;
      if(line.notes[i+1].start-line.notes[i].end<PHRASE_GAP)continue;
      const part=line.notes.slice(from,i+1);
      if(part.length){split.push(part);from=i+1;}
    }
    const tail=line.notes.slice(from);
    if(tail.length)split.push(tail);
  }
  const phrases=split.map(notes=>({
    notes,
    original:notes.map(note=>note.text).join('').replace(/\s+/g,' ').trim(),
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
