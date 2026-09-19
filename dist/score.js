// Оценка пения. Считаем по тому, что и так лежит в разметке: у каждой ноты есть
// высота, длительность и признак золотой. Сравниваем с тем, что реально спето.
//
// Октава не важна: человек поёт в своей тесситуре, поэтому разница берётся по
// кругу из двенадцати полутонов — так делают все караоке-системы.
import {detectPitches,hzToMidi,semitoneGap} from './pitch.js';

const CLEAR=0.55;        // ниже этого тон найден неуверенно
const LOUD=0.012;        // ниже этого считаем, что человек молчит
const VOICED=0.35;       // доля озвученных кадров, чтобы засчитать попадание в ноту

/** Попадание в полутон: до 0.6 — чисто, дальше плавно к нулю на 2.2. */
export function credit(gap){
  const off=Math.abs(gap);
  if(off<=0.6)return 1;
  if(off>=2.2)return 0;
  return (2.2-off)/1.6;
}

/** Вес ноты: длинную держать труднее, но одна нота не должна решать всё. */
const weightOf=note=>Math.min(3,Math.max(1,(note.end-note.start)/0.3))*(note.golden?2:1);

/**
 * Разбирает один дубль и раскладывает по нотам песни.
 * take: {samples, sampleRate, at} — at это момент песни для первого сэмпла.
 */
export function measureTake(take,lines){
  const {times,hz,clarity,rms}=detectPitches(take.samples,take.sampleRate);
  // Запись шире реплики: в запас до и после попадают куски соседних строк.
  // Оцениваем только ноты, которые целиком лежат внутри дубля, иначе соседняя
  // строка получит незаслуженный ноль за то, что её просто не начинали петь.
  const from=take.at, to=take.at+take.samples.length/take.sampleRate;
  const notes=[];
  for(const [lineIndex,line] of lines.entries()){
    // Дубль реплики знает свою строку: музыка подводила к ней три секунды и
    // захватила хвост предыдущей, но петь просили только эту.
    if(take.line!==undefined&&take.line!==null&&take.line!==lineIndex)continue;
    for(const [noteIndex,note] of line.notes.entries()){
      if(note.free)continue;                       // свободные ноты не оцениваются
      const inside=Math.min(note.end,to)-Math.max(note.start,from);
      if(inside<(note.end-note.start)*0.8)continue;
      let frames=0,voiced=0,sum=0;
      for(let f=0;f<times.length;f++){
        const when=take.at+times[f];
        if(when<note.start)continue;
        if(when>=note.end)break;
        frames++;
        if(hz[f]>0&&clarity[f]>=CLEAR&&rms[f]>=LOUD){
          voiced++;
          sum+=credit(semitoneGap(hzToMidi(hz[f]),note.pitch+60));
        }
      }
      if(!frames)continue;                          // нота вне записанного отрезка
      const share=voiced/frames;
      notes.push({line:lineIndex,note:noteIndex,golden:Boolean(note.golden),
        weight:weightOf(note),frames,share,
        accuracy:voiced?sum/voiced:0,
        hit:share>=VOICED});
    }
  }
  return notes;
}

const RATINGS=[
  [9200,'ЗОЛОТОЙ ГОЛОС','Соседи записывают на диктофон'],
  [8200,'ЗВЕЗДА РАЙОНА','В этом зале тебе равных нет'],
  [7000,'ПОЁШЬ ХОРОШО','Ноты знают тебя в лицо'],
  [5800,'УВЕРЕННЫЙ ЛЮБИТЕЛЬ','Уже не стыдно, уже почти песня'],
  [4400,'БЫВАЕТ И ЛУЧШЕ','Мелодия угадывается'],
  [3000,'ЕСТЬ КУДА РАСТИ','Слова были правильные'],
  [1500,'МИМО НОТ, НО С ДУШОЙ','Зато громко'],
  [0,'А МИКРОФОН ВКЛЮЧЁН?','Мы ничего не услышали'],
];
export const ratingFor=total=>RATINGS.find(([from])=>total>=from);

/**
 * Сводит замеры в оценку. Отдельно показываем интонацию, ритм, золотые ноты
 * и охват — чтобы человек видел, над чем работать, а не одну голую цифру.
 */
export function summarize(measured,lines){
  const singable=lines.flatMap(line=>line.notes.filter(note=>!note.free));
  const totalWeight=singable.reduce((sum,note)=>sum+weightOf(note),0)||1;

  let pitchWeight=0,pitchSum=0,hits=0,goldWeight=0,goldSum=0,covered=0;
  const perLine=new Map();
  for(const item of measured){
    covered+=1;
    pitchWeight+=item.weight;
    pitchSum+=item.accuracy*item.weight;
    if(item.hit)hits++;
    if(item.golden){goldWeight+=item.weight;goldSum+=item.accuracy*item.weight;}
    const line=perLine.get(item.line)||{weight:0,sum:0,hits:0,notes:0};
    line.weight+=item.weight;line.sum+=item.accuracy*item.weight;
    line.notes++;if(item.hit)line.hits++;
    perLine.set(item.line,line);
  }

  const pitch=pitchWeight?pitchSum/pitchWeight:0;
  const rhythm=measured.length?hits/measured.length:0;
  const golden=goldWeight?goldSum/goldWeight:null;
  const coverage=singable.length?Math.min(1,measured.reduce((sum,item)=>sum+item.weight,0)/totalWeight):0;

  const total=Math.round(10000*(0.60*pitch+0.22*rhythm+0.08*(golden??pitch)+0.10*coverage));
  const [,title,quip]=ratingFor(total);
  return {
    total,title,quip,
    pitch:Math.round(pitch*100),
    rhythm:Math.round(rhythm*100),
    golden:golden===null?null:Math.round(golden*100),
    coverage:Math.round(coverage*100),
    notes:measured.length,
    lines:[...perLine].map(([line,data])=>({
      line,notes:data.notes,
      pitch:Math.round((data.weight?data.sum/data.weight:0)*100),
      rhythm:Math.round((data.notes?data.hits/data.notes:0)*100),
    })).sort((a,b)=>a.line-b.line),
  };
}

/** Весь путь целиком: дубли → замеры → оценка. */
export function scoreTakes(takes,lines){
  const measured=takes.flatMap(take=>measureTake(take,lines));
  return summarize(measured,lines);
}
