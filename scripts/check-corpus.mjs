// Проверка одного файла корпуса. Основная команда — npm run corpora, она проходит
// по всей папке dist/corpora. Эта оставлена для работы над отдельным файлом:
// понимает и новый формат с шапкой, и старый простой список рядом с accents-<имя>.txt.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCorpusFile,parseAccents,withAccents,buildCorpus,detectLanguage,analyzeWord,normalize} from '../dist/engine.js';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const target=process.argv[2];
if(!target){
  console.log('Укажи файл: npm run check -- dist/corpora/reviews.txt');
  console.log('Проверить все сразу: npm run corpora');
  process.exit(1);
}
const file=path.resolve(ROOT,target);
if(!fs.existsSync(file)){console.log(`Файла нет: ${target}`);process.exit(1);}
const read=where=>fs.existsSync(where)?fs.readFileSync(where,'utf8'):'';

const parsed=parseCorpusFile(read(file));
// старый порядок: ударения лежали в соседнем accents-<имя>.txt
const sibling=parseAccents(read(file.replace(/([^/\\]+)\.txt$/,'accents-$1.txt')));
const base=new Map(Object.entries(JSON.parse(read(path.join(ROOT,'dist/data/dictionary.json'))||'{}')));
const shared=parseAccents(read(path.join(ROOT,'dist/data/accents.txt')));
const language=parsed.meta.language||detectLanguage(parsed.text);
const cmuFile=path.join(ROOT,'dist/data/cmudict.json');
const dictionary={
  ru:withAccents(withAccents(base,shared),withAccents(sibling,parsed.accents)),
  en:language==='en'&&fs.existsSync(cmuFile)?new Map(Object.entries(JSON.parse(read(cmuFile)))):null,
};

const lengths=Array.from({length:24},(_,i)=>i+1);
const corpus=buildCorpus(parsed.text,dictionary,{lengths,mode:parsed.meta.mode});
const counts=corpus.records.map(record=>record.count);
const median=counts.slice().sort((a,b)=>a-b)[counts.length>>1];
const core=Math.round(100*counts.filter(c=>c>=8&&c<=16).length/counts.length);
const spread=counts.reduce((all,c)=>(all[c]=(all[c]||0)+1,all),{});

const unknown=new Set();
for(const record of corpus.records)
  for(const match of record.text.matchAll(language==='en'?/[a-z']+/gi:/[а-яё́]+/gi))
    if(analyzeWord(match[0],dictionary).unknown)unknown.add(normalize(match[0]));

console.log(`${target}: ${corpus.records.length} записей, ${corpus.stats.sections.length} разделов, язык ${language}`);
console.log(`медиана ${median} слогов, в ядре 8–16 слогов ${core}% (нужно от 55%)`);
console.log('длины записей:',Object.entries(spread).map(([n,v])=>`${n}:${v}`).join(' '));
console.log('строки, которые НЕ собрать:',corpus.missing.length?corpus.missing.join(', '):'нет — любая длина от 1 до 24 достижима');
console.log(`слов без ударения (${unknown.size}):`,[...unknown].sort().join(', ')||'нет');
