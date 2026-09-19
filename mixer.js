// Финальный монтаж: минусовка плюс дубли игрока, разложенные по времени строк.
// Считается офлайн — быстрее реального времени и без щелчков живого графа.

/** Мягкий лимитер на мастере: два голоса внахлёст иначе уходят в клиппинг. */
function limiter(ctx){
  const node=ctx.createDynamicsCompressor();
  node.threshold.value=-6;node.knee.value=6;node.ratio.value=12;
  node.attack.value=0.003;node.release.value=0.25;
  return node;
}

export async function decode(url,ctx){
  const response=await fetch(url);
  if(!response.ok)throw Error('Не удалось прочитать дорожку для сведения');
  return ctx.decodeAudioData(await response.arrayBuffer());
}

/**
 * takes: [{buffer, at, gain}] — at это момент песни, которому соответствует
 * ПЕРВЫЙ сэмпл записи. Отрицательный at значит, что запись началась до песни.
 */
export async function mixSong({backing,takes=[],duration,musicGain=0.85,voiceGain=1,sampleRate=44100}){
  const length=Math.ceil((duration+1)*sampleRate);
  const ctx=new OfflineAudioContext(2,length,sampleRate);
  const master=ctx.createGain();master.gain.value=1;
  const guard=limiter(ctx);
  master.connect(guard).connect(ctx.destination);

  if(backing){
    const music=ctx.createBufferSource();music.buffer=backing;
    const gain=ctx.createGain();gain.gain.value=musicGain;
    music.connect(gain).connect(master);music.start(0);
  }
  for(const take of takes){
    if(!take.buffer)continue;
    const start=Math.max(0,take.at);
    const skip=Math.max(0,-take.at);
    const source=ctx.createBufferSource();source.buffer=take.buffer;
    const gain=ctx.createGain();gain.gain.value=(take.gain??1)*voiceGain;
    // короткие фейды по краям — иначе на стыке дубля слышен щелчок
    const end=start+Math.max(0,take.buffer.duration-skip);
    gain.gain.setValueAtTime(0,start);
    gain.gain.linearRampToValueAtTime((take.gain??1)*voiceGain,Math.min(end,start+0.02));
    if(end-0.03>start){
      gain.gain.setValueAtTime((take.gain??1)*voiceGain,end-0.03);
      gain.gain.linearRampToValueAtTime(0,end);
    }
    source.connect(gain).connect(master);
    source.start(start,skip);
  }
  return ctx.startRendering();
}

/** Вырезает кусок буфера: экспорт отрезка не должен тащить всю песню. */
export function sliceBuffer(buffer,from,to){
  const rate=buffer.sampleRate;
  const start=Math.max(0,Math.floor(from*rate));
  const end=Math.min(buffer.length,Math.ceil(to*rate));
  const length=Math.max(1,end-start);
  const out=new OfflineAudioContext(buffer.numberOfChannels,length,rate).createBuffer(
    buffer.numberOfChannels,length,rate);
  for(let channel=0;channel<buffer.numberOfChannels;channel++)
    out.copyToChannel(buffer.getChannelData(channel).subarray(start,end),channel);
  return out;
}

/** WAV 16 бит: открывается чем угодно и не требует кодеков. */
export function bufferToWav(buffer){
  const channels=Math.min(buffer.numberOfChannels,2);
  const frames=buffer.length,blockAlign=channels*2,dataSize=frames*blockAlign;
  const array=new ArrayBuffer(44+dataSize),view=new DataView(array);
  const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+dataSize,true);text(8,'WAVE');
  text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);
  view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);
  view.setUint32(28,buffer.sampleRate*blockAlign,true);view.setUint16(32,blockAlign,true);view.setUint16(34,16,true);
  text(36,'data');view.setUint32(40,dataSize,true);
  const data=Array.from({length:channels},(_,c)=>buffer.getChannelData(c));
  let at=44;
  for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){
    const value=Math.max(-1,Math.min(1,data[c][i]));
    view.setInt16(at,value<0?value*0x8000:value*0x7fff,true);at+=2;
  }
  return new Blob([array],{type:'audio/wav'});
}

/** Формат записи ролика: MP4 там, где умеют, иначе WebM. */
export const videoMime=[
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4',
  'video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm',
].find(type=>typeof MediaRecorder!=='undefined'&&MediaRecorder.isTypeSupported(type))||'';
