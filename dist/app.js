import {positionAt,originalVersion,parseCorpusFile} from './engine.js';
import {parseUltraStar} from './ultrastar.js';
import {Studio} from './studio.js';
import {initFeedback,noteStep} from './feedback.js';

const $=id=>document.getElementById(id);
const audio=$('audio');
const PER_PAGE=15;
// Список датасетов приходит из dist/corpora/index.json — его собирает npm run corpora.
// Чтобы добавить датасет, достаточно положить .txt в папку: код править не нужно.
const CORPORA={original:{name:'Оригинальный текст песни',plain:true}};

let library=[],filtered=[],page=0;
let entry=null,song=null,version=[],stats=null;
let corpusText='',corpusName='',corpusKey='';
let seed=Number(localStorage.getItem('dk.seed'))||crypto.getRandomValues(new Uint32Array(1))[0];
let offset=Number(localStorage.getItem('dk.offset'))||0;
let showNext=localStorage.getItem('dk.next')!=='0';
let showOriginal=localStorage.getItem('dk.original')!=='0';
let lastView='',audioObjectURL=null;

/* ---------- worker ---------- */
const worker=new Worker('worker.js',{type:'module'}),pending=new Map();let requestId=0;
worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job)return;pending.delete(data.id);data.error?job.reject(Error(data.error)):job.resolve(data);};
worker.onerror=()=>{for(const job of pending.values())job.reject(Error('Не удалось запустить локальный подбор текста.'));pending.clear();};
const compute=payload=>new Promise((resolve,reject)=>{const id=++requestId;pending.set(id,{resolve,reject});worker.postMessage({...payload,id});});

/* ---------- small helpers ---------- */
const time=t=>`${Math.floor(Math.max(0,t)/60)}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`;
const fail=error=>{
  $('error').textContent=error.message||String(error);$('error').hidden=false;
  noteStep(`ошибка: ${error.message||error}`);
};
const clearError=()=>{$('error').hidden=true;};
const busy=value=>{for(const id of ['shuffle','corpus','corpusFile','songFiles'])$(id).disabled=value;$('shuffle').innerHTML=value?'Подбираем…':'<span class="glyph">⟳</span> Пересобрать';};
async function read(url,type='text'){
  const response=await fetch(url);
  if(!response.ok)throw Error(`Не удалось загрузить ${decodeURIComponent(url)}`);
  return response[type]();
}
async function fileText(file){
  if(file.size>20*1024*1024)throw Error('Выбери текстовый файл до 20 МБ.');
  const bytes=await file.arrayBuffer();
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('windows-1251').decode(bytes);}
}

/* ---------- library screen ---------- */
function applyFilter(){
  const query=$('search').value.trim().toLowerCase();
  filtered=query?library.filter(s=>`${s.artist} ${s.title}`.toLowerCase().includes(query)):library;
  page=Math.min(page,Math.max(0,Math.ceil(filtered.length/PER_PAGE)-1));
  renderChannels();
}
function renderChannels(){
  const pages=Math.max(1,Math.ceil(filtered.length/PER_PAGE));
  const slice=filtered.slice(page*PER_PAGE,page*PER_PAGE+PER_PAGE);
  const deck=$('channels');deck.replaceChildren();
  slice.forEach(item=>{
    const button=document.createElement('button');
    button.className='channel';button.title=`${item.artist} — ${item.title}`;
    const face=document.createElement('span');face.className='channel-face';
    if(item.cover)face.style.backgroundImage=`url("${item.cover}")`;
    const label=document.createElement('span');label.className='channel-label';
    const title=document.createElement('b');title.textContent=item.title;
    const artist=document.createElement('i');artist.textContent=item.artist;
    label.append(title,artist);button.append(face,label);
    button.addEventListener('click',()=>chooseSong(item));
    deck.append(button);
  });
  const columns=Number(getComputedStyle(deck).getPropertyValue('--columns'))||5;
  for(let i=slice.length%columns;i&&i<columns;i++){const filler=document.createElement('span');filler.className='channel channel-empty';deck.append(filler);}
  $('prevPage').disabled=page===0;$('nextPage').disabled=page>=pages-1;
  const dots=$('pageDots');dots.replaceChildren();
  for(let i=0;i<pages;i++){
    const dot=document.createElement('span');
    if(i===page)dot.className='on';
    dot.addEventListener('click',()=>{page=i;renderChannels();});
    dots.append(dot);
  }
  const word=filtered.length%10===1&&filtered.length%100!==11?'песня':'песен';
  $('screenCount').textContent=filtered.length?`${filtered.length} ${word}`:'';
  $('libraryNote').textContent=filtered.length
    ?`страница ${page+1} из ${pages}`
    :'Ничего не нашлось. Проверь запрос или выполни npm run library.';
  $('searchClear').hidden=!$('search').value;
}
function showScreen(name){
  $('libraryScreen').hidden=name!=='library';
  $('stageScreen').hidden=name!=='stage';
  noteStep(`экран: ${name}`);
}

/* ---------- loading a song ---------- */
// Режим выбирается до входа в игру, поэтому внутри этих кнопок уже нет.
let awaiting=null,micId='';
function chooseSong(item){
  awaiting=item;
  $('pickerTitle').textContent=`${item.artist} — ${item.title}`;
  $('pickerOriginal').checked=corpusKey==='original';
  if(corpusKey!=='original')$('pickerCorpus').value=corpusKey;
  paintPickerSource();
  $('picker').hidden=false;
  listMics();
}
function closePicker(){$('picker').hidden=true;awaiting=null;}

// Список микрофонов приходит без названий, пока не выдан доступ, — поэтому
// сначала предлагаем разрешить, а потом показываем настоящие имена устройств.
async function listMics(){
  const select=$('pickerMic'),note=$('micNote'),allow=$('micAllow');
  if(!navigator.mediaDevices?.enumerateDevices){
    note.textContent='Браузер не умеет записывать звук.';allow.hidden=true;return;
  }
  let devices=[];
  try{devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');}catch{}
  const named=devices.filter(device=>device.label);
  select.replaceChildren();
  if(!named.length){
    select.append(new Option('по умолчанию',''));
    note.className='picker-note';
    note.textContent='Для записи нужен доступ к микрофону.';
    allow.hidden=false;
    return;
  }
  for(const device of named)select.append(new Option(device.label,device.deviceId));
  if(micId&&named.some(device=>device.deviceId===micId))select.value=micId;
  micId=select.value;
  note.className='picker-note ok';
  note.textContent=`Доступ есть, устройств: ${named.length}.`;
  allow.hidden=true;
}
$('micAllow').addEventListener('click',async()=>{
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    stream.getTracks().forEach(track=>track.stop());
    await listMics();
  }catch(error){
    $('micNote').className='picker-note';
    $('micNote').textContent=`Доступ не выдан: ${error.message}. Петь без записи всё равно можно.`;
  }
});
$('pickerMic').addEventListener('change',event=>{micId=event.target.value;});
// Корпус наугад: выбирать из списка каждый раз долго, а суть игры в неожиданности.
// Оригинал — не пункт списка, а отдельная галочка: она перебивает выбор источника.
function paintPickerSource(){
  const own=$('pickerOriginal').checked;
  $('pickerCorpus').closest('.picker-field').classList.toggle('dimmed',own);
  $('corpusDice').disabled=own;
}
$('pickerOriginal').addEventListener('change',paintPickerSource);
$('corpusDice').addEventListener('click',()=>{
  if($('pickerOriginal').checked)return;
  const select=$('pickerCorpus');
  const options=[...select.options].filter(option=>option.value!==select.value);
  if(!options.length)return;
  select.value=options[Math.floor(Math.random()*options.length)].value;
  $('corpusDice').animate([{transform:'rotate(0)'},{transform:'rotate(360deg)'}],{duration:400,easing:'ease-out'});
});
for(const button of document.querySelectorAll('.picker-choice'))
  button.addEventListener('click',async()=>{
    const item=awaiting,mode=button.dataset.mode;
    const key=$('pickerOriginal').checked?'original':$('pickerCorpus').value;
    closePicker();
    if(!item)return;
    if(key!==corpusKey){try{await loadCorpus(key);}catch(error){return fail(error);}}
    openSong(item,mode);
  });
$('pickerCancel').addEventListener('click',closePicker);
$('picker').addEventListener('click',event=>{if(event.target===$('picker'))closePicker();});

async function openSong(item,mode='live'){
  try{
    clearError();
    busy(true);
    $('libraryNote').textContent=`Готовим «${item.title}»…`;
    const chart=await read(item.chart);
    const next=parseUltraStar(chart);
    if(!corpusText)await loadCorpus(corpusKey);
    const corpusMode=corpusKey==='original'?undefined:parseCorpusFile(corpusText).meta.mode;
    const done=await reroll(crypto.getRandomValues(new Uint32Array(1))[0],{song:next,text:corpusText,mode:corpusMode});
    if(!done)return;
    entry=item;song=next;vocalOn=false;cuedLine=-1;stopHear();shuffleBackdrops();$('corpus').value=corpusKey;studio.open(mode,micId);
    if(audioObjectURL){URL.revokeObjectURL(audioObjectURL);audioObjectURL=null;}
    audio.src=item.audio;
    $('seek').max=song.duration;
    showScreen('stage');
    refresh();
    for(const id of ['play','toVoice'])$(id).disabled=false;
  }catch(error){fail(error);showScreen('library');}
  finally{busy(false);applyFilter();}
}
async function loadCorpus(key){
  if(CORPORA[key].plain){corpusName=CORPORA[key].name;corpusKey=key;corpusText='';return;}
  let text;
  try{text=await read(CORPORA[key].file);}
  catch{throw Error(`Датасет «${CORPORA[key].name}» не загрузился. Выполни npm run corpora или загрузи свой .txt.`);}
  corpusName=CORPORA[key].name;corpusKey=key;corpusText=text;
}

async function reroll(nextSeed,payload={}){
  busy(true);
  try{
    // Обычное караоке считается на месте: воркер и словарь для него не нужны.
    if(CORPORA[corpusKey]?.plain){
      const target=payload.song||song;
      if(!target)throw Error('Сначала выбери песню');
      const made=originalVersion(target);
      audio.pause();audio.currentTime=0;
      version=made.lines;stats=made.stats;seed=nextSeed;lastView='';clearError();
      return true;
    }
    const result=await compute({...payload,seed:nextSeed});
    audio.pause();audio.currentTime=0;
    version=result.version;stats=result.stats;seed=nextSeed;
    localStorage.setItem('dk.seed',seed);lastView='';clearError();
    return true;
  }catch(error){fail(error);return false;}
  finally{busy(false);}
}

/* ---------- backdrop: someone else's cover art, deliberately not this song ---------- */
let backdrops=[],backdropAt=0,backdropUntil=0,stock=[];
const shuffle=list=>{const out=[...list];for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;};
function shuffleBackdrops(){
  // Первым кадром — обложка самой песни, дальше только павлины и водопады из набора.
  const nonsense=shuffle(stock);
  backdrops=entry?.cover?[entry.cover,...nonsense]:nonsense;
  backdropAt=0;backdropUntil=0;
}
function stepBackdrop(now){
  if(!backdrops.length||now<backdropUntil)return;
  const holder=$('backdrop');
  holder.style.backgroundImage=`url("${backdrops[backdropAt%backdrops.length]}")`;
  holder.classList.remove('fade');void holder.offsetWidth;holder.classList.add('fade','zoom');
  backdropAt++;backdropUntil=now+9+Math.random()*5;
}

/* ---------- stage rendering ---------- */
// Accent marks steer the matching; on stage they are noise, so they are stripped for reading only.
const plain=value=>value.replace(/\u0301/g,'');

// Кружки вступления. Четыре штуки на четыре секунды — ровно как счёт «раз-два-три-четыре»,
// поэтому закрашивание читается как темп, а не просто как убывающий остаток.
const CUE_LEAD=4;
let cueDots=null;
function cueRow(){
  if(cueDots)return cueDots;
  cueDots=Array.from({length:CUE_LEAD},()=>{
    const dot=document.createElement('span');
    dot.append(document.createElement('i'));
    return dot;
  });
  $('cueDots').append(...cueDots);
  return cueDots;
}
function renderSyllables(index){
  const line=version[index],holder=$('lyric');
  holder.replaceChildren();
  if(!line)return;
  const starts=new Set(line.itemStarts);
  let item=null,word=null;
  line.syllables.forEach((part,i)=>{
    const text=plain(part);
    if(starts.has(i)||!item){item=document.createElement('span');item.className='item';holder.append(item);word=null;}
    if(!word||/^\s/.test(text)){
      if(word)item.append(document.createTextNode(' '));   // keep the gap the syllable carried
      word=document.createElement('span');word.className='word';item.append(word);
    }
    const span=document.createElement('span');
    span.className='syllable';span.dataset.index=i;span.textContent=text.replace(/^\s+/,'');
    word.append(span);
  });
}
function renderList(){
  const list=$('allLines');list.replaceChildren();
  song.lines.forEach((line,i)=>{
    const li=document.createElement('li'),button=document.createElement('button');
    const stamp=document.createElement('small');stamp.textContent=time(line.start);
    const text=document.createElement('span');text.textContent=plain(version[i]?.text||'');
    button.append(stamp,text);
    if(version[i]?.repeat){const mark=document.createElement('span');mark.className='repeat';mark.textContent='↺';button.append(mark);}
    button.addEventListener('click',()=>{stopHear();audio.currentTime=Math.max(0,line.start-offset-.5);play();});
    li.append(button);
    if(entry?.vocal){
      const hear=document.createElement('button');
      hear.className='hear';hear.textContent='♪';
      hear.title='Послушать эту фразу с вокалом';
      hear.addEventListener('click',event=>{event.stopPropagation();previewUntil&&preview.currentTime<previewUntil&&preview.src?stopHear():hearLine(i);});
      li.append(hear);
    }
    list.append(li);
  });
  $('seedLabel').textContent=`версия ${seed.toString(16).toUpperCase()}`;
}
function refresh(){
  const plainMode=Boolean(CORPORA[corpusKey]?.plain);
  $('shuffle').style.display=plainMode?'none':'';
  const name=`${entry?.artist||song.artist} — ${entry?.title||song.title}`;
  document.title=`Пьяное караоке · ${entry?.title||song.title}`;
  $('tvTitle').textContent=name;
  $('trackTitle').textContent=`${name}${entry&&!entry.instrumental?' · с вокалом':''}`;
  $('corpusBadge').textContent=corpusName.toUpperCase();
  const groups=stats?.groups??version.length;
  $('stats').textContent=plainMode
    ?`${song.lines.length} строк песни · ${stats.words.toLocaleString('ru')} слов · подбор не выполняется`
    :`${stats.records.toLocaleString('ru')} записей корпуса · ${stats.words.toLocaleString('ru')} слов · ${stats.sections.length} разделов · ${groups} разных строк на ${song.lines.length} строк песни`;
  $('unknowns').textContent=`Без ударения в корпусе: ${stats.unknownWords.join(', ')||'нет'}. В песне: ${stats.songUnknownWords.join(', ')||'нет'}. Неоднозначные словоформы: ${stats.ambiguousWords.slice(0,40).join(', ')||'нет'}.`;
  paintVocal();renderList();update();
}
function update(){
  if(!song||!version.length)return;
  const current=audio.currentTime,clockTime=current+offset,state=positionAt(song.lines,clockTime);
  const display=state.active>=0?state.active:state.next;
  const finished=display<0;
  const key=`${display}:${showOriginal}`;
  if(key!==lastView){
    lastView=key;
    if(display>=0)renderSyllables(display);
    else $('lyric').textContent='';
    // В обычном караоке мелкая строка повторила бы крупную — прячем.
    const twin=Boolean(CORPORA[corpusKey]?.plain);
    $('originalLine').textContent=display>=0&&showOriginal&&!twin?song.lines[display].original:'';
    $('originalLine').hidden=!(display>=0&&showOriginal&&!twin);
    const next=display>=0&&display+1<song.lines.length?display+1:-1;
    $('nextLine').textContent=showNext&&next>=0?plain(version[next].text):'';
    $('nextLine').hidden=!showNext||next<0;
  }
  const gap=state.active<0&&display>=0?song.lines[display].start-clockTime:-1;
  const counting=!finished&&gap>0&&gap<=CUE_LEAD;
  $('phase').textContent=finished?'ГОТОВО':state.active>=0?'ПОЁМ':display===0?'ВСТУПЛЕНИЕ':'ПРОИГРЫШ';
  // Долгий проигрыш — цифрой, последние секунды — кружками: цифра там меняется слишком
  // редко, чтобы по ней поймать момент.
  $('cue').textContent=finished||state.active>=0||gap<=CUE_LEAD?'':`вступай через ${Math.ceil(gap)} с`;
  $('cueDots').hidden=!counting;
  if(counting){
    const done=CUE_LEAD-gap;   // один кружок — одна секунда
    cueRow().forEach((dot,index)=>{
      const fill=Math.max(0,Math.min(1,done-index));
      dot.style.setProperty('--fill',fill.toFixed(3));
      dot.classList.toggle('full',fill>=1);
    });
  }
  $('lineCount').textContent=finished?`${song.lines.length} / ${song.lines.length}`:`СТРОКА ${display+1} / ${song.lines.length}`;
  // Внизу справа только то, что нужно поющему: припев ли это и сколько осталось.
  const left=Math.max(0,(audio.duration||song.duration)-current);
  $('fit').textContent=finished?''
    :`${display>=0&&version[display].repeat?'ПРИПЕВ · ':''}ОСТАЛОСЬ ${time(left)}`;
  const notes=song.lines[display]?.notes;
  if(notes)for(const span of $('lyric').querySelectorAll('.syllable')){
    const note=notes[Number(span.dataset.index)];
    let filled=0;
    if(state.active===display&&note){
      if(clockTime>=note.end)filled=100;
      else if(clockTime>=note.start)filled=100*(clockTime-note.start)/Math.max(.05,note.end-note.start);
    }
    span.style.setProperty('--p',`${filled}%`);
    span.classList.toggle('sung',filled>=100);
  }
  stepBackdrop(current);
  if(previewUntil&&preview.currentTime>=previewUntil)stopHear();
  const total=Number.isFinite(audio.duration)?audio.duration:song.duration;
  $('time').innerHTML=`${time(current)} <i>/ ${time(total)}</i>`;
  $('seek').value=current;
  $('progress').style.width=`${Math.min(100,100*current/(total||1))}%`;
}

/* ---------- the sung version: the same recording with the voice left in ---------- */
let vocalOn=false;
const preview=new Audio();
let previewUntil=0;
function swapTrack(useVocal){
  const url=useVocal?entry?.vocal:entry?.audio;
  if(!url)return;
  const at=audio.currentTime,playing=!audio.paused;
  vocalOn=useVocal;
  audio.src=url;
  audio.addEventListener('loadedmetadata',()=>{
    audio.currentTime=at;
    if(playing)audio.play().catch(()=>{});
  },{once:true});
  paintVocal();
}
function paintVocal(){
  const button=$('vocalToggle');
  const has=Boolean(entry?.vocal&&entry?.audio&&entry.vocal!==entry.audio);
  button.disabled=!has;
  // Кнопка всегда подписана «Плюс» и работает выключателем: горит зелёным — звучит вокал,
  // погасла — минусовка. Прежняя подпись менялась на «Минус» и читалась ровно наоборот:
  // как название того, что играет сейчас, а не того, что будет по нажатию.
  button.innerHTML='<span class="glyph">♪</span> Плюс';
  button.classList.toggle('blue',has&&vocalOn);
  button.setAttribute('aria-pressed',String(has&&vocalOn));
  button.title=has
    ?(vocalOn?'Плюс включён: звучит версия с вокалом. Нажми, чтобы вернуться к минусовке'
             :'Включить плюс: послушать, как эту песню поют')
    :'У этой песни в папке только одна дорожка';
}
// Одна музыкальная фраза с вокалом, поверх ничего: слышно, как её тянуть.
function hearLine(index){
  const url=entry?.vocal||entry?.audio;
  if(!url)return;
  const line=song.lines[index];
  audio.pause();
  const absolute=new URL(url,location.href).href;
  if(preview.src!==absolute)preview.src=url;
  previewUntil=line.end+.25;
  const start=Math.max(0,line.start-.35);
  const go=()=>{preview.currentTime=start;preview.play().catch(()=>{});paintHear(index);};
  preview.readyState>=1?go():preview.addEventListener('loadedmetadata',go,{once:true});
}
function stopHear(){preview.pause();previewUntil=0;paintHear(-1);}
function paintHear(active){
  $('allLines').querySelectorAll('.hear').forEach((button,i)=>button.classList.toggle('on',i===active));
}

/* ---------- playback ---------- */
async function play(){
  try{clearError();if(audio.ended)audio.currentTime=0;await audio.play();}
  catch(error){
    const broken=/no supported sources|not suitable|could not be decoded/i.test(error.message);
    fail(Error(broken
      ?`Аудиофайл этой песни не открывается — похоже, он повреждён. Выбери другую песню или перезапусти npm run library.`
      :`Не удалось включить аудио: ${error.message}`));
  }
}
const toggle=()=>audio.paused?play():audio.pause();
$('play').addEventListener('click',toggle);
audio.addEventListener('play',()=>{$('play').textContent='❚❚';$('play').setAttribute('aria-label','Пауза');});
audio.addEventListener('pause',()=>{$('play').textContent='▶';$('play').setAttribute('aria-label','Воспроизвести');});
audio.addEventListener('error',()=>{
  if(!audio.src)return;
  const name=decodeURIComponent(audio.src.split('/').pop());
  fail(Error(`Браузер не смог открыть «${name}». Скорее всего файл повреждён — перезапусти npm run library, чтобы индекс выбрал другую дорожку из той же папки.`));
});
audio.addEventListener('loadedmetadata',()=>{if(Number.isFinite(audio.duration))$('seek').max=audio.duration;});
$('seek').addEventListener('input',event=>{audio.currentTime=Number(event.target.value);update();});
// Прыжок к следующей реплике, а не всегда к началу вокала: с длинными проигрышами
// иначе не порепетируешь отдельный кусок. Помним, к чему уже подвели: иначе повторное
// нажатие в подводке снова считало бы ту же реплику «следующей».
let cuedLine=-1;
$('toVoice').addEventListener('click',()=>{
  if(!song)return;
  const now=audio.currentTime+offset;
  const waiting=cuedLine>=0&&cuedLine<song.lines.length
    &&now<song.lines[cuedLine].start&&song.lines[cuedLine].start-now<=3;
  let target;
  if(waiting)target=Math.min(song.lines.length-1,cuedLine+1);
  else{
    const found=song.lines.findIndex(line=>line.start>now+.35);
    target=found>=0?found:0;
  }
  const floor=target>0?song.lines[target-1].end:0;          // не заезжаем в предыдущую реплику
  const lead=Math.min(2,Math.max(.4,song.lines[target].start-floor));
  stopHear();
  cuedLine=target;
  audio.currentTime=Math.max(0,song.lines[target].start-offset-lead);
  play();
});
const paintVolume=()=>{$('volumeValue').textContent=`${Math.round(audio.volume*100)}%`;};
audio.volume=Number(localStorage.getItem('dk.volume')??0.8);
$('volume').value=audio.volume;paintVolume();
$('volume').addEventListener('input',event=>{
  audio.volume=Number(event.target.value);
  localStorage.setItem('dk.volume',audio.volume);
  paintVolume();
});

/* ---------- controls ---------- */
$('search').addEventListener('input',()=>{page=0;applyFilter();});
$('searchClear').addEventListener('click',()=>{$('search').value='';page=0;applyFilter();$('search').focus();});
$('prevPage').addEventListener('click',()=>{if(page>0){page--;renderChannels();}});
$('nextPage').addEventListener('click',()=>{if((page+1)*PER_PAGE<filtered.length){page++;renderChannels();}});
const goHome=()=>{studio.stopEverything();stopHear();audio.pause();showScreen('library');document.title='Пьяное караоке';};
$('homeButton').addEventListener('click',goHome);
$('brandHome').addEventListener('click',goHome);
$('shuffle').addEventListener('click',async()=>{if(await reroll(crypto.getRandomValues(new Uint32Array(1))[0]))refresh();});
$('vocalToggle').addEventListener('click',()=>swapTrack(!vocalOn));
$('corpus').addEventListener('change',async event=>{
  const key=event.target.value;
  try{
    busy(true);
    await loadCorpus(key);
    if(song&&await reroll(crypto.getRandomValues(new Uint32Array(1))[0],{song,text:corpusText}))refresh();
  }catch(error){fail(error);}finally{busy(false);}
});
$('offset').value=offset;$('offsetValue').textContent=`${offset.toFixed(2)} с`;
$('offset').addEventListener('input',event=>{
  offset=Number(event.target.value);localStorage.setItem('dk.offset',offset);
  $('offsetValue').textContent=`${offset>0?'+':''}${offset.toFixed(2)} с`;lastView='';update();
});
$('showNext').checked=showNext;
$('showNext').addEventListener('change',event=>{showNext=event.target.checked;localStorage.setItem('dk.next',showNext?'1':'0');lastView='';update();});
$('showOriginal').checked=showOriginal;
$('showOriginal').addEventListener('change',event=>{showOriginal=event.target.checked;localStorage.setItem('dk.original',showOriginal?'1':'0');lastView='';update();});
for(const [button,panel] of [['settingsButton','settings'],['textButton','textPanel']])
  $(button).addEventListener('click',()=>{$(panel).hidden=!$(panel).hidden;$(button).setAttribute('aria-expanded',String(!$(panel).hidden));});
document.addEventListener('keydown',event=>{
  if(event.code==='Space'&&!['INPUT','SELECT','TEXTAREA','BUTTON'].includes(event.target.tagName)){event.preventDefault();if(song&&!$('stageScreen').hidden)toggle();}
  if(event.key==='Escape'&&!$('stageScreen').hidden)$('homeButton').click();
});

/* ---------- local imports ---------- */
$('corpusFile').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    const text=await fileText(file);
    if(song&&!await reroll(crypto.getRandomValues(new Uint32Array(1))[0],{song,text}))return;
    corpusText=text;corpusName=file.name.replace(/\.txt$/i,'');corpusKey='custom';
    const option=[...$('corpus').options].find(o=>o.value==='custom')||new Option(corpusName,'custom');
    option.textContent=corpusName;if(!option.parentNode)$('corpus').append(option);
    $('corpus').value='custom';
    if(song)refresh();
  }catch(error){fail(error);}
  event.target.value='';
});
for(const id of ['songFiles','welcomeFiles'])$(id).addEventListener('change',async event=>{
  const files=[...event.target.files];
  const chart=files.find(f=>/\.txt$/i.test(f.name)),track=files.find(f=>/\.(mp3|ogg|wav|m4a)$/i.test(f.name));
  try{
    if(!chart||!track)throw Error('Выбери вместе UltraStar .txt и аудио .mp3, .ogg, .wav или .m4a.');
    const next=parseUltraStar(await fileText(chart));
    if(!corpusText)await loadCorpus(corpusKey);
    if(await reroll(crypto.getRandomValues(new Uint32Array(1))[0],{song:next,text:corpusText})){
      song=next;entry=null;shuffleBackdrops();
      if(audioObjectURL)URL.revokeObjectURL(audioObjectURL);
      audioObjectURL=URL.createObjectURL(track);audio.src=audioObjectURL;
      $('seek').max=song.duration;showScreen('stage');refresh();
      for(const id of ['play','toVoice'])$(id).disabled=false;
    }
  }catch(error){fail(error);}
  event.target.value='';
});
$('export').addEventListener('click',()=>{
  const data={algorithm:'whole-record-run-beam-v2',seed,song:`${song.artist} — ${song.title}`,corpus:corpusName,stats,
    lines:version.map((line,i)=>({text:line.text,items:line.items,section:line.section,repeat:line.repeat,
      syllables:line.syllables,fit:line.fit,rhymeFit:line.rhymeFit,source:[line.start,line.end],
      original:song.lines[i].original,start:song.lines[i].start}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=`karaoke-${seed}.json`;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});

/* ---------- оценка вне потока интерфейса ---------- */
const judge=new Worker('scorer.js',{type:'module'});
const judging=new Map();let judgeId=0;
judge.onmessage=({data})=>{const job=judging.get(data.id);if(!job)return;judging.delete(data.id);
  data.error?job.reject(Error(data.error)):job.resolve(data.result);};
judge.onerror=()=>{for(const job of judging.values())job.reject(Error('Оценка не запустилась'));judging.clear();};
function score(takes,lines){
  return new Promise((resolve,reject)=>{
    const id=++judgeId;judging.set(id,{resolve,reject});
    // копии буферов: передавать оригиналы нельзя, дубли ещё понадобятся для сведения
    const payload=takes.map(take=>({samples:take.samples.slice(),sampleRate:take.sampleRate,at:take.at,line:take.line??null}));
    judge.postMessage({id,takes:payload,lines},payload.map(take=>take.samples.buffer));
  });
}

/* ---------- студия ---------- */
const studio=new Studio({
  audio,$,fail,hearLine,stopHear,score,
  song:()=>song,entry:()=>entry,version:()=>version,
  backdrops:()=>(stock.length?stock:backdrops),
});

/* ---------- обратная связь ---------- */
// Форма сама снимет состояние игры в момент отправки: спрашивать у человека,
// какая была песня и какой корпус, бессмысленно — он уже нажал «пересобрать».
initFeedback(()=>({
  'песня':entry?`${entry.artist||''} — ${entry.title||''}`.trim():'не выбрана',
  'корпус':corpusName||corpusKey||'—',
  'строк':song?song.lines.length:undefined,
  'язык песни':song?.language,
  'версия подбора':seed,
  'смещение':offset||undefined,
  'экран':$('stageScreen').hidden?'выбор песни':'сцена',
  'режим студии':studio?.mode,
  'дорожка':vocalOn?'вокал':'минусовка',
}));

/* ---------- boot ---------- */
(function frame(){update();studio.tick(audio.currentTime);requestAnimationFrame(frame);})();
try{
  // Датасеты: что лежит в папке, то и в игре.
  const manifest=await read('corpora/index.json','json').catch(()=>[]);
  for(const item of manifest)
    CORPORA[item.id]={file:`corpora/${item.file}`,name:item.name,about:item.about};
  for(const select of [$('pickerCorpus'),$('corpus')]){
    select.replaceChildren();
    // В карточке режима оригинал — галочка, а в игре его удобно включать списком.
    if(select===$('corpus'))select.append(new Option(CORPORA.original.name,'original'));
    for(const item of manifest){
      const option=new Option(item.name,item.id);
      if(item.about)option.title=item.about;
      select.append(option);
    }
  }
  if(!corpusKey)corpusKey=manifest[0]?.id||'original';
  let index=null;
  try{index=await read('data/library.json','json');}catch{index=null;}
  library=index?.songs||[];filtered=library;
  stock=await read('media/backdrops/index.json','json').then(list=>list.map(name=>`media/backdrops/${name}`)).catch(()=>[]);
  for(const key of Object.keys(CORPORA)){
    if(CORPORA[key].plain)continue;
    try{await loadCorpus(key);break;}catch{}
  }
  applyFilter();
  showScreen('library');
  // Библиотеки нет — значит это опубликованная версия: зовём принести свою песню.
  // Спойлер со своей разметкой раскрыт сам, только если петь нечего: иначе он занимает строку.
  $('welcome').open=library.length===0;
  if(!library.length){$('libraryNote').textContent='';$('screenCount').textContent='';}
}catch(error){
  fail(error);
  $('libraryNote').textContent='Не удалось подготовить приложение.';
}
