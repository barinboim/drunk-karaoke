import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCorpus,analyzeSong,analyzeWord,generate,positionAt,normalize,rhymeScore,splitRecords,detectMode,heldVowel,LONG_NOTE} from '../dist/engine.js';
import {parseUltraStar} from '../dist/ultrastar.js';
import {analyzeEnglishWord,splitEnglishSyllables,detectLanguage} from '../dist/engine.js';

const at=name=>new URL(`../dist/data/${name}`,import.meta.url);
const dictionary=new Map(Object.entries(JSON.parse(fs.readFileSync(at('dictionary.json'),'utf8'))));
const menu=fs.readFileSync(at('menu.txt'),'utf8');
// Своя проза для проверки клауз: корпусов-прозы в поставке нет, а режим есть.
const PROSE='Вечер тихий, и ветер уже улёгся. Мы сидим у воды, молчим и ждём, пока дым уйдёт за реку. Ничего не случилось, просто стало поздно.';

// A compact chart standing in for a real song: two verse shapes plus a chorus sung three times.
const CHART=[
  '#TITLE:Проверка','#ARTIST:Тест','#BPM:120','#GAP:1000',
  ': 0 4 0 Хо',': 4 4 0 ло',': 8 4 0 дный',': 12 8 0  ве',': 20 4 0 тер','- 28',
  ': 32 4 0 Тё',': 36 4 0 плый',': 40 4 0  до',': 44 8 0 ждь',': 52 4 0  тут','- 60',
  ': 64 4 0 При',': 68 4 0 пев','- 76',
  ': 80 4 0 При',': 84 4 0 пев','- 92',
  ': 96 4 0 При',': 100 4 0 пев','E',
].join('\n');
const song=parseUltraStar(CHART);

// A longer fixture (own words, not a real song) so the continuity metric has enough transitions.
const chartOf=(rows,hold=0)=>{
  const out=['#TITLE:Длинная проверка','#ARTIST:Тест','#BPM:120','#GAP:0'];let beat=0;
  for(const row of rows){row.forEach((part,i)=>{const len=(hold&&i===hold)?40:4;out.push(`: ${beat} ${len} 0 ${part}`);beat+=len;});out.push(`- ${beat}`);beat+=4;}
  return out.concat('E').join('\n');
};
const VERSES=[
  ['Ве','чер',' ти','хий',' и',' свет','лый'],
  ['Ве','тер',' спит',' на',' ре','ке'],
  ['Мы',' си','дим',' у',' во','ды',' и',' мол','чим'],
  ['Дым',' ухо','дит',' в',' зак','ат'],
  ['Го','род',' гас','нет',' вни','зу',' поти','хонь','ку'],
  ['Свет',' в',' ок','не',' до',' ут','ра'],
  ['Кто',' ку','пил',' нам',' би','лет',' в',' ни','ку','да'],
  ['Мы',' не',' зна','ем',' по','ка'],
  ['Про','сто',' пой'],['Про','сто',' пой'],['Про','сто',' пой'],['Про','сто',' пой'],
];
const LONG=parseUltraStar(chartOf(VERSES));
// та же фикстура, но третий слог каждой строки тянется — как в припеве настоящей песни
const HELD_SONG=parseUltraStar(chartOf(VERSES,2));

const lengths=[...new Set(song.lines.map(line=>line.notes.length))];
const corpus=buildCorpus(menu,dictionary,{lengths});
const analysis=analyzeSong(song,dictionary);

test('the menu corpus is a list of whole records grouped into sections', () => {
  assert.equal(detectMode(menu),'list');
  const records=splitRecords(menu,'list');
  assert.ok(records.length>400);
  assert.ok(new Set(records.map(r=>r.section)).size>10);
  // every record is one verbatim line of the source file
  const rows=new Set(menu.split('\n').map(r=>r.trim()));
  for(const record of records)assert.ok(rows.has(record.text),`«${record.text}» нет в файле построчно`);
});

test('prose is cut at punctuation, never mid-thought', () => {
  assert.equal(detectMode(PROSE),'prose');
  const records=splitRecords(PROSE,'prose');
  assert.ok(records.length>3);
  for(const record of records){
    assert.equal(record.text,record.text.trim());
    assert.equal(PROSE.slice(record.start,record.end),record.text);
    assert.ok(!/^[,.;:!?…]/.test(record.text));
  }
});

test('every line is made of whole records, never cut', () => {
  const rows=new Set(menu.split('\n').map(r=>r.trim()));
  for(let seed=0;seed<60;seed++){
    const {lines}=generate(song,corpus,seed,analysis);
    assert.equal(lines.length,song.lines.length);
    lines.forEach((line,i)=>{
      assert.equal(line.syllables.length,song.lines[i].notes.length,'слогов ровно по нотам');
      assert.equal(line.syllables.join(''),line.items.join(''),'слоги восстанавливают записи без потерь');
      line.items.forEach((item,k)=>{
        assert.equal(item,corpus.records[line.indices[k]].text);
        assert.ok(rows.has(item),`«${item}» не целая строка корпуса`);
      });
      assert.equal(line.indices.length,line.items.length);
    });
  }
});

test('repeated song lines get one and the same replacement', () => {
  const {lines}=generate(song,corpus,5,analysis);
  const chorus=song.lines.map((line,i)=>[normalize(line.original),i]).filter(([key])=>key==='припев').map(([,i])=>i);
  assert.equal(chorus.length,3);
  assert.equal(new Set(chorus.map(i=>lines[i].text)).size,1);
  assert.ok(lines[chorus[0]].repeat);
  // and different song lines still get different text
  assert.notEqual(lines[0].text,lines[1].text);
});

test('a line does not repeat itself: no twin sections, no twin first words', () => {
  const wide=buildCorpus(menu,dictionary,{lengths:[...new Set(LONG.lines.map(l=>l.notes.length))]});
  const plan=analyzeSong(LONG,dictionary);
  let pairs=0,sameSection=0,sameHead=0;
  for(let seed=0;seed<40;seed++){
    const {groups}=generate(LONG,wide,seed,plan);
    for(const group of groups)
      for(let i=1;i<group.picks.length;i++){
        pairs++;
        const before=wide.records[group.picks[i-1]],now=wide.records[group.picks[i]];
        if(before.section&&before.section===now.section)sameSection++;
        if(before.head&&before.head===now.head)sameHead++;
      }
  }
  assert.ok(pairs>50,'слишком мало пар для проверки');
  assert.ok(sameSection/pairs<.2,`соседей из одного раздела ${Math.round(100*sameSection/pairs)}%`);
  assert.equal(sameHead,0,'два соседа с одинаковым первым словом');
});

test('a long note lands on a vowel you can actually hold', () => {
  const wide=buildCorpus(menu,dictionary,{lengths:[...new Set(HELD_SONG.lines.map(l=>l.notes.length))]});
  const plan=analyzeSong(HELD_SONG,dictionary);
  let long=0,matched=0;
  for(let seed=0;seed<30;seed++){
    const {lines}=generate(HELD_SONG,wide,seed,plan);
    HELD_SONG.lines.forEach((line,i)=>line.notes.forEach((note,k)=>{
      if(note.end-note.start<LONG_NOTE)return;
      long++;
      if(heldVowel(note.text)===heldVowel(lines[i].syllables[k]))matched++;
    }));
  }
  assert.ok(long>20,'в фикстуре мало протяжных нот');
  // вслепую совпало бы около 1/6; требуем заметно лучше случайного
  assert.ok(matched/long>.4,`гласная совпала лишь в ${Math.round(100*matched/long)}% протяжных нот`);
});

test('seeds are reproducible and actually differ', () => {
  assert.deepEqual(generate(song,corpus,42,analysis).lines.map(l=>l.text),generate(song,corpus,42,analysis).lines.map(l=>l.text));
  const a=generate(song,corpus,42,analysis).lines.map(l=>l.text),b=generate(song,corpus,43,analysis).lines.map(l=>l.text);
  assert.notDeepEqual(a,b);
});

test('the menu corpus carries an explicit stress for every word', () => {
  assert.deepEqual(corpus.stats.unknownWords,[]);
});

test('stresses stay explicit; dictionary and accent marks both work', () => {
  assert.equal(analyzeWord('абракадабризм',new Map()).unknown,true);
  assert.deepEqual(analyzeWord('замок',new Map([['замок',[0,1]]])).stresses,[.5,.5]);
  assert.deepEqual(analyzeWord('замо́к',new Map()).stresses,[0,1]);
  assert.equal(rhymeScore(['атно'],['атно']),1);
  assert.equal(rhymeScore([],['а']),0);
});

test('an impossible line fails clearly instead of inventing words', () => {
  const tiny=buildCorpus('Борщ\nПлов\nКвас\n',dictionary,{lengths:[1,5]});
  assert.throws(()=>generate(song,tiny,1,analysis),/нет записей|не удалось подобрать/i);
});

test('UltraStar: quarter beats, merged consonants, split multi-vowel notes, duets', () => {
  assert.equal(song.lines[0].start,1);
  assert.equal(song.lines[0].notes.length,5);
  // one note carrying two vowels becomes two syllable slots
  const wide=parseUltraStar('#BPM:120\n#GAP:0\n: 0 8 0 тебя\n: 8 4 0  тут\n- 12\nE');
  assert.equal(wide.lines[0].notes.length,3);
  assert.equal(wide.lines[0].notes.map(n=>n.text).join(''),'тебя тут');
  // a consonant-only note merges into the syllable that follows it
  const glue=parseUltraStar('#BPM:120\n#GAP:0\n: 0 4 0 вс\n: 4 4 0 ё\n- 8\nE');
  assert.equal(glue.lines[0].notes.length,1);
  assert.equal(glue.lines[0].original,'всё');
  // two players collapse into one singable track ordered by time
  const duet=parseUltraStar('#BPM:120\n#GAP:0\nP1\n: 0 4 0 Раз\n- 4\nP2\n: 8 4 0 Два\n- 12\nE');
  assert.equal(duet.lines.length,2);
  assert.ok(duet.lines[0].start<duet.lines[1].start);
  // английская разметка теперь читается, и ноты в ней не дробятся по гласным буквам
  const english=parseUltraStar('#BPM:120\n#GAP:0\n: 0 4 0 through\n: 4 4 0  the\n- 8\nE');
  assert.equal(english.language,'en');
  assert.equal(english.lines[0].notes.length,2,'у английской ноты один слог, сколько бы в ней ни было гласных');
  assert.throws(()=>parseUltraStar('#GAP:0\n: 0 4 0 Раз\nE'),/BPM/);
});

test('playhead handles intro, gaps, exact boundaries and the outro', () => {
  assert.equal(positionAt(song.lines,0).next,0);
  assert.equal(positionAt(song.lines,song.lines[0].start+.01).active,0);
  assert.equal(positionAt(song.lines,song.lines[0].end).active,-1);
  assert.equal(positionAt(song.lines,song.duration).next,-1);
});

test('impossible lengths are reported, reachable ones are built', () => {
  const wide=buildCorpus(menu,dictionary,{lengths:[1,2,3,14,23]});
  assert.deepEqual(wide.missing,[],'меню должно покрывать все эти длины');
  const tiny=buildCorpus('Борщ\nПлов\nКвас\n',dictionary,{lengths:[1,2,7]});
  assert.deepEqual(tiny.missing,[7],'семь слогов из односложных записей не собрать при лимите в 4 штуки');
  assert.equal(generate(song,wide,42,analysis).lines.length,song.lines.length);
});

test('English words come from the pronouncing dictionary, not from spelling', () => {
  const cmu=fs.existsSync(at('cmudict.json'))
    ? new Map(Object.entries(JSON.parse(fs.readFileSync(at('cmudict.json'),'utf8'))))
    : null;
  if(!cmu){console.log('CMUdict не собран, пропускаем');return;}
  assert.equal(detectLanguage('boulevard of broken dreams'),'en');
  assert.equal(detectLanguage('салат цезарь с курицей'),'ru');
  // написание о слогах не говорит: три гласные буквы, один слог
  assert.equal(analyzeEnglishWord('through',cmu).count,1);
  assert.equal(analyzeEnglishWord('every',cmu).count,3);
  assert.equal(analyzeEnglishWord('beautiful',cmu).count,3);
  // главное ударение читается из словаря
  assert.deepEqual(analyzeEnglishWord('abandon',cmu).stresses,[0,1,0]);
  // деление написания восстанавливает слово целиком
  for(const word of ['abandon','beautiful','boulevard','yesterday','remember']){
    const parts=splitEnglishSyllables(word,analyzeEnglishWord(word,cmu).count);
    assert.equal(parts.join(''),word);
    assert.equal(parts.length,analyzeEnglishWord(word,cmu).count);
  }
});
