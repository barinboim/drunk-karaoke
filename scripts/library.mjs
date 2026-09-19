// Index local UltraStar folders into dist/data/library.json. Nothing is copied or downloaded;
// the dev server streams the original files straight from where they already live.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseUltraStar} from '../dist/ultrastar.js';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const DEFAULTS=[path.resolve(ROOT,'..','UltraStar mini songs'),path.join(ROOT,'жуки батарейка'),path.join(ROOT,'Альянс - На Заре')];
const roots=(process.argv.slice(2).length?process.argv.slice(2):DEFAULTS).map(p=>path.resolve(p)).filter(p=>fs.existsSync(p));

const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const full=path.join(dir,entry.name);
  return entry.isDirectory()?walk(full):[full];
});
const read=file=>{
  const bytes=fs.readFileSync(file);
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('windows-1251').decode(bytes);}
};
// Chart titles carry the file variant: "Батарейка   (Минус+Бэк)" is still just "Батарейка".
const VARIANT='минус|minus|бэк|бек|back|дуэт|duet|karaoke|караоке|instrumental|инструментал';
// \b is ASCII-only in JS, so Cyrillic variant tags are peeled off with explicit separators.
const clean=value=>value.replace(/\s+/g,' ')
  .replace(new RegExp(`\\s*[([][^)\\]]*(${VARIANT})[^)\\]]*[)\\]]`,'gi'),'')
  .replace(new RegExp(`[\\s\\-–—+]+((${VARIANT})[\\s+]*)+$`,'gi'),'')
  .replace(/^[-–\s]+|[-–\s+]+$/g,'').trim();
// Some files in the wild are zero-padded wrecks: ffmpeg recovers them by scanning, browsers refuse.
// A track is only offered if a decoder can start at byte 0 — an ID3 tag or an MPEG frame sync.
const playable=file=>{
  if(!/\.mp3$/i.test(file))return true;
  const handle=fs.openSync(file,'r');
  const head=Buffer.alloc(4096);
  const read=fs.readSync(handle,head,0,head.length,0);
  fs.closeSync(handle);
  const buf=head.subarray(0,read);
  if(buf.subarray(0,3).toString('latin1')==='ID3')return true;
  for(let i=0;i<Math.min(buf.length-1,2048);i++)if(buf[i]===0xFF&&(buf[i+1]&0xE0)===0xE0)return true;
  return false;
};
const minusLike=name=>/минус|minus|instrumental|инструментал|^\+|^м[-_ ]|\bм[-_]/i.test(path.basename(name));
const duetLike=name=>/дуэт|duet/i.test(path.basename(name));
const score=(file,kind)=>(minusLike(file)?4:0)+(kind==='chart'&&duetLike(file)?-3:0)+(/бэк|back/i.test(path.basename(file))?1:0);

const songs=[];
roots.forEach((root,index)=>{
  const folders=fs.statSync(root).isDirectory()
    ? fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>path.join(root,e.name))
    : [];
  // A root may itself be one song folder (the project keeps two beside package.json).
  const candidates=folders.length?folders:[root];
  if(folders.length&&walk(root).some(f=>/\.txt$/i.test(f)&&path.dirname(f)===root))candidates.push(root);
  for(const folder of candidates) {
    const files=walk(folder);
    const charts=files.filter(f=>/\.txt$/i.test(f)).sort((a,b)=>score(b,'chart')-score(a,'chart'));
    const tracks=files.filter(f=>/\.(mp3|ogg|m4a|wav|opus)$/i.test(f));
    const audios=tracks.filter(playable);
    if(!charts.length||!tracks.length)continue;
    if(!audios.length){songs.push({folder:path.relative(root,folder)||path.basename(root),skipped:`аудио повреждено (${tracks.length} файл(ов) без заголовка)`});continue;}
    let picked=null;
    for(const chart of charts) {
      let parsed;
      try{parsed=parseUltraStar(read(chart));}catch(error){picked??={error:error.message};continue;}
      // Prefer the audio the chart itself names; fall back to the most instrumental-looking file.
      const named=parsed.media.instrumental||parsed.media.audio;
      const byName=named&&audios.find(a=>path.basename(a).toLowerCase()===named.toLowerCase().trim());
      const sameKind=audios.filter(a=>minusLike(a)===minusLike(chart));
      const audio=byName||(sameKind.length?sameKind:audios).sort((a,b)=>score(b,'audio')-score(a,'audio'))[0];
      // The same folder usually ships the sung version too — handy for hearing how a line goes.
      const vocal=audios.filter(f=>f!==audio&&!minusLike(f)).sort((a,b)=>fs.statSync(b).size-fs.statSync(a).size)[0];
      picked={chart,parsed,audio,vocal};
      break;
    }
    if(!picked||!picked.parsed){songs.push({folder:path.relative(root,folder)||path.basename(root),skipped:picked?.error||'нет разбираемой разметки'});continue;}
    const {chart,parsed,audio,vocal}=picked;
    // #COVER names the sleeve; #BACKGROUND is a video still, so the header wins over file size.
    const images=files.filter(f=>/\.(jpg|jpeg|png|webp)$/i.test(f));
    const named=parsed.media.cover&&images.find(f=>path.basename(f).toLowerCase()===parsed.media.cover.toLowerCase().trim());
    const cover=named||images.sort((a,b)=>fs.statSync(a).size-fs.statSync(b).size)[0];
    const url=file=>`library/${index}/${path.relative(root,file).split(path.sep).map(encodeURIComponent).join('/')}`;
    songs.push({
      id:`${index}-${path.basename(folder).toLowerCase().replace(/[^a-zа-я0-9]+/gi,'-').replace(/^-|-$/g,'')}`,
      artist:clean(parsed.artist)||'Неизвестный исполнитель',
      title:clean(parsed.title)||path.basename(folder),
      chart:url(chart),audio:url(audio),vocal:vocal?url(vocal):'',cover:cover?url(cover):'',
      instrumental:minusLike(audio),
      lines:parsed.lines.length,
      syllables:parsed.lines.reduce((sum,line)=>sum+line.notes.length,0),
      duration:Math.round(parsed.duration),
      voices:parsed.voices,
    });
  }
});

// The same song can sit in several folders; keep the copy that ships an instrumental.
const best=new Map();
for(const song of songs.filter(s=>!s.skipped)) {
  const key=`${song.artist}|${song.title}`.toLowerCase();
  const rival=best.get(key);
  if(!rival||(song.instrumental&&!rival.instrumental)||(song.instrumental===rival.instrumental&&song.lines>rival.lines))best.set(key,song);
}
const ready=[...best.values()].sort((a,b)=>a.artist.localeCompare(b.artist,'ru')||a.title.localeCompare(b.title,'ru'));
const skipped=songs.filter(s=>s.skipped);
fs.writeFileSync(path.join(ROOT,'dist/data/library.json'),JSON.stringify({roots,songs:ready},null,1),'utf8');
console.log(`Проиндексировано ${ready.length} песен из ${roots.length} папок; с минусовкой ${ready.filter(s=>s.instrumental).length}.`);
for(const song of skipped)console.log(`  пропущено: ${song.folder} — ${song.skipped.slice(0,70)}`);
