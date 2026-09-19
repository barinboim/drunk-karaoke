// Рендер ролика: тот же караоке-кадр, но на canvas, и снимается в MP4/WebM вместе
// со сведённым звуком. Пишется в реальном времени — иначе браузер не отдаст видеодорожку.
import {videoMime} from './mixer.js';

const FONT='"Comic Sans MS","Comic Sans","Chalkboard SE",cursive';
const plain=value=>String(value||'').replace(/́/g,'');

export const SHAPES={
  '9:16':{width:1080,height:1920,label:'9:16 — для Reels и Shorts'},
  '1:1':{width:1080,height:1080,label:'1:1 — квадрат для ленты'},
  '16:9':{width:1280,height:720,label:'16:9 — обычное видео'},
};

function loadImage(src){
  return new Promise(resolve=>{
    const image=new Image();
    image.onload=()=>resolve(image);
    image.onerror=()=>resolve(null);
    image.src=src;
  });
}

/** Картинка вписывается «по большей стороне», как background-size: cover. */
function drawCover(ctx,image,width,height,zoom){
  if(!image){ctx.fillStyle='#111';ctx.fillRect(0,0,width,height);return;}
  const scale=Math.max(width/image.width,height/image.height)*zoom;
  const w=image.width*scale,h=image.height*scale;
  ctx.drawImage(image,(width-w)/2,(height-h)/2,w,h);
}

function scanlines(ctx,width,height){
  ctx.save();
  ctx.globalAlpha=.28;ctx.fillStyle='#000';
  for(let y=0;y<height;y+=6)ctx.fillRect(0,y+3,width,3);
  ctx.restore();
}

// Строка превращается в цепочку кусочков: слоги (их заливает зелёным по ходу ноты)
// и разделители «·» между записями — они не поются и не заливаются.
function tokenize(syllables,itemStarts){
  const starts=new Set(itemStarts||[]);
  const out=[];
  syllables.forEach((part,index)=>{
    if(index&&starts.has(index))out.push({text:' · ',note:-1});
    out.push({text:plain(part),note:index});
  });
  return out;
}

/** Раскладывает кусочки по строкам, перенося только по границам слов и разделителям. */
function layout(ctx,tokens,maxWidth){
  const rows=[];let row=[],width=0;
  tokens.forEach((token,index)=>{
    const measured=ctx.measureText(token.text).width;
    const breakable=index>0&&(token.note<0||/^\s/.test(token.text));
    if(breakable&&width+measured>maxWidth&&row.length){rows.push({items:row,width});row=[];width=0;}
    row.push({...token,width:measured});
    width+=measured;
  });
  if(row.length)rows.push({items:row,width});
  return rows;
}

// Если строка всё равно не влезла, уменьшаем кегль — обрезанный текст хуже мелкого.
function fitLayout(ctx,tokens,maxWidth,size){
  for(let attempt=0;attempt<4;attempt++){
    ctx.font=`bold ${Math.round(size)}px ${FONT}`;
    const rows=layout(ctx,tokens,maxWidth);
    if(rows.every(row=>row.width<=maxWidth)||attempt===3)return {rows,size:Math.round(size)};
    size*=Math.min(.92,maxWidth/Math.max(...rows.map(row=>row.width)));
  }
  return {rows:layout(ctx,tokens,maxWidth),size:Math.round(size)};
}

function drawKaraoke(ctx,{rows,notes,now,x,y,lineHeight,outline}){
  for(const [r,row] of rows.entries()){
    let cursor=x-row.width/2;
    const baseline=y+r*lineHeight;
    for(const item of row.items){
      ctx.lineWidth=outline;ctx.lineJoin='round';ctx.miterLimit=2;ctx.strokeStyle='#000';
      ctx.strokeText(item.text,cursor,baseline);
      ctx.fillStyle=item.note<0?'#d8dcd2':'#fff';
      ctx.fillText(item.text,cursor,baseline);
      const note=item.note>=0?notes[item.note]:null;
      let filled=0;
      if(note){
        if(now>=note.end)filled=1;
        else if(now>=note.start)filled=(now-note.start)/Math.max(.05,note.end-note.start);
      }
      if(filled>0){
        ctx.save();
        ctx.beginPath();
        ctx.rect(cursor,baseline-lineHeight,item.width*filled,lineHeight*1.4);
        ctx.clip();
        ctx.fillStyle='#3dff57';
        ctx.fillText(item.text,cursor,baseline);
        ctx.restore();
      }
      cursor+=item.width;
    }
  }
}

function wrapPlain(ctx,text,maxWidth){
  const words=String(text).split(/\s+/).filter(Boolean),rows=[];let row='';
  for(const word of words){
    const candidate=row?`${row} ${word}`:word;
    if(ctx.measureText(candidate).width>maxWidth&&row){rows.push(row);row=word;}
    else row=candidate;
  }
  if(row)rows.push(row);
  return rows;
}

function drawOutlined(ctx,text,x,y,outline,colour){
  ctx.lineWidth=outline;ctx.lineJoin='round';ctx.strokeStyle='#000';
  ctx.strokeText(text,x,y);
  ctx.fillStyle=colour;
  ctx.fillText(text,x,y);
}

/**
 * Снимает ролик в реальном времени: звук идёт из сведённого буфера, кадры рисуются
 * по часам того же аудиоконтекста, поэтому картинка не уезжает от музыки.
 */
export async function renderVideo({
  song,version,mixed,backdrops=[],title='',shape='9:16',
  from=0,to=null,showOriginal=true,onProgress=null,shouldStop=null,
}){
  if(!videoMime)throw Error('Браузер не умеет записывать видео.');
  const {width,height}=SHAPES[shape]||SHAPES['9:16'];
  const finish=to??song.duration;
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');

  const images=(await Promise.all(backdrops.slice(0,24).map(loadImage))).filter(Boolean);
  const logo=await loadImage('logo.svg');
  const audio=new AudioContext();
  if(audio.state==='suspended')await audio.resume();
  const source=audio.createBufferSource();
  source.buffer=mixed;
  const sink=audio.createMediaStreamDestination();
  source.connect(sink);

  const stream=new MediaStream([...canvas.captureStream(30).getVideoTracks(),...sink.stream.getAudioTracks()]);
  const recorder=new MediaRecorder(stream,{mimeType:videoMime,videoBitsPerSecond:5_000_000});
  const parts=[];
  recorder.ondataavailable=event=>{if(event.data.size)parts.push(event.data);};

  const big=Math.round(width*(shape==='16:9'?.055:.072));
  const small=Math.round(big*.42);
  const head=Math.round(big*.58);
  const textBottom=height*(shape==='9:16'?.72:.80);

  return new Promise((resolve,reject)=>{
    let frame=0;
    recorder.onstop=()=>{
      try{source.stop();}catch{}
      audio.close().catch(()=>{});
      cancelAnimationFrame(frame);
      resolve(new Blob(parts,{type:videoMime}));
    };
    recorder.onerror=error=>reject(error.error||Error('Запись ролика прервалась'));

    const started=audio.currentTime+0.12;
    source.start(started,from,Math.max(.2,finish-from));
    recorder.start(1000);

    const draw=()=>{
      const now=from+Math.max(0,audio.currentTime-started);
      if(shouldStop?.()||now>=finish){recorder.stop();return;}
      onProgress?.((now-from)/Math.max(.001,finish-from));

      const slot=Math.floor((now-from)/11);
      drawCover(ctx,images[slot%(images.length||1)],width,height,1+((now-from)%11)/11*0.1);
      ctx.fillStyle='rgba(0,0,0,.18)';ctx.fillRect(0,0,width,height);
      scanlines(ctx,width,height);

      ctx.textBaseline='alphabetic';
      const margin=width*.05;
      // Логотип в правом верхнем углу, под ним адрес: ролик уезжает в ленту без нас.
      let logoBottom=margin;
      if(logo){
        const logoWidth=width*(shape==='16:9'?.20:.28);
        const logoHeight=logoWidth*logo.height/logo.width;
        ctx.drawImage(logo,width-margin-logoWidth,margin*.7,logoWidth,logoHeight);
        logoBottom=margin*.7+logoHeight;
        ctx.textAlign='right';
        ctx.font=`${Math.round(head*.42)}px ${FONT}`;
        drawOutlined(ctx,'drunkaraoke.barinbo.im',width-margin,logoBottom+head*.5,
          Math.max(3,head*.11),'#cfd6c6');
      }
      if(title){
        ctx.textAlign='left';
        ctx.font=`bold ${head}px ${FONT}`;
        const room=width-margin*2-(logo?width*(shape==='16:9'?.22:.30):0);
        let shown=title;
        while(shown.length>6&&ctx.measureText(shown).width>room)shown=shown.slice(0,-2);
        if(shown!==title)shown=shown.trimEnd()+'…';
        drawOutlined(ctx,shown,margin,margin*.7+head,Math.max(6,head*.2),'#ffe14d');
      }

      const index=song.lines.findIndex(line=>now>=line.start&&now<line.end);
      const shown=index>=0?index:song.lines.findIndex(line=>line.start>now);
      if(shown>=0&&version[shown]){
        ctx.textAlign='left';
        const tokens=tokenize(version[shown].syllables,version[shown].itemStarts);
        const {rows,size}=fitLayout(ctx,tokens,width*.88,big);
        const lineHeight=size*1.2;
        const baseline=textBottom-(rows.length-1)*lineHeight;
        drawKaraoke(ctx,{rows,notes:song.lines[shown].notes,now:index>=0?now:-1,
          x:width/2,y:baseline,lineHeight,outline:Math.max(6,size*.14)});
        if(showOriginal&&song.lines[shown].original){
          ctx.textAlign='center';
          ctx.font=`${small}px ${FONT}`;
          const below=wrapPlain(ctx,song.lines[shown].original,width*.86);
          below.forEach((text,r)=>
            drawOutlined(ctx,text,width/2,textBottom+small*1.9+r*small*1.25,Math.max(3,small*.2),'#8f968a'));
        }
      }
      frame=requestAnimationFrame(draw);
    };
    frame=requestAnimationFrame(draw);
  });
}
