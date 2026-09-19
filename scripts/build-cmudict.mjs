// Собирает CMUdict в компактный словарь произношения для английских песен.
// CMUdict — словарь произношения Университета Карнеги-Меллона, свободная лицензия.
// Для каждого слова храним строку фонем: из неё движок сам выводит число слогов,
// вектор ударений, гласные для протяжных нот и рифменный хвост.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const CACHE=path.join(ROOT,'.cache/cmudict');
const SOURCE='https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict';
const LICENSE='https://raw.githubusercontent.com/cmusphinx/cmudict/master/LICENSE';

fs.mkdirSync(CACHE,{recursive:true});
const raw=path.join(CACHE,'cmudict.dict');
if(!fs.existsSync(raw)){
  console.log('Качаем CMUdict…');
  const response=await fetch(SOURCE);
  if(!response.ok)throw Error(`CMUdict не скачался: ${response.status}`);
  fs.writeFileSync(raw,Buffer.from(await response.arrayBuffer()));
  const license=await fetch(LICENSE);
  if(license.ok)fs.writeFileSync(path.join(CACHE,'LICENSE'),Buffer.from(await license.arrayBuffer()));
}

const result={};
let variants=0;
for(const line of fs.readFileSync(raw,'utf8').split('\n')){
  const clean=line.split('#')[0].trim();
  if(!clean)continue;
  const [head,...phones]=clean.split(/\s+/);
  if(!phones.length)continue;
  // «word(2)» — второй вариант произношения; берём только первый, он основной
  if(/\(\d+\)$/.test(head)){variants++;continue;}
  const word=head.toLowerCase();
  if(!/^[a-z']+$/.test(word))continue;
  if(!phones.some(phone=>/\d$/.test(phone)))continue;   // без гласных петь нечего
  result[word]=phones.join(' ');
}

const target=path.join(ROOT,'dist/data/cmudict.json');
fs.writeFileSync(target,JSON.stringify(result),'utf8');
const license=path.join(CACHE,'LICENSE');
if(fs.existsSync(license))fs.copyFileSync(license,path.join(ROOT,'dist/data/CMUDICT-LICENSE.txt'));
console.log(`${Object.keys(result).length.toLocaleString('ru')} слов, ${(fs.statSync(target).size/1048576).toFixed(1)} МБ (пропущено ${variants} вариантов произношения).`);
