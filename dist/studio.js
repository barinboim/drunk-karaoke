// Пульт записи: работа идёт с одной музыкальной репликой. Можно ходить по репликам,
// слушать оригинал, писать дубль сколько угодно раз и свести всё в один файл.
// Громкость минусовки в транспорте — она же мастер сведения: насколько приглушил
// музыку при пении, настолько она приглушена и в дубле, и в итоговом файле.
import {MicRecorder,audioContext,toBuffer,normalize,TAIL} from './recorder.js';
import {decode,mixSong,bufferToWav,sliceBuffer} from './mixer.js';
import {renderVideo,SHAPES} from './video.js';

const COUNT_IN=3.2;          // сколько секунд музыки играет до вступления
const plain=value=>String(value||'').replace(/́/g,'');
const clock=t=>`${Math.floor(Math.max(0,t)/60)}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`;

export class Studio {
  constructor(context){
    this.ctx=context;                  // {audio,$,song,entry,version,fail,hearLine,stopHear}
    this.mode='live';                  // live | takes | full
    this.takes=new Map();              // индекс реплики → дубль ('all' для целой песни)
    this.state='idle';                 // idle | recording | playing
    this.target=0;
    this.mic=new MicRecorder();
    this.backing=null;this.backingFor='';
    this.stopAt=0;this.markAt=0;this.ring=0;this.startedAt=0;
    this.source=null;
    this.#wire();
  }

  get $(){return this.ctx.$;}
  get audio(){return this.ctx.audio;}
  get song(){return this.ctx.song();}
  get lines(){return this.song?.lines||[];}
  get recorded(){return [...this.takes.keys()].filter(key=>key!=='all').length;}
  get key(){return this.mode==='full'?'all':this.target;}
  /** Насколько приглушена минусовка сейчас — столько же её будет в сведении. */
  get musicGain(){return Math.max(0,Math.min(1,this.audio.volume));}

  #wire(){
    for(const button of document.querySelectorAll('.mode'))
      button.addEventListener('click',()=>this.setMode(button.dataset.mode));
    this.$('studioRec').addEventListener('click',()=>this.state==='recording'?this.finish():this.arm());
    this.$('studioPlay').addEventListener('click',()=>this.review());
    this.$('studioOrig').addEventListener('click',()=>this.hearOriginal());
    this.$('studioDrop').addEventListener('click',()=>this.drop());
    this.$('studioExport').addEventListener('click',()=>this.openSaver());
    this.$('studioScore').addEventListener('click',()=>this.showScore());
    this.$('scoreClose').addEventListener('click',()=>{this.$('scoreboard').hidden=true;});
    this.$('scoreboard').addEventListener('click',event=>{
      if(event.target===this.$('scoreboard'))this.$('scoreboard').hidden=true;
    });
    this.$('saveCancel').addEventListener('click',()=>{
      if(this.saving)this.abort=true; else this.$('saver').hidden=true;
    });
    this.$('saveStart').addEventListener('click',()=>this.runExport());
    this.$('saveFormat').addEventListener('change',()=>this.paintSaver());
    this.$('saveRange').addEventListener('change',()=>this.paintSaver());
    this.$('phrasePrev').addEventListener('click',()=>this.step(-1));
    this.$('phraseNext').addEventListener('click',()=>this.step(1));
  }

  /* ---------- режим и сброс ---------- */
  open(mode,micId=''){
    this.mode=mode;this.micId=micId;
    this.takes.clear();this.lineScores=null;
    this.backing=null;this.backingFor='';
    this.target=0;
    this.stopEverything();
    this.$('studio').hidden=mode==='live';
    for(const button of document.querySelectorAll('.mode'))
      button.classList.toggle('on',button.dataset.mode===mode);
    if(mode!=='live')this.mic.open(this.micId).catch(error=>this.ctx.fail(Error(
      `Микрофон не открылся: ${error.message}. Разреши доступ в браузере и выбери песню заново.`)));
    this.paint();
  }

  setMode(mode){
    if(this.mode==='live'||this.mode===mode)return;
    this.stopEverything();
    this.audio.pause();
    this.mode=mode;
    for(const button of document.querySelectorAll('.mode'))
      button.classList.toggle('on',button.dataset.mode===mode);
    this.paint();
  }

  stopEverything(){
    if(this.state==='recording')this.mic.stop();
    this.state='idle';this.stopAt=0;
    try{this.source?.stop();}catch{}
    this.source=null;
    this.$('countdown').hidden=true;
    this.$('meterFill').style.width='0%';
  }

  step(delta){
    const next=this.target+delta;
    if(next<0||next>=this.lines.length)return;
    this.stopEverything();
    this.ctx.stopHear();
    this.target=next;
    this.paint();
  }

  /* ---------- запись ---------- */
  async arm(){
    if(!this.song)return;
    try{await this.mic.open(this.micId||'');}
    catch(error){return this.ctx.fail(Error(`Микрофон недоступен: ${error.message}`));}
    this.stopEverything();
    this.ctx.stopHear();
    const whole=this.mode==='full';
    const line=this.lines[this.target];
    const mark=whole?(this.lines[0]?.start||0):line.start;
    this.markAt=mark;
    this.stopAt=whole?this.song.duration:line.end+TAIL;
    this.audio.currentTime=Math.max(0,mark-COUNT_IN);
    try{await this.audio.play();}
    catch(error){return this.ctx.fail(Error(`Не удалось включить музыку: ${error.message}`));}
    // Пишем сразу: у записи свой кольцевой запас, ранний вдох не потеряется.
    this.ring=this.mic.start();
    this.startedAt=this.audio.currentTime;
    this.state='recording';
    this.paint();
  }

  finish(){
    if(this.state!=='recording')return;
    const take=this.mic.stop();
    this.state='idle';this.stopAt=0;
    this.audio.pause();
    this.$('countdown').hidden=true;
    // at — момент песни, которому отвечает первый сэмпл записи
    if(take&&take.duration>0.25)this.takes.set(this.key,{...normalize(take),at:this.startedAt-this.ring,
      line:this.mode==='full'?null:this.target});
    this.paint();
  }

  drop(){
    this.lineScores?.delete(this.target);
    this.takes.delete(this.key);
    this.stopEverything();
    this.paint();
  }

  /* ---------- прослушивание ---------- */
  async #music(){
    const url=this.ctx.entry()?.audio;
    if(!url)return null;
    if(this.backing&&this.backingFor===url)return this.backing;
    this.backing=await decode(url,audioContext());
    this.backingFor=url;
    return this.backing;
  }

  hearOriginal(){
    this.stopEverything();
    this.audio.pause();
    this.ctx.hearLine(this.mode==='full'?0:this.target);
  }

  async review(){
    const take=this.takes.get(this.key);
    if(!take)return;
    this.stopEverything();
    this.ctx.stopHear();
    this.audio.pause();
    try{
      const backing=await this.#music();
      const whole=this.mode==='full';
      const from=whole?0:Math.max(0,this.lines[this.target].start-1);
      const to=whole?this.song.duration:this.lines[this.target].end+1;
      const mixed=await mixSong({
        backing,duration:to,musicGain:this.musicGain,
        sampleRate:audioContext().sampleRate,
        takes:[{buffer:toBuffer(take),at:take.at}],
      });
      const source=audioContext().createBufferSource();
      source.buffer=mixed;source.connect(audioContext().destination);
      source.onended=()=>{if(this.source===source){this.source=null;this.state='idle';this.paint();}};
      source.start(0,from,Math.max(.2,to-from));
      this.source=source;this.state='playing';
      this.paint();
    }catch(error){this.ctx.fail(Error(`Не удалось свести дубль: ${error.message}`));}
  }

  /* ---------- оценка ---------- */
  async showScore(){
    if(!this.takes.size)return;
    this.stopEverything();this.ctx.stopHear();this.audio.pause();
    const button=this.$('studioScore');
    button.disabled=true;button.textContent='Считаем…';
    try{
      const result=await this.ctx.score([...this.takes.values()],this.lines);
      this.paintScore(result);
      this.$('scoreboard').hidden=false;
    }catch(error){this.ctx.fail(Error(`Не удалось посчитать оценку: ${error.message}`));}
    finally{button.disabled=false;button.textContent='★ Оценка';}
  }

  paintScore(result){
    this.$('scoreTotal').textContent=result.total.toLocaleString('ru');
    this.$('scoreTitle').textContent=result.title;
    this.$('scoreQuip').textContent=result.quip;
    const rows=[
      ['Интонация',result.pitch,'попадание в ноты'],
      ['Ритм',result.rhythm,'вступал вовремя'],
      ...(result.golden===null?[]:[['Золотые ноты',result.golden,'они весят вдвое']]),
      ['Охват',result.coverage,'сколько песни спето'],
    ];
    const holder=this.$('scoreBars');
    holder.replaceChildren();
    for(const [name,value,hint] of rows){
      const row=document.createElement('div');
      row.className='score-row'+(value<50?' weak':'');
      row.title=hint;
      const label=document.createElement('b');label.textContent=name;
      const track=document.createElement('div');track.className='score-track';
      const fill=document.createElement('span');fill.style.width=`${Math.max(0,Math.min(100,value))}%`;
      track.append(fill);
      const number=document.createElement('i');number.textContent=`${value}%`;
      row.append(label,track,number);
      holder.append(row);
    }
    this.$('scoreNote').textContent=this.mode==='full'
      ? `Разобрано нот: ${result.notes}. Октава не важна — считается только чистота тона.`
      : `Разобрано нот: ${result.notes} в ${result.lines.length} записанных репликах.`;
    // оценки по репликам видно прямо в списке дублей
    this.lineScores=new Map(result.lines.map(line=>[line.line,line]));
    this.paint();
  }

  /* ---------- экспорт ---------- */
  /** Границы записанного: от первого дубля до последнего, с секундой воздуха. */
  span(){
    const takes=[...this.takes.values()];
    if(!takes.length)return [0,this.song.duration];
    const from=Math.max(0,Math.min(...takes.map(take=>take.at))-1);
    const to=Math.min(this.song.duration,Math.max(...takes.map(take=>take.at+take.duration))+1);
    return [from,Math.max(from+1,to)];
  }

  openSaver(){
    if(!this.takes.size)return;
    this.abort=false;this.saving=false;
    this.$('saveBar').hidden=true;this.$('saveFill').style.width='0%';
    this.$('saver').hidden=false;
    this.paintSaver();
  }

  paintSaver(){
    const video=this.$('saveFormat').value==='video';
    this.$('saveShapeField').hidden=!video;
    const [from,to]=this.$('saveRange').value==='all'?[0,this.song.duration]:this.span();
    const seconds=Math.round(to-from);
    this.$('saveHint').textContent=video
      ?`${SHAPES[this.$('saveShape').value].label} · займёт около ${clock(seconds)}`
      :`сведение мгновенное, отрезок ${clock(seconds)}`;
    this.$('saveNote').textContent=video
      ? 'Ролик снимается в реальном времени, вкладку лучше не переключать.'
      : 'Звук сводится офлайн и скачивается сразу.';
  }

  async runExport(){
    if(this.saving)return;
    this.saving=true;this.abort=false;
    const button=this.$('saveStart'),bar=this.$('saveBar');
    button.disabled=true;bar.hidden=false;
    this.$('saveCancel').textContent='Прервать';
    try{
      const video=this.$('saveFormat').value==='video';
      const [from,to]=this.$('saveRange').value==='all'?[0,this.song.duration]:this.span();
      const backing=await this.#music();
      const takes=[...this.takes.values()].map(take=>({buffer:toBuffer(take),at:take.at}));
      const mixed=await mixSong({backing,takes,duration:this.song.duration,
        musicGain:this.musicGain,sampleRate:video?48000:44100});
      const blob=video
        ? await renderVideo({
            song:this.song,version:this.ctx.version(),mixed,
            backdrops:this.ctx.backdrops(),title:this.#name(),
            shape:this.$('saveShape').value,from,to,
            showOriginal:this.$('saveOriginal').checked,
            onProgress:value=>{this.$('saveFill').style.width=`${Math.round(value*100)}%`;},
            shouldStop:()=>this.abort,
          })
        : bufferToWav(sliceBuffer(mixed,from,to));
      if(this.abort&&!video)return;
      const extension=video?(blob.type.includes('mp4')?'mp4':'webm'):'wav';
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;link.download=`${this.#name()} (пьяное караоке).${extension}`;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),4000);
      this.$('saver').hidden=true;
    }catch(error){this.ctx.fail(Error(`Сохранить не удалось: ${error.message}`));}
    finally{
      this.saving=false;this.abort=false;
      button.disabled=false;bar.hidden=true;
      this.$('saveCancel').textContent='Отмена';
      this.$('saveFill').style.width='0%';
    }
  }

  #name(){
    const entry=this.ctx.entry();
    return `${entry?.artist||this.song.artist} — ${entry?.title||this.song.title}`.replace(/[\\/:*?"<>|]/g,'');
  }

  /* ---------- кадр ---------- */
  tick(now){
    if(this.mode==='live')return;
    if(this.state==='recording')
      this.$('meterFill').style.width=`${Math.min(100,Math.round(this.mic.readPeak()*140))}%`;
    if(this.state==='recording'&&this.stopAt&&now>=this.stopAt){this.finish();return;}
    const count=this.$('countdown');
    if(this.state==='recording'&&now<this.markAt){
      const left=Math.ceil(this.markAt-now);
      if(left<=3){count.textContent=String(Math.max(1,left));count.hidden=false;}
      else count.hidden=true;
    }else if(!count.hidden)count.hidden=true;
  }

  /* ---------- отрисовка ---------- */
  paint(){
    if(this.mode==='live'){this.$('studio').hidden=true;return;}
    const whole=this.mode==='full';
    const has=this.takes.has(this.key);
    const busy=this.state==='recording';
    const version=this.ctx.version();
    const line=this.lines[this.target];

    this.$('studioRec').textContent=busy?'■ Стоп':(has?'⏺ Переписать':'⏺ Записать');
    this.$('studioPlay').disabled=!has||busy;
    this.$('studioDrop').disabled=!has||busy;
    this.$('studioOrig').disabled=busy||!this.ctx.entry()?.vocal;
    this.$('studioExport').disabled=!this.takes.size||busy;
    this.$('studioScore').disabled=!this.takes.size||busy;
    this.$('phrasePrev').disabled=whole||busy||this.target<=0;
    this.$('phraseNext').disabled=whole||busy||this.target>=this.lines.length-1;

    this.$('phraseNo').textContent=whole
      ?'вся песня целиком'
      :`реплика ${this.target+1} из ${this.lines.length} · ${clock(line?.start||0)}`;
    this.$('phraseNew').textContent=whole
      ?(this.takes.has('all')?`Дубль на ${clock(this.takes.get('all').duration)} готов`:'Записи ещё нет')
      :plain(version[this.target]?.text||'');
    this.$('phraseOld').textContent=whole?'':(line?.original||'');
    this.$('studioCount').textContent=whole
      ?(this.takes.has('all')?'записано':'пусто')
      :`${this.recorded} / ${this.lines.length}`;
    this.$('studioHint').textContent=busy
      ?'идёт запись — пой'
      :whole
        ?'Один заход от начала до конца. Не понравилось — просто перезапиши.'
        :'«Оригинал» — как поётся в песне. «Записать» — музыка подведёт к реплике, после счёта вступай.';
    this.#list();
  }

  #list(){
    const holder=this.$('studioBody');
    holder.replaceChildren();
    if(this.mode==='full')return;
    const version=this.ctx.version();
    this.lines.forEach((line,index)=>{
      const item=document.createElement('li');
      const button=document.createElement('button');
      button.className='take';
      button.classList.toggle('on',index===this.target);
      button.classList.toggle('done',this.takes.has(index));
      const stamp=document.createElement('small');stamp.textContent=clock(line.start);
      const text=document.createElement('span');text.textContent=plain(version[index]?.text||line.original);
      const mark=document.createElement('b');
      const scored=this.lineScores?.get(index);
      mark.textContent=scored?`${scored.pitch}%`:(this.takes.has(index)?'✓':'');
      if(scored)mark.style.color=scored.pitch>=70?'var(--green)':scored.pitch>=45?'var(--yellow)':'#ff9d6b';
      button.append(stamp,text,mark);
      button.addEventListener('click',()=>{this.stopEverything();this.ctx.stopHear();this.target=index;this.paint();});
      item.append(button);holder.append(item);
    });
    holder.querySelector('.take.on')?.scrollIntoView({block:'nearest'});
  }
}
