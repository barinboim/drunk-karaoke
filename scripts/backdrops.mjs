// Собирает базу «не в попад» фонов с Викисклада: павлины, водопады, Пизанская башня.
// Ключей не нужно, всё свободно лицензировано. Картинки намеренно портятся до вида
// дешёвого караоке-диска: мелкий кадр и низкое качество JPEG дают крупные артефакты.
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

// Тот самый набор сюжетов с караоке-кассет.
const TOPICS=[
  'Peafowl','Waterfalls','Sunsets','Beaches','Dolphins','Swans','Kittens','Roses',
  'Leaning Tower of Pisa','Eiffel Tower','Palm trees','Flamingos','Butterflies',
  'Horses in art','Donkeys','Windmills','Fountains','Hot air balloons','Lighthouses',
  'Castles','Autumn leaves','Rainbows','Sailing boats','Mountain lakes','Tigers',
  'Parrots','Tulips','Bridges at night','Swimming pools','Deer',
];

const WANTED=Number(process.argv[2]||200);
const PER_TOPIC=Math.max(6,Math.ceil(WANTED/TOPICS.length)+6);

async function api(params){
  const url=`${API}?${new URLSearchParams({format:'json',formatversion:'2',...params})}`;
  const response=await fetch(url,{headers:{'User-Agent':AGENT}});
  if(!response.ok)throw Error(`Викисклад ответил ${response.status}`);
  return response.json();
}

async function listTopic(topic){
  const data=await api({
    action:'query',generator:'categorymembers',gcmtitle:`Category:${topic}`,
    gcmtype:'file',gcmlimit:String(PER_TOPIC*3),
    prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'900',
  }).catch(()=>null);
  const pages=data?.query?.pages||[];
  return pages.map(page=>{
    const info=page.imageinfo?.[0];
    if(!info?.thumburl||!/\.(jpe?g|png)$/i.test(page.title))return null;
    const meta=info.extmetadata||{};
    const strip=value=>String(value||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
    return {
      topic,title:page.title.replace(/^File:/,''),
      thumb:info.thumburl,page:info.descriptionurl,
      license:strip(meta.LicenseShortName?.value)||'см. страницу файла',
      author:strip(meta.Artist?.value).slice(0,120)||'не указан',
    };
  }).filter(Boolean).slice(0,PER_TOPIC);
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
const credits=[];
let saved=0,skipped=0;

for(const topic of TOPICS){
  if(saved>=WANTED)break;
  let items=[];
  try{items=await listTopic(topic);}catch(error){console.log(`  ${topic}: ${error.message}`);continue;}
  let fromTopic=0;
  for(const item of items){
    if(saved>=WANTED)break;
    try{
      const response=await fetch(item.thumb,{headers:{'User-Agent':AGENT}});
      if(!response.ok){skipped++;continue;}
      const buffer=Buffer.from(await response.arrayBuffer());
      if(buffer.length<8000){skipped++;continue;}
      const name=`${String(saved+1).padStart(3,'0')}.jpg`;
      if(!await degrade(buffer,path.join(OUT,name))){skipped++;continue;}
      credits.push({file:name,...item});
      saved++;fromTopic++;
    }catch{skipped++;}
  }
  console.log(`  ${topic}: +${fromTopic}`);
}

fs.writeFileSync(path.join(OUT,'index.json'),JSON.stringify(credits.map(c=>c.file),null,1),'utf8');
fs.writeFileSync(path.join(OUT,'CREDITS.json'),JSON.stringify(credits,null,1),'utf8');
const bytes=credits.reduce((sum,c)=>sum+fs.statSync(path.join(OUT,c.file)).size,0);
console.log(`\nСобрано ${saved} фонов (${(bytes/1048576).toFixed(1)} МБ), пропущено ${skipped}.`);
console.log('Источник — Викисклад, лицензии и авторы в dist/media/backdrops/CREDITS.json.');
