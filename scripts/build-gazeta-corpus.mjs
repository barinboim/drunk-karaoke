// Build a local list corpus from the title field of IlyaGusev/gazeta.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const SOURCE=path.join(ROOT,'.corpus-source/gazeta-titles.json');
const OUTPUT=path.join(ROOT,'dist/corpora/gazeta.txt');
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
const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const ordinals=['','первого','второго','третьего','четвертого','пятого','шестого','седьмого','восьмого','девятого','десятого','одиннадцатого','двенадцатого','тринадцатого','четырнадцатого','пятнадцатого','шестнадцатого','семнадцатого','восемнадцатого','девятнадцатого','двадцатого','двадцать первого','двадцать второго','двадцать третьего','двадцать четвертого','двадцать пятого','двадцать шестого','двадцать седьмого','двадцать восьмого','двадцать девятого','тридцатого','тридцать первого'];
function numberWords(input){
  const n=Number(input);if(!Number.isSafeInteger(n)||n<0||n>999999)return'';if(!n)return ones[0];
  const under=value=>{const out=[];if(value>=100){out.push(hundreds[Math.floor(value/100)]);value%=100;}if(value>=10&&value<20)out.push(teens[value-10]);else{if(value>=20){out.push(tens[Math.floor(value/10)]);value%=10;}if(value)out.push(ones[value]);}return out;};
  const out=[];if(n>=1000){const thousands=Math.floor(n/1000),lastTwo=thousands%100,last=thousands%10;out.push(under(thousands).join(' '));out.push(lastTwo>=11&&lastTwo<=19?'тысяч':last===1?'тысяча':last>=2&&last<=4?'тысячи':'тысяч');}
  if(n%1000)out.push(under(n%1000).join(' '));return out.join(' ');
}
const latin={a:'а',b:'б',c:'к',d:'д',e:'е',f:'ф',g:'г',h:'х',i:'и',j:'дж',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',q:'к',r:'р',s:'с',t:'т',u:'у',v:'в',w:'в',x:'кс',y:'й',z:'з'};
function normalize(input){
  let text=String(input||'').replace(/<[^>]*>/g,' ').replace(/https?:\/\/\S+|www\.\S+/gi,' ');
  text=text.replace(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g,(_,day,month,year)=>{
    const monthName=months[Number(month)-1];return monthName?`${ordinals[Number(day)]||numberWords(day)} ${monthName} ${numberWords(year)} года`:`${numberWords(day)} ${numberWords(month)} ${numberWords(year)}`;
  });
  text=text.replace(/\b(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b/gi,(_,day,month)=>`${ordinals[Number(day)]||numberWords(day)} ${month}`);
  text=text.replace(/(?<!\d)(\d+)\s*%/g,(_,n)=>`${numberWords(n)} процентов`)
    .replace(/(?<!\d)(\d+)\s*[–-]\s*(\d+)(?!\d)/g,(_,a,b)=>`${numberWords(a)}-${numberWords(b)}`)
    .replace(/(?<!\d)(\d+)[,.](\d+)(?!\d)/g,(_,a,b)=>`${numberWords(a)} целых ${numberWords(b)} десятых`)
    .replace(/(?<!\d)\d+(?!\d)/g,n=>numberWords(n));
  text=text.replace(/[A-Za-z]+/g,word=>[...word.toLowerCase()].map(ch=>latin[ch]||ch).join(''));
  return text.replace(/[“”«»"„`]/g,' ').replace(/[|_~^*]+/g,' ').replace(/[^А-Яа-яЁё\s.,!?;:()'’—-]/g,' ').replace(/\s+/g,' ').trim();
}
function known(text){const words=text.toLowerCase().replace(/́/g,'').match(/[а-яё]+/g)||[];return words.length>0&&words.every(word=>dictionary.has(word)||(word.match(vowels)||[]).length<=1);}
function syllables(text){return(text.match(vowels)||[]).length;}
function spread(rows,count){const take=Math.min(rows.length,count);return take?Array.from({length:take},(_,i)=>rows[Math.floor(i*rows.length/take)]):[];}

const titles=JSON.parse(fs.readFileSync(SOURCE,'utf8'));
const seen=new Set(),eligible=[];
for(const title of titles){
  const text=normalize(title),key=text.toLowerCase().replace(/ё/g,'е');
  if(!text||seen.has(key)||!/[А-Яа-яЁё]/.test(text))continue;
  if(!known(text))continue;
  seen.add(key);const count=syllables(text);if(count>=1&&count<=24)eligible.push({text,count});
}
const TARGET=25050; // small reserve for records rejected by the runtime parser
const core=eligible.filter(row=>row.count>=8&&row.count<=16);
const tail=eligible.filter(row=>row.count<8||row.count>16);
const selected=[...spread(core,Math.min(core.length,TARGET)),...spread(tail,Math.max(0,TARGET-Math.min(core.length,TARGET)))].slice(0,TARGET);
const output=['---','name: Заголовки Gazeta.ru','about: Реальные газетные заголовки из русскоязычного корпуса Gazeta.ru','mode: list','license: Только личное некоммерческое использование; по условиям источника Gazeta.ru','source: https://huggingface.co/datasets/IlyaGusev/gazeta','attribution: Ilya Gusev, Gazeta dataset','changes: Использована только колонка title; числительные записаны словами; латиница транслитерирована; неподтверждённые ударения отфильтрованы','---','','## Заголовки',...selected.map(row=>row.text),''];
fs.writeFileSync(OUTPUT,output.join('\n'),'utf8');
const counts=selected.map(row=>row.count).sort((a,b)=>a-b);
console.log(`Gazeta: ${selected.length} выбранных заголовков из ${titles.length}; пригодных по словарю ${eligible.length}; ядро 8–16 слогов ${Math.round(100*selected.filter(row=>row.count>=8&&row.count<=16).length/(selected.length||1))}%; медиана ${counts[counts.length>>1]||0}.`);
