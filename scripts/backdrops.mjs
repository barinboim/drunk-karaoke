// Собирает базу «не в попад» фонов с Викисклада: павлины, водопады, Пизанская башня.
// Ключей не нужно, всё свободно лицензировано. Картинки намеренно портятся до вида
// дешёвого караоке-диска: мелкий кадр и низкое качество JPEG дают крупные артефакты.
//
//   npm run backdrops            добрать до шестисот фонов
//   npm run backdrops 900        добрать до девятисот
//   npm run backdrops -- --check ничего не качать, показать, что отдают темы
//
// Уже скачанное не перекачивается: скрипт дополняет папку, а не пересобирает её.
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const run=promisify(execFile);
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const OUT=path.join(ROOT,'dist/media/backdrops');
const API='https://commons.wikimedia.org/w/api.php';
const AGENT='DrunkKaraoke/1.0 (local hobby project; backdrop collector)';

// Тот самый набор сюжетов с караоке-кассет: природа из заставки, туристические открытки,
// умилительная живность и реквизит из ресторана, где стоит караоке-машина.
const TOPICS=[
  'Peafowl','Waterfalls','Sunsets','Beaches','Dolphins','Swans','Kittens','Roses',
  'Leaning Tower of Pisa','Eiffel Tower','Palm trees','Flamingos','Butterflies',
  'Horses in art','Donkeys','Windmills','Fountains','Hot air balloons','Lighthouses',
  'Castles','Autumn leaves','Rainbows','Sailing boats','Mountain lakes','Tigers',
  'Parrots','Tulips','Bridges at night','Swimming pools','Deer',
  'Sunflowers','Lavender','Orchids','Cherry blossom','Cacti','Bonsai','Topiary',
  'Koi','Goldfish','Tropical fish','Seashells','Hummingbirds','Owls','Eagles',
  'Squirrels','Ducklings','Puppies','Guinea pigs','Camels','Elephants','Zebras',
  'Gondolas','Pyramids of Giza','Great Wall of China','Taj Mahal','Colosseum',
  'Santorini','Rice terraces','Aurora borealis','Milky Way','Full moon',
  'Fireworks','Candles','Chandeliers','Stained glass windows','Carousels',
  'Ferris wheels','Teddy bears','Garden gnomes','Ice cream','Neon signs',
  'Disco balls','Grand pianos','Violins','Saxophones','Microphones',
  'Birch','Onion domes','Matryoshka dolls','Samovars','Lake Baikal',
  'Saint Basil\'s Cathedral','Dew','Spider webs','Vintage cars',
];

const refused=new Set();   // темы, где отказал не каталог, а сервер — это разные вещи
const args=process.argv.slice(2);
const check=args.includes('--check');
const WANTED=Number(args.find(value=>/^\d+$/.test(value))||600);
const QUOTA=Math.max(6,Math.ceil(WANTED/TOPICS.length)+4);

// Викисклад отвечает 429, если частить, и отдаёт при этом не JSON, а строчку текста.
// Поэтому запросы идут с выдержкой, а на отказ скрипт ждёт столько, сколько просят,
// и пробует снова. Без этого восемьдесят тем превращаются в восемьдесят пустых ответов,
// и выглядит это как «таких категорий нет». Замерено: на полсекунды между запросами
// сервер начинает требовать паузы по 20–50 секунд, на двух с половиной — работает ровно.
// Скачивание самих картинок идёт с другого хоста и такой выдержки не требует.
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let lastCall=0;
async function polite(url,{gap=2500,tries=8}={}){
  for(let attempt=0;attempt<tries;attempt++){
    const since=Date.now()-lastCall;
    if(since<gap)await wait(gap-since);
    lastCall=Date.now();
    const response=await fetch(url,{headers:{'User-Agent':AGENT}});
    if(response.status!==429&&response.status!==503)return response;
    const told=Number(response.headers.get('retry-after'));
    const pause=(Number.isFinite(told)&&told>0?told:3*2**attempt)*1000;
    console.log(`  Викисклад просит подождать ${Math.round(pause/1000)} с`);
    await wait(pause);
  }
  throw Error('Викисклад не пускает: слишком много запросов подряд');
}

async function api(params){
  const url=`${API}?${new URLSearchParams({format:'json',formatversion:'2',...params})}`;
  const response=await polite(url);
  if(!response.ok)throw Error(`Викисклад ответил ${response.status}`);
  return response.json();
}

async function listFiles(category,want){
  const data=await api({
    action:'query',generator:'categorymembers',gcmtitle:`Category:${category}`,
    gcmtype:'file',gcmlimit:String(Math.min(400,Math.max(24,want*6))),
    prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'900',
    // Из метаданных нужны только лицензия и автор: полный набор раздувает ответ в разы,
    // а тяжёлые запросы Викисклад и режет в первую очередь.
    iiextmetadatafilter:'LicenseShortName|Artist',
  }).catch(error=>{refused.add(category);console.log(`  ${category}: ${error.message}`);return null;});
  return (data?.query?.pages||[]).map(page=>{
    const info=page.imageinfo?.[0];
    if(!info?.thumburl||!/\.(jpe?g|png)$/i.test(page.title))return null;
    const meta=info.extmetadata||{};
    const strip=value=>String(value||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
    return {
      title:page.title.replace(/^File:/,''),
      thumb:info.thumburl,page:info.descriptionurl,
      license:strip(meta.LicenseShortName?.value)||'см. страницу файла',
      author:strip(meta.Artist?.value).slice(0,120)||'не указан',
    };
  }).filter(Boolean);
}

async function listSubcategories(category,count){
  const data=await api({
    action:'query',list:'categorymembers',cmtitle:`Category:${category}`,
    cmtype:'subcat',cmlimit:String(count),
  }).catch(()=>null);   // нет подкатегорий — не беда, тема просто останется тонкой
  return (data?.query?.categorymembers||[]).map(item=>item.title.replace(/^Category:/,''));
}

// Часть категорий Викисклада — почти одни подкатегории, самих файлов там три-четыре.
// Поэтому тонкую тему добираем на уровень вглубь, иначе она выпадает из набора.
async function listTopic(topic){
  const seen=new Set(),out=[];
  // Считаем только то, чего ещё нет на диске. Иначе квота темы уходит на уже скачанное
  // и старая тема при добавке выглядит исчерпанной, хотя в каталоге лежат сотни файлов.
  const take=items=>{
    for(const item of items){
      if(out.length>=QUOTA)return;
      if(seen.has(item.title)||taken.has(item.title))continue;
      seen.add(item.title);out.push({topic,...item});
    }
  };
  const direct=await listFiles(topic,QUOTA);
  take(direct);
  // Вглубь лезем только к совсем пустым каталогам: каждый заход — лишние запросы,
  // а сервер за частоту наказывает.
  if(direct.length<3&&!refused.has(topic))
    for(const sub of await listSubcategories(topic,8)){
      if(out.length>=QUOTA)break;
      take(await listFiles(sub,QUOTA-out.length));
    }
  return out;
}

// Мелкий кадр + низкое качество = крупные квадраты, как на пережатом видео.
async function degrade(buffer,target){
  const temp=target+'.src';
  fs.writeFileSync(temp,buffer);
  try{
    await run('ffmpeg',['-v','error','-y','-i',temp,
      '-vf','scale=512:-2,scale=640:-2:flags=neighbor,format=yuvj420p',
      '-q:v','21',target]);
    return true;
  }catch{return false;}
  finally{fs.rmSync(temp,{force:true});}
}

fs.mkdirSync(OUT,{recursive:true});
const creditsFile=path.join(OUT,'CREDITS.json');
const before=fs.existsSync(creditsFile)?JSON.parse(fs.readFileSync(creditsFile,'utf8')):[];
const kept=before.filter(item=>fs.existsSync(path.join(OUT,item.file)));
const taken=new Set(kept.map(item=>item.title));
let number=kept.reduce((max,item)=>Math.max(max,Number(String(item.file).replace(/\D/g,''))||0),0);
console.log(`Уже есть ${kept.length} фонов, нужно ${WANTED}.`);

// Сначала опрашиваем все темы и только потом качаем. Раньше скрипт шёл темами подряд
// и обрывался по достижении цели — до половины списка он просто не доходил, и в наборе
// оказывались десять павлинов, тринадцать водопадов и ничего больше.
const pool=new Map();
for(const topic of TOPICS){
  if(!check&&kept.length>=WANTED)break;
  let items=[];
  try{items=await listTopic(topic);}catch(error){console.log(`  ${topic}: ${error.message}`);continue;}
  pool.set(topic,items);
  if(check)console.log(`  новых ${String(items.length).padStart(3)}  ${topic}`);
}
if(check){
  const empty=[...pool].filter(([topic,items])=>!items.length&&!refused.has(topic)).map(([topic])=>topic);
  console.log(`\nТем ${pool.size}, предлагают ${[...pool.values()].reduce((sum,items)=>sum+items.length,0)} новых файлов.`);
  if(empty.length)console.log(`\nПусто в каталоге (обычно перенаправление на латинское имя): ${empty.join(', ')}`);
  if(refused.size)console.log(`\nСервер отказал, тема не проверена: ${[...refused].join(', ')}`);
  process.exit(0);
}

// Качаем по кругу, а не темами подряд: тогда предел набора обрезает все темы поровну,
// а не выбрасывает хвост списка целиком.
const fresh=[];
let skipped=0;
for(let round=0;round<QUOTA&&kept.length+fresh.length<WANTED;round++){
  for(const [topic,items] of pool){
    if(kept.length+fresh.length>=WANTED)break;
    const item=items[round];
    if(!item)continue;
    try{
      const response=await polite(item.thumb,{gap:120});
      if(!response.ok){skipped++;continue;}
      const buffer=Buffer.from(await response.arrayBuffer());
      if(buffer.length<8000){skipped++;continue;}
      const name=`${String(++number).padStart(3,'0')}.jpg`;
      if(!await degrade(buffer,path.join(OUT,name))){number--;skipped++;continue;}
      fresh.push({file:name,...item});
    }catch{skipped++;}
  }
  const done=kept.length+fresh.length;
  if(fresh.length)console.log(`  круг ${round+1}: всего ${done}`);
}

const all=[...kept,...fresh];
// Порядок в index.json — вперемешку по темам. Потребители всё равно тасуют, но если
// кто-то возьмёт первые двадцать четыре подряд, пусть это будут двадцать четыре разные темы.
const byTopic=new Map();
for(const item of all)byTopic.set(item.topic,[...(byTopic.get(item.topic)||[]),item]);
const mixed=[];
for(let round=0;mixed.length<all.length;round++)
  for(const items of byTopic.values())if(items[round])mixed.push(items[round]);

fs.writeFileSync(path.join(OUT,'index.json'),JSON.stringify(mixed.map(item=>item.file),null,1),'utf8');
fs.writeFileSync(creditsFile,JSON.stringify(mixed,null,1),'utf8');
const bytes=all.reduce((sum,item)=>sum+fs.statSync(path.join(OUT,item.file)).size,0);
console.log(`\nВ наборе ${all.length} фонов из ${byTopic.size} тем (${(bytes/1048576).toFixed(1)} МБ).`);
console.log(`Добавлено ${fresh.length}, пропущено ${skipped}.`);
console.log('Источник — Викисклад, лицензии и авторы в dist/media/backdrops/CREDITS.json.');
