// Corpus sanity check: stress coverage, record lengths, and how many exact runs each line length gets.
import fs from 'node:fs';
import {buildCorpus,splitRecords,detectMode,analyzeWord,normalize,parseAccents,withAccents} from '../dist/engine.js';
const file=process.argv[2]||'dist/data/menu.txt';
const text=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const accentsFile=new URL('../dist/data/accents.txt',import.meta.url);
const dictionary=withAccents(
  new Map(Object.entries(JSON.parse(fs.readFileSync(new URL('../dist/data/dictionary.json',import.meta.url),'utf8')))),
  parseAccents(fs.existsSync(accentsFile)?fs.readFileSync(accentsFile,'utf8'):''));
const mode=detectMode(text),records=splitRecords(text,mode);
const unknown=new Map();
for(const record of records)
  for(const match of record.text.matchAll(/[а-яё́]+/gi)) {
    const info=analyzeWord(match[0],dictionary);
    if(info.unknown)unknown.set(normalize(match[0]),(unknown.get(normalize(match[0]))||0)+1);
  }
const lengths=Array.from({length:24},(_,i)=>i+1);
const corpus=buildCorpus(text,dictionary,{lengths});
const counts=records.map(r=>(r.text.match(/[аеёиоуыэюя]/gi)||[]).length);
console.log(`${file}: режим ${mode}, записей ${records.length}, разделов ${corpus.stats.sections.length}`);
console.log('слогов в записи: мин',Math.min(...counts),'макс',Math.max(...counts),'медиана',counts.slice().sort((a,b)=>a-b)[counts.length>>1]);
console.log('длины записей:',Object.entries(counts.reduce((a,c)=>(a[c]=(a[c]||0)+1,a),{})).map(([k,v])=>`${k}:${v}`).join(' '));
console.log('записей по длинам:',lengths.filter(n=>corpus.stats.lengths[n]).map(n=>`${n}:${corpus.stats.lengths[n]}`).join(' '));
console.log('строки, которые НЕ собрать:',corpus.missing.length?corpus.missing.join(', '):'нет — любая длина от 1 до 24 достижима');
console.log(`слов без ударения (${unknown.size}):`,[...unknown.keys()].sort().join(', ')||'нет');
