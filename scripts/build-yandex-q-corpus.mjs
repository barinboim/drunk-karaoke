// Build a local whole-question list from IlyaGusev/yandex_q_full.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const SOURCE=fs.realpathSync(process.argv[2]||path.join(ROOT,'.corpus-source/yandex_q.jsonl.zst'));
const OUTPUT=path.join(ROOT,'dist/corpora/mail-questions.txt');
const dictionary=new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT,'dist/data/dictionary.json'),'utf8'))));
for(const line of fs.readFileSync(path.join(ROOT,'dist/data/accents.txt'),'utf8').split(/\r?\n/)){
  const word=line.split('#')[0].trim().toLowerCase().replace(/́/g,'');
  if(/^[а-яё]+$/.test(word))dictionary.add(word);
}
const vowels=/[аеёиоуыэюя]/gi;
const ones=['ноль','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
const teens=['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
const tens=['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
const hundreds=['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
function numberWords(input){
  const n=Number(input);if(!Number.isSafeInteger(n)||n<0||n>999999)return'';if(!n)return ones[0];
  const under=value=>{const out=[];if(value>=100){out.push(hundreds[Math.floor(value/100)]);value%=100;}if(value>=10&&value<20)out.push(teens[value-10]);else{if(value>=20){out.push(tens[Math.floor(value/10)]);value%=10;}if(value)out.push(ones[value]);}return out;};
  const out=[];if(n>=1000){const thousands=Math.floor(n/1000),lastTwo=thousands%100,last=thousands%10;out.push(under(thousands).join(' '));out.push(lastTwo>=11&&lastTwo<=19?'тысяч':last===1?'тысяча':last>=2&&last<=4?'тысячи':'тысяч');}
  if(n%1000)out.push(under(n%1000).join(' '));return out.join(' ');
}
const latin={a:'а',b:'б',c:'к',d:'д',e:'е',f:'ф',g:'г',h:'х',i:'и',j:'дж',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',q:'к',r:'р',s:'с',t:'т',u:'у',v:'в',w:'в',x:'кс',y:'й',z:'з'};
function normalize(input){
  let text=String(input||'').replace(/<[^>]*>/g,' ').replace(/https?:\/\/\S+|www\.\S+/gi,' ');
  text=text.replace(/(?<!\d)(\d+)%/g,(_,n)=>`${numberWords(n)} процентов`)
    .replace(/(?<!\d)(\d+)[–-](\d+)(?!\d)/g,(_,a,b)=>`${numberWords(a)}-${numberWords(b)}`)
    .replace(/(?<!\d)(\d+)[,.](\d+)(?!\d)/g,(_,a,b)=>`${numberWords(a)} целых ${numberWords(b)} десятых`)
    .replace(/(?<!\d)\d+(?!\d)/g,n=>numberWords(n));
  text=text.replace(/[A-Za-z]+/g,word=>[...word.toLowerCase()].map(ch=>latin[ch]||ch).join(''));
  return text.replace(/[“”«»"„`]/g,' ').replace(/[|_~^*]+/g,' ').replace(/[^А-Яа-яЁё\s.,!?;:()'’—-]/g,' ').replace(/\s+/g,' ').trim();
}
function known(text){const words=text.toLowerCase().replace(/́/g,'').match(/[а-яё]+/g)||[];return words.length>0&&words.every(word=>dictionary.has(word)||(word.match(vowels)||[]).length<=1);}
function syllables(text){return(text.match(vowels)||[]).length;}
function spread(rows,count){const take=Math.min(rows.length,count);return take?Array.from({length:take},(_,i)=>rows[Math.floor(i*rows.length/take)]):[];}

if(!fs.existsSync(SOURCE))throw new Error(`Исходник не найден: ${SOURCE}`);
const input=spawn('zstd',['-dc',SOURCE],{stdio:['ignore','pipe','inherit']});
const lines=readline.createInterface({input:input.stdout,crlfDelay:Infinity});
const seen=new Set(),core=[],tail=[];let sourceRows=0,valid=0;
for await(const line of lines){
  sourceRows++;
  let row;try{row=JSON.parse(line);}catch{continue;}
  const text=normalize(row.title),key=text.toLowerCase().replace(/ё/g,'е');
  if(!text||seen.has(key)||!/[А-Яа-яЁё]/.test(text)||/[0-9A-Za-z]/.test(text)||!known(text))continue;
  const count=syllables(text);if(count<1||count>24)continue;
  seen.add(key);valid++;(count>=8&&count<=16?core:tail).push({text,count});
}
const exit=await new Promise(resolve=>input.on('close',resolve));
if(exit!==0)throw new Error(`zstd завершился с кодом ${exit}`);
const TARGET=51000;
const selected=[];
const shortWhWords=new Set(['кто','что','где','как','чей','чья','чьё','чьё','чем','куда','когда','зачем','почему','откуда']);
const shortQuestions=[...core,...tail].filter(row=>{
  if(!row.text.endsWith('?')||/\p{Lu}{2,}/u.test(row.text)||/(?:^|\s)\p{L}\./u.test(row.text))return false;
  const words=row.text.toLowerCase().match(/[а-яё]+/g)||[];
  return (words.length>=2||(words.length===1&&shortWhWords.has(words[0])))&&words.every(word=>dictionary.has(word)||shortWhWords.has(word));
});
for(let count=1;count<=7;count++)selected.push(...spread(shortQuestions.filter(row=>row.count===count),40));
selected.push(...spread(core,Math.max(0,TARGET-selected.length)));
if(selected.length<TARGET){
  const used=new Set(selected.map(row=>row.text.toLowerCase().replace(/ё/g,'е')));
  const remaining=tail.filter(row=>!used.has(row.text.toLowerCase().replace(/ё/g,'е')));
  selected.push(...spread(remaining,TARGET-selected.length));
}
if(selected.length<30000)throw new Error(`Найдено только ${selected.length} пригодных вопросов; корпус не записан.`);
const output=['---','name: Вопросы Mail.ru','about: Цельные реальные вопросы из корпуса Yandex Q; игровое название задано пользователем','mode: list','source: https://huggingface.co/datasets/IlyaGusev/yandex_q_full','attribution: Ilya Gusev, yandex_q_full (parsed from its5Q/yandex-q)','changes: Использовано только поле title; числительные записаны словами; латиница транслитерирована; строки с неподтверждёнными ударениями исключены','---','','## Вопросы',...selected.map(row=>row.text),''];
fs.writeFileSync(OUTPUT,output.join('\n'),'utf8');
const counts=selected.map(row=>row.count).sort((a,b)=>a-b);
console.log(`Yandex Q: ${selected.length} вопросов из ${sourceRows} строк; пригодных ${valid}; ядро 8–16 слогов ${Math.round(100*selected.filter(row=>row.count>=8&&row.count<=16).length/selected.length)}%; медиана ${counts[counts.length>>1]}.`);
