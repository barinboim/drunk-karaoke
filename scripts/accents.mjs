// Переносит ударения из датасетов в общий словарь проекта.
//
// Зачем: словарь у нас один, и найденное однажды слово должно быть известно всем.
// Иначе каждый следующий датасет заново выводит ударение для «загустителя»,
// а составитель тратит время на то, что уже сделано до него.
//
// Датасет по-прежнему может нести раздел «## ~ударения» — это удобно тому, кто
// присылает файл со стороны. Эта команда складывает такие находки в общий словарь
// и убирает служебный раздел из файла.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCorpusFile,parseAccents,normalize} from '../dist/engine.js';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const FOLDER=path.join(ROOT,'dist/corpora');
const CENTRAL=path.join(ROOT,'dist/data/accents.txt');
const apply=process.argv.includes('--apply');

// Слова, где датасеты разошлись, а норма одна. Индекс — номер ударной гласной с нуля.
const RESOLVED={аккаунта:1,завершена:3,отключено:3,переполнена:2,проветриваемом:1};

const central=fs.readFileSync(CENTRAL,'utf8');
const known=parseAccents(central);

/** Сырые строки служебного раздела: в них сохранено написание со знаком ударения. */
function accentLines(source){
  const lines=[];let inside=false;
  for(const row of source.split('\n')){
    const head=/^#{1,3}\s*(\S.*)$/.exec(row.trim());
    if(head){inside=/^~\s*ударени/i.test(head[1].trim());continue;}
    if(inside&&row.trim()&&!row.trim().startsWith('#'))lines.push(row.trim());
  }
  return lines;
}

const collected=new Map();   // нормализованное слово → написание со знаком
const sources=new Map();     // слово → датасеты, где встретилось
const conflicts=[];
const touched=[];

for(const file of fs.readdirSync(FOLDER).filter(name=>name.endsWith('.txt'))){
  const full=path.join(FOLDER,file);
  const source=fs.readFileSync(full,'utf8');
  const lines=accentLines(source);
  if(!lines.length)continue;
  const name=parseCorpusFile(source).meta.name||file;
  touched.push({file,full,source,name,count:lines.length});
  for(const line of lines){
    const word=normalize(line);
    const marks=parseAccents(line).get(word)?.join(',');
    if(!marks)continue;
    sources.set(word,[...(sources.get(word)||[]),name]);
    const before=collected.get(word);
    if(before&&parseAccents(before).get(word)?.join(',')!==marks)
      conflicts.push({word,a:before,b:line,where:sources.get(word)});
    if(!before)collected.set(word,line);
  }
}

// Противоречия разрешаем по норме, а не по тому, кто записал первым.
for(const [word,index] of Object.entries(RESOLVED)){
  const line=collected.get(word);
  if(!line)continue;
  const bare=line.replace(/́/g,'');
  let vowel=-1,rebuilt='';
  for(const letter of bare){
    rebuilt+=letter;
    if('аеёиоуыэюя'.includes(letter.toLowerCase())){vowel++;if(vowel===index)rebuilt+='́';}
  }
  collected.set(word,rebuilt);
}

const fresh=[...collected].filter(([word])=>!known.has(word));
console.log(`В датасетах ${collected.size} ударений, из них новых для общего словаря: ${fresh.length}`);
if(conflicts.length){
  console.log(`\nРазошлись между датасетами (${conflicts.length}), взята норма:`);
  for(const item of conflicts)
    console.log(`  ${item.word}: ${item.a} / ${item.b} — ${item.where.join(', ')}`);
}

if(!apply){
  console.log('\nЭто разбор без изменений. Чтобы перенести: npm run accents -- --apply');
  process.exit(0);
}

const added=fresh.map(([,line])=>line).sort((a,b)=>a.localeCompare(b,'ru'));
if(added.length){
  const block=`\n## Из датасетов\n${added.join('\n')}\n`;
  fs.writeFileSync(CENTRAL,central.replace(/\s*$/,'\n')+block,'utf8');
}
for(const item of touched){
  const cleaned=item.source
    .replace(/\n*^#{1,3}\s*~\s*ударени[^\n]*\n(?:(?!^#{1,3}\s)[^\n]*\n?)*/gim,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .replace(/\s*$/,'\n');
  fs.writeFileSync(item.full,cleaned,'utf8');
}
console.log(`\nПеренесено ${added.length} ударений в dist/data/accents.txt.`);
console.log(`Служебные разделы убраны из ${touched.length} датасетов.`);
