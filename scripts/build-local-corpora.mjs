// Build the locally selected experimental corpora from frozen source files.
import fs from 'node:fs';
import * as parquet from 'parquet-wasm';
import * as arrow from 'apache-arrow';

const root = new URL('..', import.meta.url).pathname;
const sourceDir = `${root}.corpus-source/`;
const outputDir = `${root}dist/corpora/`;
const dictionary = new Set(Object.keys(JSON.parse(fs.readFileSync(`${root}dist/data/dictionary.json`, 'utf8'))));
for (const line of fs.readFileSync(`${root}dist/data/accents.txt`, 'utf8').split(/\r?\n/)) {
  const word = line.split('#')[0].trim().toLowerCase().replace(/́/g, '');
  if (/^[а-яё]+$/.test(word)) dictionary.add(word);
}

const ones = ['ноль','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
const teens = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
const tens = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
const hundreds = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const ordinals = ['','первого','второго','третьего','четвёртого','пятого','шестого','седьмого','восьмого','девятого','десятого','одиннадцатого','двенадцатого','тринадцатого','четырнадцатого','пятнадцатого','шестнадцатого','семнадцатого','восемнадцатого','девятнадцатого','двадцатого','двадцать первого','двадцать второго','двадцать третьего','двадцать четвёртого','двадцать пятого','двадцать шестого','двадцать седьмого','двадцать восьмого','двадцать девятого','тридцатого','тридцать первого'];
function numberWords(input) {
  const n = Number(input);
  if (!Number.isSafeInteger(n) || n < 0 || n > 999999) return '';
  if (!n) return 'ноль';
  const under = value => {
    const out = [];
    if (value >= 100) { out.push(hundreds[Math.floor(value / 100)]); value %= 100; }
    if (value >= 10 && value < 20) out.push(teens[value - 10]);
    else { if (value >= 20) { out.push(tens[Math.floor(value / 10)]); value %= 10; } if (value) out.push(ones[value]); }
    return out;
  };
  const out = [];
  if (n >= 1000) {
    const thousands = Math.floor(n / 1000);
    const lastTwo = thousands % 100;
    const last = thousands % 10;
    out.push(under(thousands).join(' '));
    out.push(lastTwo >= 11 && lastTwo <= 19 ? 'тысяч' : last === 1 ? 'тысяча' : last >= 2 && last <= 4 ? 'тысячи' : 'тысяч');
  }
  if (n % 1000) out.push(under(n % 1000).join(' '));
  return out.join(' ');
}
const latin = {a:'а',b:'б',c:'к',d:'д',e:'е',f:'ф',g:'г',h:'х',i:'и',j:'дж',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',q:'к',r:'р',s:'с',t:'т',u:'у',v:'в',w:'в',x:'кс',y:'й',z:'з'};
function normalize(input) {
  let text = String(input || '').replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+|www\.\S+/gi, ' ');
  text = text.replace(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g, (_, day, month, year) => {
    const monthName = months[Number(month) - 1];
    return monthName ? `${ordinals[Number(day)] || numberWords(day)} ${monthName} ${numberWords(year)} года` : `${numberWords(day)} ${numberWords(month)} ${numberWords(year)}`;
  });
  text = text.replace(/\b(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b/gi,
    (_, day, month) => `${ordinals[Number(day)] || numberWords(day)} ${month}`);
  text = text.replace(/(?<!\d)(\d+)\s*%/g, (_, n) => `${numberWords(n)} процентов`);
  text = text.replace(/(?<!\d)(\d+)\s*[–-]\s*(\d+)(?!\d)/g, (_, a, b) => `${numberWords(a)}-${numberWords(b)}`);
  text = text.replace(/(?<!\d)(\d+)[,.](\d+)(?!\d)/g, (_, a, b) => `${numberWords(a)} целых ${numberWords(b)} десятых`);
  text = text.replace(/(?<!\d)-(\d+)(?!\d)/g, (_, n) => `минус ${numberWords(n)}`);
  text = text.replace(/(?<!\d)\d+(?!\d)/g, n => numberWords(n) || ' ');
  text = text.replace(/[A-Za-z]+/g, word => [...word.toLowerCase()].map(ch => latin[ch] || ch).join(''));
  return text.replace(/[“”«»"„`]/g, ' ').replace(/[|_~^*]+/g, ' ')
    .replace(/[^А-Яа-яЁё\s.,!?;:()'’—-]/g, ' ').replace(/\s+/g, ' ').trim();
}
const syllables = text => (text.match(/[аеёиоуыэюя]/gi) || []).length;
function known(text) {
  const words = text.toLowerCase().replace(/́/g, '').match(/[а-яё]+/g) || [];
  return words.length > 0 && words.every(word => dictionary.has(word) || syllables(word) === 1);
}
function write(name, about, source, section, candidates, limit = 3000) {
  const seen = new Set();
  const unique = candidates.filter(text => {
    const key = text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
    if (!text || !known(text) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(text => ({text, count:syllables(text)}));
  const core = unique.filter(row => row.count >= 8 && row.count <= 16);
  const tail = unique.filter(row => row.count < 8 || row.count > 16);
  const mandatory = [];
  const reserved = new Set();
  for (let n = 1; n <= 24; n++) {
    const row = unique.find(item => item.count === n);
    if (row) { mandatory.push(row); reserved.add(row); }
  }
  const even = (rows, count) => {
    const take = Math.min(count, rows.length);
    return take ? Array.from({length:take}, (_, i) => rows[Math.floor(i * rows.length / take)]) : [];
  };
  const coreRows = even(core.filter(row => !reserved.has(row)), Math.max(0, Math.ceil(limit * .8) - mandatory.filter(row => row.count >= 8 && row.count <= 16).length));
  const tailRows = even(tail.filter(row => !reserved.has(row)), Math.max(0, limit - Math.ceil(limit * .8) - mandatory.filter(row => row.count < 8 || row.count > 16).length));
  const records = [...coreRows, ...mandatory, ...tailRows].slice(0, limit);
  const output = [`---`,`name: ${name}`,`about: ${about}`,`mode: list`,`---`,``,`## ${section}`,...records.map(row => row.text),''].join('\n');
  fs.writeFileSync(`${outputDir}${name === 'Отзывы о кино' ? 'movie-reviews' : 'youtube-comments'}.txt`, output, 'utf8');
  const sortedLengths = records.map(row => row.count).sort((a, b) => a - b);
  console.log(`${name}: ${records.length} строк, медиана ${sortedLengths[Math.floor(sortedLengths.length / 2)] || 0} слогов (проверено ${unique.length} подходящих исходных строк)`);
}

const commentsPath = `${sourceDir}youtube-shorts-comments.txt`;
if (!fs.existsSync(commentsPath)) throw new Error(`Нет снимка источника: ${commentsPath}`);
const comments = [];
for (const line of fs.readFileSync(commentsPath, 'utf8').split(/\r?\n/)) {
  const cyrillicCount = (line.match(/[А-Яа-яЁё]/g) || []).length;
  const latinCount = (line.match(/[A-Za-z]/g) || []).length;
  if (!cyrillicCount || cyrillicCount < latinCount * 2) continue;
  const text = normalize(line);
  if (text) comments.push(text);
}
write('Комментарии YouTube Shorts', 'Реальные русскоязычные комментарии к публичным видео YouTube Shorts', 'https://huggingface.co/datasets/akaruineko/shorts_youtube-comments (MIT)', 'Комментарии YouTube Shorts', comments, 21000);

const moviesPath = `${sourceDir}movie-reviews-kino.parquet`;
if (fs.existsSync(moviesPath)) {
  const table = arrow.tableFromIPC(parquet.readParquet(fs.readFileSync(moviesPath)).intoIPCStream());
  const texts = table.getChild('review_text');
  const languages = table.getChild('review_language');
  const rows = [];
  for (let i = 0; i < table.numRows; i++) {
    if (languages.get(i) !== 'ru') continue;
    const raw = String(texts.get(i) || '');
    const text = normalize(raw);
    if (text) rows.push(text);
  }
  write('Отзывы о кино', 'Реальные отзывы зрителей о кино с портала kino.kz', 'https://huggingface.co/datasets/yeshpanovrustem/100k_movie_reviews_from_kz (CC BY 4.0)', 'Отзывы о кино', rows);
}
