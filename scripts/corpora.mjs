// Собирает список датасетов из dist/corpora и проверяет каждый.
// Подключение нового датасета = положить .txt в папку и запустить этот скрипт.
// Ни app.js, ни index.html править не нужно.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCorpusFile,parseAccents,withAccents,buildCorpus,detectLanguage,analyzeWord,normalize} from '../dist/engine.js';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const FOLDER=path.join(ROOT,'dist/corpora');
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';

const base=new Map(Object.entries(JSON.parse(read(path.join(ROOT,'dist/data/dictionary.json'))||'{}')));
const shared=parseAccents(read(path.join(ROOT,'dist/data/accents.txt')));
const cmu=fs.existsSync(path.join(ROOT,'dist/data/cmudict.json'))
  ? new Map(Object.entries(JSON.parse(read(path.join(ROOT,'dist/data/cmudict.json')))))
  : null;

// Длины строк, которые реально встречаются в песнях: на них и проверяем достижимость.
const LENGTHS=Array.from({length:24},(_,i)=>i+1);
// Основная масса записей должна жить здесь, иначе строка собирается из кусков.
const CORE=Array.from({length:9},(_,i)=>i+8);

fs.mkdirSync(FOLDER,{recursive:true});
const files=fs.readdirSync(FOLDER).filter(name=>name.endsWith('.txt')).sort();
if(!files.length)console.log('В dist/corpora пока нет ни одного .txt');

const listed=[];
let problems=0;
for(const file of files){
  const id=file.replace(/\.txt$/,'');
  const parsed=parseCorpusFile(read(path.join(FOLDER,file)));
  const name=parsed.meta.name||id;
  const language=parsed.meta.language||detectLanguage(parsed.text);
  const dictionary={ru:withAccents(base,withAccents(shared,parsed.accents)),en:cmu};

  let corpus;
  try{corpus=buildCorpus(parsed.text,dictionary,{lengths:LENGTHS});}
  catch(error){console.log(`✗ ${file} — ${error.message}`);problems++;continue;}

  const unknown=new Set();
  for(const record of corpus.records)
    for(const match of record.text.matchAll(language==='en'?/[a-z']+/gi:/[а-яё́]+/gi))
      if(analyzeWord(match[0],dictionary).unknown)unknown.add(normalize(match[0]));

  const counts=corpus.records.map(record=>record.count);
  const median=counts.slice().sort((a,b)=>a-b)[counts.length>>1];
  // Доля записей в 8–16 слогов предсказывает связность лучше всего: именно ими
  // строка песни закрывается одной фразой, а не склейкой из кусков.
  const core=Math.round(100*counts.filter(c=>c>=8&&c<=16).length/counts.length);
  const thin=CORE.filter(n=>counts.filter(c=>c===n).length<15);

  const errors=[],warnings=[];
  if(unknown.size)errors.push(`${unknown.size} слов без известного ударения`);
  if(corpus.missing.length)errors.push(`строки этих длин не собрать: ${corpus.missing.join(', ')}`);
  if(!parsed.meta.name)warnings.push('нет названия в шапке ---');
  if(median<8)warnings.push(`медиана ${median} слогов: строки будут рваными, нужно 9–13`);
  if(core<40)warnings.push(`только ${core}% записей в 8–16 слогов, нужно от 55%`);
  else if(thin.length)warnings.push(`тонко на длинах ${thin.join(', ')}`);
  if(errors.length)problems++;

  listed.push({id,file,name,about:parsed.meta.about||'',language,
    records:corpus.records.length,sections:corpus.stats.sections.length,median,core});

  const mark=errors.length?'✗':warnings.length?'!':'✓';
  console.log(`${mark} ${name} — ${corpus.records.length} записей, медиана ${median} слогов, в ядре ${core}%`);
  for(const note of [...errors,...warnings])console.log(`    ${note}`);
  if(unknown.size&&unknown.size<=40)console.log(`    ${[...unknown].sort().join(', ')}`);
}

fs.writeFileSync(path.join(FOLDER,'index.json'),JSON.stringify(listed,null,1),'utf8');
console.log(`\nВ игре ${listed.length} датасетов. Список: dist/corpora/index.json`);
if(problems)console.log(`С ошибками: ${problems}. Такой датасет подключён, но в игре будет сбоить.`);
console.log('Как читать замечания — docs/DATASETS.md.');
