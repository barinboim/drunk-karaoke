// Определение высоты голоса. Автокорреляция с нормировкой по накопленному среднему
// (тот же приём, что в YIN): для пения она устойчивее простого максимума корреляции,
// потому что не срывается на октаву вниз.

const WORK_RATE=11025;   // для основного тона голоса этого с запасом хватает
const MIN_HZ=70, MAX_HZ=1100;

/** Простое усреднение с прореживанием: точность тона от этого не страдает. */
function downsample(samples,from,to){
  if(from<=to)return {data:samples,rate:from};
  const step=from/to,length=Math.floor(samples.length/step);
  const out=new Float32Array(length);
  for(let i=0;i<length;i++){
    const start=Math.floor(i*step),end=Math.min(samples.length,Math.floor((i+1)*step));
    let sum=0;for(let k=start;k<end;k++)sum+=samples[k];
    out[i]=sum/Math.max(1,end-start);
  }
  return {data:out,rate:to};
}

/**
 * Возвращает по кадрам: время, частоту, «чистоту» (насколько уверенно найден тон)
 * и громкость. Немой кадр отдаёт hz=0.
 */
export function detectPitches(samples,sampleRate,{hop=0.02,window=0.093}={}){
  const {data,rate}=downsample(samples,sampleRate,WORK_RATE);
  const size=Math.round(window*rate);
  const step=Math.max(1,Math.round(hop*rate));
  const minLag=Math.max(2,Math.floor(rate/MAX_HZ));
  const maxLag=Math.min(size-2,Math.ceil(rate/MIN_HZ));
  const frames=Math.max(0,Math.floor((data.length-size)/step)+1);
  const times=new Float32Array(frames),hz=new Float32Array(frames);
  const clarity=new Float32Array(frames),rms=new Float32Array(frames);
  const diff=new Float32Array(maxLag+2),norm=new Float32Array(maxLag+2);

  for(let f=0;f<frames;f++){
    const at=f*step;
    times[f]=at/rate;
    let energy=0;
    for(let i=0;i<size;i++)energy+=data[at+i]*data[at+i];
    rms[f]=Math.sqrt(energy/size);
    if(rms[f]<0.004)continue;                      // тишина: тон не ищем

    for(let lag=minLag;lag<=maxLag;lag++){
      let sum=0;
      for(let i=0;i<size-lag;i++){const d=data[at+i]-data[at+i+lag];sum+=d*d;}
      // Делим на число слагаемых: без этого сумма падает с ростом сдвига,
      // и найденный период систематически оказывается короче настоящего.
      diff[lag]=sum/(size-lag);
    }
    // Нормировка по накопленному среднему: иначе побеждает нулевой сдвиг.
    let running=0;
    for(let lag=minLag;lag<=maxLag;lag++){
      running+=diff[lag];
      norm[lag]=diff[lag]*(lag-minLag+1)/Math.max(1e-9,running);
    }
    // Порог пересекается НА ВХОДЕ в провал, а период соответствует его дну.
    // Если остановиться на входе, найденный период выходит короче настоящего,
    // и тем сильнее, чем ниже голос. Поэтому спускаемся до дна.
    let best=-1;
    for(let lag=minLag;lag<=maxLag;lag++){
      if(norm[lag]>=0.12)continue;
      let bottom=lag;
      while(bottom+1<=maxLag&&norm[bottom+1]<norm[bottom])bottom++;
      best=bottom;break;
    }
    if(best<0){
      let lowest=Infinity;
      for(let lag=minLag;lag<=maxLag;lag++)if(norm[lag]<lowest){lowest=norm[lag];best=lag;}
    }
    const bestValue=best>=0?norm[best]:1;
    if(best<0||bestValue>0.55)continue;
    // параболическое уточнение вершины: без него тон «ступенькой»
    const a=best>minLag?diff[best-1]:diff[best];
    const b=diff[best];
    const c=best<maxLag?diff[best+1]:diff[best];
    const bottom=a-2*b+c;
    const shift=Math.abs(bottom)<1e-12?0:(a-c)/(2*bottom);
    const lag=best+Math.max(-1,Math.min(1,shift));
    hz[f]=rate/lag;
    clarity[f]=Math.max(0,1-bestValue);
  }
  return {times,hz,clarity,rms};
}

export const hzToMidi=hz=>69+12*Math.log2(hz/440);
/** Разница в полутонах без учёта октавы: люди поют в своей тесситуре. */
export function semitoneGap(sungMidi,targetMidi){
  let gap=(sungMidi-targetMidi)%12;
  if(gap>6)gap-=12;
  if(gap<-6)gap+=12;
  return gap;
}
