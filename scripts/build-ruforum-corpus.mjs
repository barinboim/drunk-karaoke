// Собирает локальную выборку целых сообщений из набора Russian Forum Messages.
// Источник: Hugging Face nyuuzyou/ruforum, доступные JSONL.ZST shard-файлы.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const SOURCE_DIR=path.join(ROOT,'.corpus-source');
const OUTPUT=path.join(ROOT,'dist/corpora/ruforum.txt');
const shards=fs.readdirSync(SOURCE_DIR).filter(x=>/^ruforum-dataset-\d\d\.jsonl\.zst$/.test(x)).sort();
if(!shards.length)throw Error('Нет локальных shard Ruforum в .corpus-source');
const dictionary=JSON.parse(fs.readFileSync(path.join(ROOT,'dist/data/dictionary.json'),'utf8'));
const accents=new Set(fs.readFileSync(path.join(ROOT,'dist/data/accents.txt'),'utf8').split(/\r?\n/).map(x=>x.split('#')[0].trim().toLowerCase().replace(/́/g,'')));
const vowels=/[аеёиоуыэюя]/gi;
const ones=['ноль','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
const teens=['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
const tens=['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
const hundreds=['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const ordinal=['','первого','второго','третьего','четвёртого','пятого','шестого','седьмого','восьмого','девятого','десятого','одиннадцатого','двенадцатого','тринадцатого','четырнадцатого','пятнадцатого','шестнадцатого','семнадцатого','восемнадцатого','девятнадцатого','двадцатого','двадцать первого','двадцать второго','двадцать третьего','двадцать четвёртого','двадцать пятого','двадцать шестого','двадцать седьмого','двадцать восьмого','двадцать девятого','тридцатого','тридцать первого'];
const latin={a:'а',b:'б',c:'к',d:'д',e:'е',f:'ф',g:'г',h:'х',i:'и',j:'дж',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',q:'к',r:'р',s:'с',t:'т',u:'у',v:'в',w:'в',x:'кс',y:'й',z:'з'};
function under(n){const a=[];if(n>=100){a.push(hundreds[Math.floor(n/100)]);n%=100;}if(n>=10&&n<20)a.push(teens[n-10]);else{if(n>=20){a.push(tens[Math.floor(n/10)]);n%=10;}if(n)a.push(ones[n]);}return a.join(' ');}
function number(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>999999)return '';if(!n)return 'ноль';if(n<1000)return under(n);const k=Math.floor(n/1000),last=k%10,last2=k%100,form=last2>=11&&last2<=19?'тысяч':last===1?'тысяча':last>=2&&last<=4?'тысячи':'тысяч';return `${under(k)} ${form}${n%1000?' '+under(n%1000):''}`;}
function year(value){const n=Number(value);if(n>=2000&&n<2100){const rest=n-2000;return rest?`две тысячи ${number(rest)}`:'двухтысячного';}return number(n);}
function clean(raw){let s=String(raw||'').replace(/<[^>]*>/g,' ').replace(/https?:\/\/\S+|www\.\S+/gi,' ');
 s=s.replace(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{2,4})(?!\d)/g,(_,d,m,y)=>months[Number(m)-1]?`${ordinal[Number(d)]||number(d)} ${months[Number(m)-1]} ${year(y)} года`:`${number(d)} ${number(m)} ${number(y)}`);
 s=s.replace(/(?<!\d)(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b/gi,(_,d,m)=>`${ordinal[Number(d)]||number(d)} ${m}`);
 s=s.replace(/(?<!\d)(\d+)\s*%/g,(_,n)=>`${number(n)} процентов`).replace(/(?<!\d)(\d+)\s*(?:руб(?:лей|ля)?\.?|р\.)/gi,(_,n)=>`${number(n)} рублей`);
 s=s.replace(/(?<!\d)(\d+)\s*[–-]\s*(\d+)(?!\d)/g,(_,a,b)=>`${number(a)}-${number(b)}`).replace(/(?<!\d)(\d+)[,.](\d+)(?!\d)/g,(_,a,b)=>`${number(a)} целых ${number(b)} десятых`).replace(/(?<!\d)\d+(?!\d)/g,n=>number(n)||' ');
 s=s.replace(/[A-Za-z]+/g,w=>[...w.toLowerCase()].map(c=>latin[c]||c).join(''));
 return s.replace(/[“”«»"„`]/g,' ').replace(/[|_~^*]+/g,' ').replace(/[^А-Яа-яЁё\s.,!?;:()'’—-]/g,' ').replace(/\s+/g,' ').trim();}
const syllables=s=>(s.match(vowels)||[]).length;
const norm=s=>s.toLowerCase().replace(/ё/g,'е').replace(/́/g,'').replace(/\s+/g,' ').trim();
const startsIncomplete=/^(?:и|а|но|или|либо|что|чтобы|который|которая|которые|где|когда|если|поскольку|хотя|при|после|до|от|для|без|ли|же|в|во|на|по|под|из|к|ко|над|об|обо|с|со|за)(?:\s|$)/i;
const endsIncomplete=/(?:^|\s)(?:и|а|но|или|либо|что|чтобы|который|которая|которые|где|когда|если|при|после|до|от|для|без|ли|же|в|во|на|по|под|из|к|ко|над|об|обо|с|со|за|не)[.,!?;:()'’—-]*$/i;
const personal=/[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\d\s().-]{7,}\d)|(?:https?:\/\/|www\.)/i;
const explicit=/(?:изнасил|порно|эротик|секс|трах|минет|суицид|самоубий|наркотик|героин|проститут|педофил|онколог|(?:^|[^а-яё])(?:вич|спид)(?:$|[^а-яё]))/i;
const profanity=/(?:^|[^а-яё])(?:хуй|пизд|бляд|еба|ёб|сука|мудак|гандон|говн)/i;
let state=0x6d2b79f5;function random(){state+=0x6d2b79f5;let t=state;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}
const buckets=Array.from({length:25},()=>({seen:0,items:[]}));
const stats={read:0,malformed:0,empty:0,nonRussian:0,personal:0,explicit:0,profanity:0,tooLong:0,unknown:0,incomplete:0,duplicates:0};
let minTimestamp=Infinity,maxTimestamp=0;
for(const shard of shards){
 const child=spawn('zstd',['-dc',path.join(SOURCE_DIR,shard)],{stdio:['ignore','pipe','inherit']});
 const lines=readline.createInterface({input:child.stdout,crlfDelay:Infinity});
 for await(const line of lines){stats.read++;let row;try{row=JSON.parse(line);}catch{stats.malformed++;continue;}
  const raw=String(row.text||'').trim();if(!raw){stats.empty++;continue;}
  const cyr=(raw.match(/[А-Яа-яЁё]/g)||[]).length,lat=(raw.match(/[A-Za-z]/g)||[]).length;if(cyr<Math.max(4,lat*2)){stats.nonRussian++;continue;}
  if(personal.test(raw)){stats.personal++;continue;}if(explicit.test(raw)){stats.explicit++;continue;}if(profanity.test(raw)){stats.profanity++;continue;}
  const text=clean(raw);if(!text||!/[А-Яа-яЁё]/.test(text))continue;
  const count=syllables(text);if(count<1||count>24){stats.tooLong++;continue;}
  const words=text.toLowerCase().replace(/́/g,'').match(/[а-яё]+/g)||[];
  if(words.some(w=>syllables(w)===0)){stats.unknown++;continue;}
  if(words.some(w=>syllables(w)>1&&!Object.hasOwn(dictionary,w)&&!accents.has(w))){stats.unknown++;continue;}
  if(startsIncomplete.test(text)||endsIncomplete.test(text)){stats.incomplete++;continue;}
  const t=Number(row.timestamp);if(Number.isFinite(t)){minTimestamp=Math.min(minTimestamp,t);maxTimestamp=Math.max(maxTimestamp,t);}
  const bucket=buckets[count],candidate={text,id:row.messageId};bucket.seen++;
  const cap=count>=8&&count<=16?2200:800;
  if(bucket.items.length<cap)bucket.items.push(candidate);else{const j=Math.floor(random()*bucket.seen);if(j<cap)bucket.items[j]=candidate;}
 }
 const code=await new Promise(resolve=>child.on('close',resolve));if(code!==0)throw Error(`zstd завершился с кодом ${code} для ${shard}`);
}
const unique=Array.from({length:25},()=>[]);const seen=new Set();
for(let n=1;n<=24;n++)for(const row of buckets[n].items){const key=norm(row.text);if(seen.has(key)){stats.duplicates++;continue;}seen.add(key);unique[n].push(row);}
// Берём запас: corpora.mjs может отвергнуть записи с неоднозначным ударением.
const TARGET=21000,CORE=17000,coreLengths=Array.from({length:9},(_,i)=>i+8),tailLengths=[1,2,3,4,5,6,7,17,18,19,20,21,22,23,24];
function distribute(lengths,total){const quotas=new Map(lengths.map(n=>[n,15]));let left=Math.max(0,total-lengths.length*15);while(left){let moved=false;for(const n of lengths){if(quotas.get(n)<unique[n].length){quotas.set(n,quotas.get(n)+1);left--;moved=true;if(!left)break;}}if(!moved)break;}return quotas;}
const quotas=new Map([...distribute(coreLengths,CORE),...distribute(tailLengths,TARGET-CORE)]);
const selected=[];for(const n of [...coreLengths,...tailLengths])selected.push(...unique[n].slice(0,quotas.get(n)));
const linesOut=['---','name: Форумы Ruforum','about: Реальные сообщения русскоязычных форумов; конкретные площадки в наборе не указаны','mode: list','license: CC0 1.0','source: https://huggingface.co/datasets/nyuuzyou/ruforum','attribution: nyuuzyou, Russian Forum Messages Dataset','changes: Отобраны целые сообщения; числа записаны словами; латиница транслитерирована; удалены дубли, контакты и сообщения с явным неприемлемым содержанием','---','','## Форумы Ruforum',...selected.map(x=>x.text),''];
fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});fs.writeFileSync(OUTPUT,linesOut.join('\n'),'utf8');
console.log(JSON.stringify({shards,read:stats.read,accepted:selected.length,syllableBuckets:Object.fromEntries([...coreLengths,...tailLengths].map(n=>[n,{available:unique[n].length,selected:selected.filter(x=>syllables(x.text)===n).length}])),period:minTimestamp<Infinity?{from:new Date(minTimestamp*1000).toISOString().slice(0,10),to:new Date(maxTimestamp*1000).toISOString().slice(0,10)}:null,stats,examples:selected.slice(0,12).map(x=>x.text)},null,2));
