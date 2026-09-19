// Захват микрофона через AudioWorklet: сырые Float32-сэмплы нужны и для индикатора
// уровня, и для точного монтажа. MediaRecorder тут не подходит — он отдаёт сжатый
// поток, который нечем положить на нужную секунду минусовки.

const WORKLET=`
class Capture extends AudioWorkletProcessor{
  process(inputs){
    const input=inputs[0];
    if(input&&input[0]&&input[0].length)this.port.postMessage(input[0].slice(0));
    return true;
  }
}
registerProcessor('dk-capture',Capture);
`;

/** Запас до реплики: человек почти всегда вступает раньше, чем начинается строка. */
export const LEAD=0.6;
/** Запас после: и договаривает позже, чем она кончилась. */
export const TAIL=0.8;

let context=null,workletReady=null;

export function audioContext() {
  if(!context)context=new (window.AudioContext||window.webkitAudioContext)();
  if(context.state==='suspended')context.resume().catch(()=>{});
  return context;
}

function ensureWorklet(ctx) {
  if(!workletReady) {
    const url=URL.createObjectURL(new Blob([WORKLET],{type:'text/javascript'}));
    workletReady=ctx.audioWorklet.addModule(url).finally(()=>URL.revokeObjectURL(url));
  }
  return workletReady;
}

const flatten=(chunks,total)=>{
  const out=new Float32Array(total);let at=0;
  for(const chunk of chunks){out.set(chunk,at);at+=chunk.length;}
  return out;
};

export class MicRecorder {
  #stream=null;#source=null;#worklet=null;#opened='';
  #chunks=[];#count=0;#capturing=false;
  #ring=[];#ringCount=0;#ringLimit=0;
  #peak=0;#limit=Infinity;#onFull=null;

  get ready(){return Boolean(this.#stream);}

  /** Микрофон может умереть посреди сессии, поэтому поток переоткрывается по состоянию трека. */
  async open(deviceId=''){
    const track=this.#stream?.getAudioTracks?.()[0];
    if(track&&track.readyState==='live'&&!track.muted&&this.#opened===deviceId)return;
    this.close();
    const ctx=audioContext();
    this.#stream=await navigator.mediaDevices.getUserMedia({
      audio:{
        deviceId:deviceId?{exact:deviceId}:undefined,
        echoCancellation:false,noiseSuppression:false,autoGainControl:false,
      },
    });
    this.#opened=deviceId;
    await ensureWorklet(ctx);
    this.#source=ctx.createMediaStreamSource(this.#stream);
    this.#worklet=new AudioWorkletNode(ctx,'dk-capture');
    this.#worklet.port.onmessage=({data})=>this.#take(data);
    this.#source.connect(this.#worklet);
    // Узел должен что-то отдавать, иначе граф в части браузеров засыпает;
    // подключаем через нулевую громкость, чтобы не было обратной связи.
    const mute=ctx.createGain();mute.gain.value=0;
    this.#worklet.connect(mute).connect(ctx.destination);
    this.#ringLimit=Math.ceil(LEAD*ctx.sampleRate);
  }

  #take(chunk){
    for(let i=0;i<chunk.length;i++){const value=Math.abs(chunk[i]);if(value>this.#peak)this.#peak=value;}
    if(!this.#capturing){
      this.#ring.push(chunk);this.#ringCount+=chunk.length;
      while(this.#ringCount-this.#ring[0].length>=this.#ringLimit){this.#ringCount-=this.#ring.shift().length;}
      return;
    }
    this.#chunks.push(chunk);this.#count+=chunk.length;
    if(this.#count>=this.#limit&&this.#onFull){const done=this.#onFull;this.#onFull=null;done();}
  }

  /** Пик входа с прошлого чтения — для полоски уровня. */
  readPeak(){const value=this.#peak;this.#peak=0;return value;}

  /** Начинает запись, забирая с собой уже пойманный запас-вступление. */
  start({seconds=Infinity,onFull=null}={}){
    const rate=audioContext().sampleRate;
    const lead=flatten(this.#ring,this.#ringCount);
    this.#chunks=lead.length?[lead]:[];
    this.#count=lead.length;
    this.#limit=Number.isFinite(seconds)?Math.ceil((seconds+LEAD)*rate):Infinity;
    this.#onFull=onFull;
    this.#capturing=true;
    return lead.length/rate;
  }

  stop(){
    if(!this.#capturing)return null;
    this.#capturing=false;this.#onFull=null;
    const rate=audioContext().sampleRate;
    const samples=flatten(this.#chunks,this.#count);
    const leadSec=Math.min(LEAD,samples.length/rate);
    this.#chunks=[];this.#count=0;
    return samples.length?{samples,sampleRate:rate,leadSec,duration:samples.length/rate}:null;
  }

  close(){
    try{this.#worklet?.port&&(this.#worklet.port.onmessage=null);}catch{}
    this.#worklet?.disconnect();this.#source?.disconnect();
    this.#stream?.getTracks().forEach(track=>track.stop());
    this.#stream=null;this.#source=null;this.#worklet=null;
    this.#ring=[];this.#ringCount=0;this.#chunks=[];this.#count=0;this.#capturing=false;
  }
}

export function toBuffer(take,ctx=audioContext()){
  const buffer=ctx.createBuffer(1,take.samples.length,take.sampleRate);
  buffer.copyToChannel(take.samples,0);
  return buffer;
}

/** Нормализация дубля к разумному пику: шёпот и крик должны лечь в один микс. */
export function normalize(take,target=0.85){
  let peak=0;
  for(let i=0;i<take.samples.length;i++){const value=Math.abs(take.samples[i]);if(value>peak)peak=value;}
  if(peak<1e-4||peak>=target)return take;
  const gain=target/peak,samples=new Float32Array(take.samples.length);
  for(let i=0;i<samples.length;i++)samples[i]=take.samples[i]*gain;
  return {...take,samples};
}
