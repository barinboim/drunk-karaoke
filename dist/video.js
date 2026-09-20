// Рендер ролика: тот же караоке-кадр, но на canvas, и снимается в MP4/WebM вместе
// со сведённым звуком. Пишется в реальном времени — иначе браузер не отдаст видеодорожку.
import {videoMime} from './mixer.js';

const FONT='"Comic Sans MS","Comic Sans","Chalkboard SE",cursive';
const plain=value=>String(value||'').replace(/́/g,'');

// Сейф-зоны вертикальных лент. Сверху кадр закрывает интерфейс, снизу — подпись,
// имя автора и кнопки, справа — столбец «нравится-комментарий-поделиться». Доли, а не
// пиксели, чтобы не зависеть от размера: для Reels 1080×1920 это 250 сверху, 422 снизу
// и по 119 с боков. Боковой отступ берём одинаковым с обеих сторон — иначе центрованный
// текст съезжает влево и это видно.
const SAFE={
  '9:16':{top:.13,bottom:.22,side:.11},
  '1:1':{top:.07,bottom:.10,side:.06},
  '16:9':{top:.06,bottom:.08,side:.05},
};

const shuffle=list=>{const out=[...list];for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;};

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

/**
 * Куда смотреть в кадре. Фоны горизонтальные, а ролик вертикальный, и обрезка по центру
 * режет павлина пополам: в середине широкого снимка обычно трава и небо, а птица сбоку.
 *
 * Ищем скользящим окном нужной пропорции место с наибольшим «весом содержимого». Вес —
 * это прежде всего **насыщенный цвет выше порога**, и только чуть-чуть — резкость. Порог
 * решает всё: считать всякую деталь бесполезно, потому что листва и гравий дают её не
 * меньше птицы и берут числом. Замер по всем двумстам фонам: обрезка по центру оставляет
 * в кадре 48% объекта, по одной резкости — 51%, по цвету выше порога — 68%. На павлинах
 * 62% против 81%. Штраф за шов, проходящий по объекту, пробовали — не дал ничего (67%).
 */
function focusOf(image,aspect){
  const middle={x:.5,y:.5};
  try{
    const w=64,h=Math.max(8,Math.round(64*image.height/image.width));
    const probe=document.createElement('canvas');
    probe.width=w;probe.height=h;
    const small=probe.getContext('2d',{willReadFrequently:true});
    small.drawImage(image,0,0,w,h);
    const pixels=small.getImageData(0,0,w,h).data;
    const light=new Float64Array(w*h),vivid=new Float64Array(w*h),energy=new Float64Array(w*h);
    for(let i=0;i<w*h;i++){
      const r=pixels[i*4],g=pixels[i*4+1],b=pixels[i*4+2];
      light[i]=(r*.299+g*.587+b*.114)/255;
      const top=Math.max(r,g,b);
      const sat=top?(top-Math.min(r,g,b))/top:0;
      // Порог отсекает блёклое: трава и гравий не в счёт, синь на шее павлина — в счёт.
      vivid[i]=sat>.45&&light[i]>.15&&light[i]<.85?(sat-.45)/.55:0;
    }
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;
      const dx=x+1<w?Math.abs(light[i]-light[i+1]):0;
      const dy=y+1<h?Math.abs(light[i]-light[i+w]):0;
      energy[i]=Math.hypot(dx,dy)*.5+vivid[i]*1.6;
    }
    let ww=w,hh=Math.round(w/aspect);
    if(hh>h){hh=h;ww=Math.max(1,Math.round(h*aspect));}
    // Интегральная сумма: дальше стоимость любого окна берётся за четыре обращения.
    const sum=new Float64Array((w+1)*(h+1));
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)
      sum[(y+1)*(w+1)+x+1]=energy[y*w+x]+sum[y*(w+1)+x+1]+sum[(y+1)*(w+1)+x]-sum[y*(w+1)+x];
    const area=(x,y)=>sum[(y+hh)*(w+1)+x+ww]-sum[y*(w+1)+x+ww]-sum[(y+hh)*(w+1)+x]+sum[y*(w+1)+x];
    let best=-1,bx=(w-ww)/2,by=(h-hh)/2;
    for(let y=0;y<=h-hh;y++)for(let x=0;x<=w-ww;x++){
      // Лёгкий перевес середине: при одинаковой детали лучше не уезжать к самому краю.
      const off=Math.hypot((x+ww/2)/w-.5,(y+hh/2)/h-.5);
      const value=area(x,y)*(1-off*.35);
      if(value>best){best=value;bx=x;by=y;}
    }
    return {x:(bx+ww/2)/w,y:(by+hh/2)/h};
  }catch{return middle;}
}

/**
 * Где внутри картинки собственно рисунок. В логотипе справа и снизу остаётся пустое поле
 * (надпись кончается примерно на 420-й координате из 660), и если ставить по центру сам
 * холст картинки, надпись уезжает влево. Границы считаем по прозрачности, а не по разметке
 * SVG: шрифт на разных машинах разной ширины, и жёстко заданные числа однажды соврут.
 */
function inkBounds(image){
  const whole={x:.5,y:.5,width:1,height:1};
  try{
    const w=240,h=Math.max(8,Math.round(240*image.height/image.width));
    const probe=document.createElement('canvas');
    probe.width=w;probe.height=h;
    const paint=probe.getContext('2d',{willReadFrequently:true});
    paint.drawImage(image,0,0,w,h);
    const data=paint.getImageData(0,0,w,h).data;
    let left=w,right=-1,top=h,bottom=-1;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      if(data[(y*w+x)*4+3]<12)continue;
      if(x<left)left=x;
      if(x>right)right=x;
      if(y<top)top=y;
      if(y>bottom)bottom=y;
    }
    if(right<left||bottom<top)return whole;
    return {x:(left+right+1)/2/w,y:(top+bottom+1)/2/h,
            width:(right-left+1)/w,height:(bottom-top+1)/h};
  }catch{return whole;}
}

/** Вписывает «по большей стороне», как background-size: cover, но вокруг точки интереса. */
function drawCover(ctx,image,width,height,zoom,focus){
  if(!image){ctx.fillStyle='#111';ctx.fillRect(0,0,width,height);return;}
  const scale=Math.max(width/image.width,height/image.height)*zoom;
  const w=image.width*scale,h=image.height*scale;
  // Ставим точку интереса в середину кадра и прижимаем обратно к краям, чтобы не вылезла пустота.
  const x=Math.min(0,Math.max(width-w,width/2-w*(focus?.x??.5)));
  const y=Math.min(0,Math.max(height-h,height/2-h*(focus?.y??.5)));
  ctx.drawImage(image,x,y,w,h);
}

/**
 * Сетка старого экрана — не полосы, а точечная матрица: кадр виден сквозь круглые точки,
 * между ними чуть притемнено. Мягко, потому что край точки размыт градиентом, а не обрезан.
 * Плитка строится один раз и повторяется узором: заливать узором целый кадр дешевле, чем
 * рисовать десятки тысяч точек покадрово.
 *
 * Размер проверять только на кадре в натуральную величину. Уменьшенная копия усредняет
 * точки в ровную дымку, и сетка кажется мягче и мельче, чем она есть: на этом уже
 * ошиблись — выбрали по превью ячейку вдвое крупнее нужной.
 */
function dotMask(ctx,height){
  const cell=Math.max(8,Math.round(height/90));
  const tile=document.createElement('canvas');
  tile.width=tile.height=cell;
  const paint=tile.getContext('2d');
  const glow=paint.createRadialGradient(cell/2,cell/2,0,cell/2,cell/2,cell*.72);
  glow.addColorStop(0,'rgba(0,0,0,0)');
  glow.addColorStop(.42,'rgba(0,0,0,0)');
  glow.addColorStop(1,'rgba(0,0,0,.85)');
  paint.fillStyle=glow;paint.fillRect(0,0,cell,cell);
  return ctx.createPattern(tile,'repeat');
}

function dots(ctx,pattern,width,height){
  if(!pattern)return;
  ctx.save();
  ctx.globalAlpha=.22;ctx.fillStyle=pattern;
  ctx.fillRect(0,0,width,height);
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

  // Набор лежит по темам, поэтому без перемешивания в ролик подряд шли десять павлинов,
  // потом тринадцать водопадов. Тасуем до того, как урезать список, иначе павлины и останутся.
  const images=(await Promise.all(shuffle(backdrops).slice(0,24).map(loadImage))).filter(Boolean);
  const focus=images.map(image=>focusOf(image,width/height));
  const logo=await loadImage('logo.svg');
  const ink=logo?inkBounds(logo):null;
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

  // Каждый фон держится 9–14 секунд, порядок — колода: пока она не кончится, повторов нет,
  // а на стыке колод проверяем, что не выпала та же картинка подряд.
  const slots=[];
  if(images.length){
    let at=from,deck=[],previous=-1;
    while(at<finish){
      if(!deck.length){
        deck=shuffle(images.map((_,index)=>index));
        if(deck.length>1&&deck[0]===previous)[deck[0],deck[1]]=[deck[1],deck[0]];
      }
      const index=deck.shift();
      const span=9+Math.random()*5;
      slots.push({index,start:at,end:at+span});
      previous=index;at+=span;
    }
  }

  const safe=SAFE[shape]||SAFE['9:16'];
  const padX=Math.round(width*safe.side);
  const safeTop=Math.round(height*safe.top);
  const safeBottom=Math.round(height*(1-safe.bottom));
  const column=width-padX*2;

  const mask=dotMask(ctx,height);

  const big=Math.round(width*(shape==='16:9'?.055:.072));
  const small=Math.round(big*.42);
  const head=Math.round(big*.58);
  const siteSize=Math.round(head*.78);
  const titleSize=Math.round(head*1.18);
  // Строка растёт вверх от этой линии, а под ней ещё две строки оригинала: считаем от
  // нижней границы сейф-зоны, чтобы подпись ленты ничего не накрыла.
  const textBottom=safeBottom-(showOriginal?small*3.4:small*.6);

  return new Promise((resolve,reject)=>{
    let frame=0,cursor=0;
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

      while(cursor<slots.length-1&&now>=slots[cursor].end)cursor++;
      const slot=slots[cursor];
      const held=slot?Math.min(1,Math.max(0,(now-slot.start)/(slot.end-slot.start))):0;
      drawCover(ctx,slot?images[slot.index]:null,width,height,1+held*.1,slot?focus[slot.index]:null);
      ctx.fillStyle='rgba(0,0,0,.18)';ctx.fillRect(0,0,width,height);
      dots(ctx,mask,width,height);

      ctx.textBaseline='alphabetic';
      // Шапка — столбик по центру внутри сейф-зоны: логотип, под ним адрес сайта,
      // под ним название песни. Всё крупно и по центру, ничего ни к чему не приклеено.
      ctx.textAlign='center';
      let top=safeTop;
      if(logo){
        // Масштабируем так, чтобы заданную ширину занял рисунок, а не холст с пустым полем.
        const want=Math.min(column*.62,width*(shape==='16:9'?.28:.52));
        const logoWidth=Math.round(want/Math.max(.25,ink.width));
        const logoHeight=logoWidth*logo.height/logo.width;
        ctx.drawImage(logo,width/2-logoWidth*ink.x,top,logoWidth,logoHeight);
        top+=logoHeight*(ink.y+ink.height/2);
      }
      ctx.font=`${siteSize}px ${FONT}`;
      top+=siteSize*1.6;
      drawOutlined(ctx,'drunkaraoke.barinbo.im',width/2,top,Math.max(3,siteSize*.16),'#cfd6c6');
      if(title){
        // Длинное название сперва ужимаем кеглем и только потом, если не помогло, режем.
        let size=titleSize;
        ctx.font=`bold ${Math.round(size)}px ${FONT}`;
        while(size>titleSize*.6&&ctx.measureText(title).width>column){
          size*=.94;ctx.font=`bold ${Math.round(size)}px ${FONT}`;
        }
        let shown=title;
        while(shown.length>6&&ctx.measureText(shown).width>column)shown=shown.slice(0,-2);
        if(shown!==title)shown=shown.trimEnd()+'…';
        // Название песни не должно липнуть к адресу: между строками полтора кегля воздуха.
        top+=size*1.75;
        drawOutlined(ctx,shown,width/2,top,Math.max(6,size*.2),'#ffe14d');
      }

      const index=song.lines.findIndex(line=>now>=line.start&&now<line.end);
      const shown=index>=0?index:song.lines.findIndex(line=>line.start>now);
      if(shown>=0&&version[shown]){
        ctx.textAlign='left';
        const tokens=tokenize(version[shown].syllables,version[shown].itemStarts);
        const {rows,size}=fitLayout(ctx,tokens,column,big);
        const lineHeight=size*1.2;
        const baseline=textBottom-(rows.length-1)*lineHeight;
        drawKaraoke(ctx,{rows,notes:song.lines[shown].notes,now:index>=0?now:-1,
          x:width/2,y:baseline,lineHeight,outline:Math.max(6,size*.14)});
        if(showOriginal&&song.lines[shown].original){
          ctx.textAlign='center';
          ctx.font=`${small}px ${FONT}`;
          const below=wrapPlain(ctx,song.lines[shown].original,column);
          below.forEach((text,r)=>
            drawOutlined(ctx,text,width/2,textBottom+small*1.9+r*small*1.25,Math.max(3,small*.2),'#8f968a'));
        }
      }
      frame=requestAnimationFrame(draw);
    };
    frame=requestAnimationFrame(draw);
  });
}
