// Pure deterministic text matching. No models, inference services, or generated lyrics.
// A song line is filled with WHOLE records taken from the corpus in their original order.
// Records are never cut, reordered or invented; the search only decides which run to sing.
const VOWELS='аеёиоуыэюя';
const isVowel=c=>VOWELS.includes(c.toLowerCase());
export const normalize=text=>text.toLowerCase().replaceAll('́','').replaceAll('ё','е');
const countVowels=value=>(value.match(/[аеёиоуыэюя]/gi)||[]).length;
// Function words that must not be left dangling at the end of a prose fragment.
const endings=new Set('и а но что чтоб как бы же ли не ни это этот этой этом этого эти этих этим на от по с в к у со во для или где то да ну вот уж аж'.split(' '));
// Coordinating words that open a new thought: safe places to cut a long prose clause.
const joiners=new Set('и а но что чтобы чтоб как когда если или либо потому поэтому значит хотя пока'.split(' '));

export function splitSyllables(word) {
  const positions=[...word.matchAll(/[аеёиоуыэюя]́?/gi)].map(x=>x.index+x[0].length);
  return positions.length?positions.map((end,i)=>word.slice(i?positions[i-1]:0,i===positions.length-1?word.length:end)):[word];
}

export function analyzeWord(word,dictionary) {
  const letters=[...word.toLowerCase()],count=letters.filter(isVowel).length;
  let accents=[],vowel=-1;
  for(let i=0;i<letters.length;i++){if(isVowel(letters[i]))vowel++;if(letters[i]==='́')accents.push(vowel);}
  if(!accents.length)accents=dictionary.get(normalize(word))||[];
  if(!Array.isArray(accents))accents=[accents];
  if(!accents.length&&letters.includes('ё'))accents=[letters.slice(0,letters.indexOf('ё')+1).filter(isVowel).length-1];
  if(count===1)accents=[0];
  const stresses=Array.from({length:count},(_,i)=>count===1?.35:accents.length?(accents.includes(i)?1/accents.length:0):.5);
  const parts=splitSyllables(word),rhymes=accents.map(stress=>phoneticTail(parts.slice(stress).join('')));
  return {count,stresses,rhymes,unknown:count>1&&!accents.length,ambiguous:accents.length>1};
}

// Approximate pronunciation key from the stressed vowel; not a full phonology model.
export function phoneticTail(value) {
  return normalize(value).replace(/^[^аеёиоуыэюя]+/,'').replaceAll('ь','').replaceAll('ъ','').replaceAll('я','а').replaceAll('ю','у').replaceAll('щ','ш').replace(/тся$/,'ца').replace(/[дт]$/,'т').replace(/[бп]$/,'п').replace(/[гк]$/,'к').replace(/[вф]$/,'ф').replace(/[зс]$/,'с').replace(/[жш]$/,'ш');
}

// A project-local stress supplement. OpenRussian has no pronoun declension and no modern
// borrowings; rather than patch its build, we layer our own accented forms on top.
// Format: one accented word per line ("хачапу́ри"), "#" starts a comment.
export function parseAccents(text) {
  const accents=new Map();
  for(const raw of text.split('\n')) {
    const word=raw.split('#')[0].trim();
    if(!word||!/[а-яё]/i.test(word))continue;
    const marks=[];let vowel=-1;
    for(const letter of word.toLowerCase()){
      if(isVowel(letter))vowel++;
      if(letter==='\u0301')marks.push(vowel);
    }
    if(!marks.length&&word.toLowerCase().includes('ё'))
      marks.push([...word.toLowerCase().slice(0,word.toLowerCase().indexOf('ё')+1)].filter(isVowel).length-1);
    if(marks.length)accents.set(normalize(word),marks);
  }
  return accents;
}

// The supplement wins over the dictionary: it is the place where a wrong stress gets fixed.
export function withAccents(dictionary,accents) {
  if(!accents?.size)return dictionary;
  const merged=new Map(dictionary);
  for(const [word,marks] of accents)merged.set(word,marks);
  return merged;
}

export function tokenize(text,dictionary) {
  return [...text.matchAll(/[а-яё́]+/gi)].map(match=>({word:match[0],start:match.index,end:match.index+match[0].length,...analyzeWord(match[0],dictionary)}));
}

export function randomGenerator(seed) {
  let value=seed>>>0;
  return ()=>{value+=0x6D2B79F5;let t=value;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}

export function rhymeScore(a,b) {
  let best=0;
  for(const x of a||[])for(const y of b||[]){if(x===y){best=1;continue;}let common=0;while(common<Math.min(x.length,y.length)&&x.at(-common-1)===y.at(-common-1))common++;if(common>=2)best=Math.max(best,.4);}
  return best;
}

// ---------------------------------------------------------------------------
// Records: the indivisible unit of substitution.
// A list file gives one record per line. Prose is cut at punctuation, so a
// record is a finished clause rather than an arbitrary window of words.
// ---------------------------------------------------------------------------
export function detectMode(text) {
  const rows=text.split('\n').map(r=>r.trim()).filter(Boolean);
  if(rows.length<8)return 'prose';
  const short=rows.filter(r=>r.length<=70&&!/[.!?…]$/.test(r)).length;
  return short/rows.length>.75?'list':'prose';
}

function listRecords(text) {
  const records=[];let section='',offset=0;
  for(const row of text.split('\n')) {
    const trimmed=row.trim();
    const at=offset+row.indexOf(trimmed);
    offset+=row.length+1;
    if(!trimmed||trimmed.startsWith('//'))continue;
    if(/^#{1,3}\s*\S/.test(trimmed)){section=trimmed.replace(/^#+\s*/,'');continue;}
    if(!countVowels(trimmed))continue;
    records.push({text:trimmed,start:at,end:at+trimmed.length,section,hard:true});
  }
  return records;
}

function proseRecords(text) {
  const records=[];
  const pieces=[...text.matchAll(/[^\n]+/g)];
  for(const piece of pieces) {
    const base=piece.index;
    // Clause boundaries first: every record ends on real punctuation.
    const clauses=[...piece[0].matchAll(/[^,.;:!?…\n]+[,.;:!?…]*/g)];
    for(const clause of clauses) {
      const raw=clause[0];
      const lead=raw.match(/^\s*/)[0].length,body=raw.slice(lead).replace(/\s+$/,'');
      if(!body||!countVowels(body))continue;
      const start=base+clause.index+lead;
      if(countVowels(body)<=10){records.push({text:body,start,end:start+body.length,hard:/[.!?…]$/.test(body),section:''});continue;}
      // Long clauses are cut again, but only in front of a word that opens a new thought.
      const words=[...body.matchAll(/[а-яё́]+/gi)];
      let from=0;
      for(let w=1;w<words.length;w++) {
        if(!joiners.has(normalize(words[w][0])))continue;
        if(countVowels(body.slice(from,words[w].index))<4)continue;
        const chunk=body.slice(from,words[w].index).replace(/\s+$/,'');
        if(countVowels(chunk)){records.push({text:chunk,start:start+from,end:start+from+chunk.length,hard:false,section:''});from=words[w].index;}
      }
      const tail=body.slice(from);
      if(countVowels(tail))records.push({text:tail,start:start+from,end:start+from+tail.length,hard:/[.!?…]$/.test(tail),section:''});
    }
  }
  return records;
}

export function splitRecords(text,mode) {
  return (mode||detectMode(text))==='list'?listRecords(text):proseRecords(text);
}

// Долгую ноту тянут на гласной, а не на слоге целиком: «я» поётся как [а], «ё» как [о].
const HELD={'а':'а','я':'а','о':'о','ё':'о','у':'у','ю':'у','э':'э','е':'э','и':'и','ы':'и'};
export function heldVowel(part){
  const found=(String(part).toLowerCase().replace(/́/g,'').match(/[аеёиоуыэюя]/g)||[]).at(-1);
  return found?HELD[found]||found:'';
}
// Тянуть можно гласную и сонорную; на «шот» или «песок» долгую ноту не вытянешь.
const canHold=part=>/[аеёиоуыэюялмнрйь]$/.test(String(part).toLowerCase().replace(/́/g,'').trim());
/** Нота считается протяжной, если её заметно тянут. */
export const LONG_NOTE=0.9;

function describe(record,dictionary) {
  const tokens=tokenize(record.text,dictionary);
  const stresses=tokens.flatMap(t=>t.stresses);
  const vowels=[],open=[];
  for(const token of tokens){
    if(!token.count)continue;
    for(const part of splitSyllables(token.word)){vowels.push(heldVowel(part));open.push(canHold(part));}
  }
  return {
    ...record,count:stresses.length,stresses,vowels,open,
    unknown:stresses.length?tokens.filter(t=>t.unknown).reduce((a,t)=>a+t.count,0)/stresses.length:0,
    rhymes:tokens.at(-1)?.rhymes||[],lastWord:normalize(tokens.at(-1)?.word||''),
    head:normalize(tokens[0]?.word||''),
    dangling:tokens.length>1&&endings.has(normalize(tokens.at(-1).word)),
    tokens,
  };
}

export function buildCorpus(text,dictionary,{lengths,mode,maxItems=4}={}) {
  if(!lengths?.length)throw Error('Для индекса нужны длины строк песни');
  const wanted=[...new Set(lengths.filter(n=>n>0))],max=Math.max(...wanted);
  if(max>128)throw Error('В этой версии строка может содержать не более 128 слогов');
  const kind=mode||detectMode(text);
  const records=splitRecords(text,kind).map(r=>describe(r,dictionary)).filter(r=>r.count&&!r.dangling);
  if(!records.length)throw Error('В корпусе не нашлось ни одной записи с русскими словами.');

  const byLength=new Map();
  records.forEach((record,index)=>{
    if(!byLength.has(record.count))byLength.set(record.count,[]);
    byLength.get(record.count).push(index);
  });
  const available=[...byLength.keys()].sort((a,b)=>a-b);
  // feasible[k][rest] — можно ли набрать ровно rest слогов не более чем из k записей.
  // Благодаря этой таблице выборка комбинаций никогда не заходит в тупик.
  const feasible=Array.from({length:maxItems+1},()=>new Uint8Array(max+1));
  for(let k=0;k<=maxItems;k++)feasible[k][0]=1;
  for(let k=1;k<=maxItems;k++)
    for(let rest=1;rest<=max;rest++)
      for(const size of available){if(size<=rest&&feasible[k-1][rest-size]){feasible[k][rest]=1;break;}}

  const missing=wanted.filter(n=>!feasible[maxItems][n]);
  const flat=records.flatMap(r=>r.tokens);
  return {text,mode:kind,records,byLength,available,feasible,maxItems,missing,stats:{
    mode:kind,records:records.length,words:flat.length,
    unknownWords:[...new Set(flat.filter(t=>t.unknown).map(t=>t.word.toLowerCase()))],
    ambiguousWords:[...new Set(flat.filter(t=>t.ambiguous).map(t=>t.word.toLowerCase()))],
    lengths:Object.fromEntries(available.map(n=>[n,byLength.get(n).length])),
    sections:[...new Set(records.map(r=>r.section).filter(Boolean))],
  }};
}

// ---------------------------------------------------------------------------
// Song side: syllable slots, stress template, repeated lines folded into groups.
// ---------------------------------------------------------------------------
export function analyzeSong(song,dictionary) {
  const templates=song.lines.map(line=>{
    const tokens=tokenize(line.original,dictionary);
    const stresses=tokens.flatMap(t=>t.stresses);
    const slots=line.notes.length;
    while(stresses.length<slots)stresses.push(.5);            // markup noise stays neutral instead of fatal
    return {stresses:stresses.slice(0,slots),slots,rhymes:tokens.at(-1)?.rhymes||[],
      unknownWords:tokens.filter(t=>t.unknown).map(t=>t.word),
      key:normalize(line.original).replace(/\s+/g,' ').trim()};
  });
  const groups=[],index=new Map();
  templates.forEach((template,i)=>{
    const key=`${template.key}|${template.slots}`;
    if(index.has(key)){groups[index.get(key)].lines.push(i);return;}
    index.set(key,groups.length);
    const notes=song.lines[i].notes;
    groups.push({lines:[i],slots:template.slots,stresses:template.stresses,rhymes:template.rhymes,rhymeWith:-1,
      notes,
      // что именно тянут на каждой ноте — нужно для протяжных мест
      held:notes.map(note=>heldVowel(note.text)),
      spans:notes.map(note=>note.end-note.start)});
  });
  groups.forEach((group,g)=>{for(let p=g-1;p>=Math.max(0,g-4);p--)if(rhymeScore(group.rhymes,groups[p].rhymes)===1){group.rhymeWith=p;break;}});
  return {templates,groups};
}

function materialize(picks,corpus) {
  const items=[],syllables=[],itemStarts=[];
  for(const index of picks) {
    const record=corpus.records[index];
    itemStarts.push(syllables.length);
    items.push(record.text);
    let prefix=record.tokens.length?record.text.slice(0,record.tokens[0].start):record.text;
    record.tokens.forEach((token,n)=>{
      const separator=n?record.text.slice(record.tokens[n-1].end,token.start):'';
      if(!token.count){prefix+=separator+token.word;return;}
      splitSyllables(token.word).forEach((part,s)=>{syllables.push((s===0?prefix+separator:'')+part);prefix='';});
    });
    if(record.tokens.length)prefix+=record.text.slice(record.tokens.at(-1).end);
    if(prefix&&syllables.length)syllables[syllables.length-1]+=prefix;
  }
  const first=corpus.records[picks[0]],last=corpus.records[picks.at(-1)];
  return {indices:[...picks],start:first.start,end:last.end,section:first.section,
    text:items.join(' · '),items,syllables,itemStarts,units:picks.length};
}

// Выбор комбинации: длина берётся с весом в пользу длинных записей, чтобы строка
// собиралась из одной-трёх позиций, а не из горсти односложных.
function sampleCombo(corpus,need,random) {
  const picks=[];let rest=need,budget=corpus.maxItems;
  while(rest>0&&budget>0) {
    const choices=corpus.available.filter(size=>size<=rest&&corpus.feasible[budget-1][rest-size]);
    if(!choices.length)return null;
    let total=0;for(const size of choices)total+=size;
    let roll=random()*total,size=choices[choices.length-1];
    for(const option of choices){roll-=option;if(roll<=0){size=option;break;}}
    const pool=corpus.byLength.get(size);
    picks.push(pool[Math.floor(random()*pool.length)]);
    rest-=size;budget--;
  }
  return rest===0?picks:null;
}

function scoreCombo(picks,group,corpus,used,paired) {
  const records=picks.map(index=>corpus.records[index]);
  let mismatch=0,weight=0,slot=0;
  let longNotes=0,vowelHits=0,holdMisses=0;
  for(const record of records) {
    for(let k=0;k<record.count;k++,slot++) {
      const span=group.spans[slot]??.25;
      const target=group.stresses[slot],source=record.stresses[k];
      if(!(source===.35||target===.35||target===.5)) {
        const w=1+Math.min(1,span/.6);
        mismatch+=Math.abs(target-source)*w;weight+=w;
      }
      if(span>=LONG_NOTE) {                       // протяжное место: важна сама гласная
        longNotes++;
        if(group.held[slot]&&group.held[slot]===record.vowels[k])vowelHits++;
        if(!record.open[k])holdMisses++;
      }
    }
  }
  mismatch=weight?mismatch/weight:0;
  const vowelFit=longNotes?vowelHits/longNotes:0;
  const holdFail=longNotes?holdMisses/longNotes:0;
  const last=records.at(-1);
  const rhyme=paired?rhymeScore(last.rhymes,paired.rhymes):0;
  const sameLast=paired&&last.lastWord===paired.lastWord;
  let reused=0;for(const index of picks)if(used.has(index))reused++;
  const unknown=records.reduce((sum,record)=>sum+record.unknown*record.count,0)/group.slots;
  // однообразие внутри строки: «Пицца … · Пицца …» и соседи из одного раздела
  let sameHead=0,sameSection=0;
  for(let i=1;i<records.length;i++){
    if(records[i].head&&records[i].head===records[i-1].head)sameHead++;
    if(records[i].section&&records[i].section===records[i-1].section)sameSection++;
  }
  // если записи всё же оказались соседями в файле — это приятно, но не обязательно
  let adjacent=0;
  for(let i=1;i<picks.length;i++)if(picks[i]===picks[i-1]+1)adjacent++;
  const score=-mismatch*3.5+vowelFit*1.6-holdFail*.9+rhyme*.55-(sameLast?.9:0)
    -unknown*.7-reused/picks.length*1.8-sameHead*.7-sameSection*.3
    +adjacent*.25-Math.max(0,picks.length-3)*.12;
  return {score,mismatch,rhyme,vowelFit,holdFail};
}

export function generate(song,corpus,seed,analysis,{beam=6,branch=6,tries=220,jitter=.35}={}) {
  if(!analysis?.groups)throw Error('Сначала извлеките шаблоны из песни');
  const {groups,templates}=analysis,random=randomGenerator(seed);
  let beams=[{used:new Set(),texts:new Set(),picks:[],score:0}];
  for(let g=0;g<groups.length;g++) {
    const group=groups[g];
    if(!corpus.feasible[corpus.maxItems][group.slots])
      throw Error(`В корпусе нет записей, которые складываются ровно в ${group.slots} ${group.slots===1?'слог':group.slots<5?'слога':'слогов'} (строка ${group.lines[0]+1}). Нужны записи других длин.`);
    const next=[];
    for(const state of beams) {
      const paired=group.rhymeWith>=0?state.picks[group.rhymeWith]:null;
      const ranked=[],seen=new Set();
      for(let t=0;t<tries;t++) {
        const picks=sampleCombo(corpus,group.slots,random);
        if(!picks)continue;
        const key=picks.join(',');
        if(seen.has(key)||state.texts.has(key))continue;
        seen.add(key);
        const judged=scoreCombo(picks,group,corpus,state.used,paired?paired.last:null);
        ranked.push({picks,key,...judged,noise:judged.score+(random()-.5)*jitter});
      }
      if(!ranked.length)continue;
      ranked.sort((a,b)=>b.noise-a.noise);
      for(const choice of ranked.slice(0,branch)) {
        const used=new Set(state.used);for(const index of choice.picks)used.add(index);
        next.push({used,texts:new Set(state.texts).add(choice.key),
          picks:[...state.picks,{picks:choice.picks,last:corpus.records[choice.picks.at(-1)],
            mismatch:choice.mismatch,rhyme:choice.rhyme,vowelFit:choice.vowelFit}],
          score:state.score+choice.score});
      }
    }
    if(!next.length)throw Error(`Не удалось подобрать непохожие записи для строки ${group.lines[0]+1}. Возьми корпус побольше.`);
    next.sort((a,b)=>b.score-a.score);
    beams=next.slice(0,beam);
  }
  const best=beams[0];
  const lines=[];
  groups.forEach((group,g)=>{
    const pick=best.picks[g],body=materialize(pick.picks,corpus);
    for(const line of group.lines)lines[line]={...body,group:g,repeat:group.lines.length>1,
      fit:Math.round((1-pick.mismatch)*100),rhymeFit:pick.rhyme,vowelFit:pick.vowelFit,rhymeWith:group.rhymeWith};
  });
  return {lines,groups:groups.map((group,g)=>({lines:group.lines,slots:group.slots,picks:best.picks[g].picks})),
    score:best.score,templates};
}

/**
 * Обычное караоке: строки песни как есть. Подбирать нечего — послоговая разбивка
 * уже лежит в разметке, каждая нота несёт свой слог. Возвращаем ту же форму, что и
 * generate(), чтобы экран и студия не знали о разнице.
 */
export function originalVersion(song) {
  const lines=song.lines.map(line=>({
    indices:[],items:[line.original],section:'',
    text:line.original,
    syllables:line.notes.map(note=>note.text),
    itemStarts:[0],units:1,group:-1,repeat:false,
    fit:100,rhymeFit:0,vowelFit:1,rhymeWith:-1,
  }));
  return {lines,stats:{
    mode:'original',records:song.lines.length,
    words:song.lines.reduce((sum,line)=>sum+(line.original.match(/[а-яё\u0301]+/gi)||[]).length,0),
    unknownWords:[],ambiguousWords:[],songUnknownWords:[],sections:[],
    lengths:{},groups:song.lines.length,lines:song.lines.length,
  }};
}

export function positionAt(lines,time) {
  const active=lines.findIndex(line=>time>=line.start&&time<line.end);
  if(active>=0)return {active,next:active+1<lines.length?active+1:-1,syllable:lines[active].notes.findIndex(n=>time>=n.start&&time<n.end)};
  return {active:-1,next:lines.findIndex(line=>line.start>time),syllable:-1};
}
