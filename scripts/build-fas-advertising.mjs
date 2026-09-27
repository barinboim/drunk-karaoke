// Собирает локальный корпус из дословных цитат рекламы в материалах дел ФАС.
// Источник: снимок .corpus-source/fas-ad-practice-dataset.csv.
import fs from 'node:fs';
import {parse} from 'csv-parse/sync';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const SOURCE=path.join(ROOT,'.corpus-source/fas-ad-practice-dataset.csv');
const OUT=path.join(ROOT,'dist/corpora/fas-advertising.txt');
const csv=parse(fs.readFileSync(SOURCE,'utf8'),{delimiter:';',bom:true,relax_column_count:true,skip_empty_lines:true,relax_quotes:true});
const rows=csv.slice(1);
const dictionary=JSON.parse(fs.readFileSync(path.join(ROOT,'dist/data/dictionary.json'),'utf8'));
const accents=new Set(fs.readFileSync(path.join(ROOT,'dist/data/accents.txt'),'utf8').split(/\r?\n/).map(x=>x.split('#')[0].trim().toLowerCase().replace(/́/g,'')));
const ones=['ноль','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
const teens=['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
const tens=['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
const hundreds=['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const ordinal=['','первого','второго','третьего','четвёртого','пятого','шестого','седьмого','восьмого','девятого','десятого','одиннадцатого','двенадцатого','тринадцатого','четырнадцатого','пятнадцатого','шестнадцатого','семнадцатого','восемнадцатого','девятнадцатого','двадцатого','двадцать первого','двадцать второго','двадцать третьего','двадцать четвёртого','двадцать пятого','двадцать шестого','двадцать седьмого','двадцать восьмого','двадцать девятого','тридцатого','тридцать первого'];
const listOrdinal=['','первый','второй','третий','четвёртый','пятый','шестой','седьмой','восьмой','девятый','десятый'];
function under(n){const a=[];if(n>=100){a.push(hundreds[Math.floor(n/100)]);n%=100;}if(n>=10&&n<20)a.push(teens[n-10]);else{if(n>=20){a.push(tens[Math.floor(n/10)]);n%=10;}if(n)a.push(ones[n]);}return a.join(' ');}
function number(n){n=Number(n);if(!Number.isSafeInteger(n)||n<0||n>999999)return '';if(!n)return 'ноль';if(n<1000)return under(n);const k=Math.floor(n/1000),last=k%10,last2=k%100;const form=last2>=11&&last2<=19?'тысяч':last===1?'тысяча':last>=2&&last<=4?'тысячи':'тысяч';return `${under(k)} ${form}${n%1000?' '+under(n%1000):''}`;}
const latin={a:'а',b:'б',c:'к',d:'д',e:'е',f:'ф',g:'г',h:'х',i:'и',j:'дж',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',q:'к',r:'р',s:'с',t:'т',u:'у',v:'в',w:'в',x:'кс',y:'й',z:'з'};
function clean(s){s=String(s||'').replace(/<[^>]*>/g,' ').replace(/https?:\/\/\S+|www\.\S+/gi,' ');
 s=s.replace(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{2,4})(?!\d)/g,(_,d,m,y)=>months[Number(m)-1]?`${ordinal[Number(d)]||number(d)} ${months[Number(m)-1]} ${number(y)} года`:`${number(d)} ${number(m)} ${number(y)}`);
 s=s.replace(/(?<!\d)(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b/gi,(_,d,m)=>`${ordinal[Number(d)]||number(d)} ${m}`);
 s=s.replace(/(?<!\d)(\d+)[.)](?=\s)/g,(_,n)=>`${listOrdinal[Number(n)]||number(n)}) `);
 s=s.replace(/(?<!\d)(\d+)\s*%/g,(_,n)=>`${number(n)} процентов`).replace(/(?<!\d)(\d+)\s*(?:руб(?:лей|ля)?\.?|р\.)/gi,(_,n)=>`${number(n)} рублей`);
 s=s.replace(/(?<!\d)(\d+)\s*[–-]\s*(\d+)(?!\d)/g,(_,a,b)=>`${number(a)}-${number(b)}`).replace(/(?<!\d)(\d+)[,.](\d+)(?!\d)/g,(_,a,b)=>`${number(a)} целых ${number(b)} десятых`).replace(/(?<!\d)\d+(?!\d)/g,n=>number(n)||' ');
 s=s.replace(/[A-Za-z]+/g,w=>[...w.toLowerCase()].map(c=>latin[c]||c).join(''));return s.replace(/[“”«»"„`]/g,' ').replace(/[|_~^*]+/g,' ').replace(/[^А-Яа-яЁё\s.,!?;:()'’—-]/g,' ').replace(/\s+/g,' ').trim();}
const syllables=s=>(s.match(/[аеёиоуыэюя]/gi)||[]).length;
const normalized=s=>s.toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
const candidates=[];const seen=new Set();let empty=0,filteredLength=0,unknownCount=0;
const startsIncomplete=/^(?:и|а|но|или|либо|что|чтобы|который|которая|которые|где|когда|если|поскольку|хотя|при|после|до|от|для|без|ли|же|в|во|на|по|под|из|к|ко|над|об|обо|с|со|за)\b/i;
const endsIncomplete=/\b(?:и|а|но|или|либо|что|чтобы|который|которая|которые|где|когда|если|при|после|до|от|для|без|ли|же|в|во|на|по|под|из|к|ко|над|об|обо|с|со|за|не)$/i;
function sectionFor(platform=''){
 const p=platform.toLowerCase();
 if(/радио|телевиз|аудио|вещан/.test(p))return 'Радио и телевидение';
 if(/смс|sms|звон|телефон|электросвяз/.test(p))return 'Сообщения и звонки';
 if(/интернет|сайт|социаль|вконтакте|онлайн|сеть/.test(p))return 'Интернет';
 if(/наруж|щит|вывес|трансп|метро|автобус/.test(p))return 'Улица и транспорт';
 if(/печат|листов|буклет|газет|журнал|полиграф/.test(p))return 'Печатная реклама';
 if(/магазин|торгов|витрин|продаж/.test(p))return 'Магазины и торговля';
 return 'Другие рекламные носители';
}
for(const row of rows){let source=String(row[9]||'').trim();if(!source){empty++;continue;}
 // Длинную цитату делим только по её знакам конца предложения и точкам с запятой:
 // каждая получившаяся запись целиком взята из реального рекламного текста.
 if(/(?:\+?\d[\d\s().-]{5,}\d|<[^>]+>|https?:\/\/|www\.|(?:^|[^\p{L}\d])[\p{L}\d-]+\.(?:ru|рф|com|net|org)(?:$|[^\p{L}\d])|\d{1,2}:\d{2})/iu.test(source))continue;
 const phrases=source.split(/(?<=[.!?;])\s+|\s+[—–]\s+/u).map(part=>part.trim().replace(/^[«»"'“”]+|[«»"'“”]+$/g,''));
 for(const phrase of phrases){
  if(!phrase||/\.\.\.|…/.test(phrase))continue;
  const text=clean(phrase);if(!text||!/[А-Яа-яЁё]/.test(text)||startsIncomplete.test(text)||endsIncomplete.test(text))continue;
  const count=syllables(text);if(count<1||count>32){filteredLength++;continue;}
  const words=text.toLowerCase().replace(/́/g,'').match(/[а-яё]+/g)||[];
  const unknown=words.filter(w=>syllables(w)>1&&!Object.hasOwn(dictionary,w)&&!accents.has(w));
  if(unknown.length){unknownCount++;continue;}
  const key=normalized(text);if(seen.has(key))continue;seen.add(key);
  candidates.push({text,syllables:count,section:sectionFor(row[10]),sourceLink:String(row[3]||'')});
 }
}
// Разделы отражают тип рекламного носителя из поля источника; сами фразы дословны.
// Оставляем все целые фразы 8–16 слогов, а длинные и короткие берём равномерно.
// Это удерживает требуемый игровой объём и не даёт коротким хвостам вытеснить ядро.
const core=candidates.filter(row=>row.syllables>=8&&row.syllables<=16);
const short=candidates.filter(row=>row.syllables<8);
const long=candidates.filter(row=>row.syllables>16);
function even(list,count){if(!count||!list.length)return[];const take=Math.min(list.length,count);return Array.from({length:take},(_,i)=>list[Math.floor(i*list.length/take)]);}
const TARGET=6300; // запас покрывает строки, которые движок удаляет как неслышимые/повторные
const shortPreferred=short.filter(row=>row.syllables>=4);
const shortTiny=short.filter(row=>row.syllables<4);
const shortQuota=Math.max(0,TARGET-core.length-long.length);
const selected=[...core,...long,...even(shortPreferred,Math.max(0,shortQuota-45)),...even(shortTiny,45)].slice(0,TARGET);
const buckets=new Map();for(const row of selected){const section=row.section.replace(/[\r\n#]/g,' ').slice(0,60);if(!buckets.has(section))buckets.set(section,[]);buckets.get(section).push(row.text);}
const out=['---','name: Тексты рекламы','about: Дословные законченные фразы из рекламных цитат в открытых решениях ФАС','mode: list','license: CC BY-NC-SA 4.0','source: https://huggingface.co/datasets/slm-ct/fas_ad_practice_dataset','attribution: Екатерина Якуненко, Russian Advertisement Legislation Violation Cases Dataset','changes: Отобраны фразы из ad_content_cited; числа записаны словами; латиница транслитерирована; очищена пунктуация','---',''];
for(const [section,lines] of buckets){out.push(`## ${section}`,...lines,'');}
fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,out.join('\n'),'utf8');
const sorted=selected.map(x=>x.syllables).sort((a,b)=>a-b);const coreCount=selected.filter(x=>x.syllables>=8&&x.syllables<=16).length;
console.log(JSON.stringify({sourceRows:rows.length,eligibleBeforeSampling:candidates.length,accepted:selected.length,median:sorted[sorted.length>>1]||0,corePercent:selected.length?Math.round(coreCount*100/selected.length):0,overLength:filteredLength,rowsWithUnknownStress:unknownCount,empty,sections:buckets.size,examples:selected.slice(0,8).map(x=>x.text)},null,2));
