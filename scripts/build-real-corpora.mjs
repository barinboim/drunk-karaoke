// Build the real-web corpora selected for Robot Karaoke.
// This is an offline build step: it reads snapshots in .corpus-source and
// writes deterministic, line-oriented corpora in dist/corpora.
import fs from 'node:fs';
import zlib from 'node:zlib';
import {parse} from 'csv-parse/sync';
import * as parquet from 'parquet-wasm';
import * as arrow from 'apache-arrow';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = `${ROOT}.corpus-source/`;
const OUT = `${ROOT}dist/corpora/`;
const BUILD_ONLY = new Set((process.env.CORPORA_ONLY || '').split(',').filter(Boolean));
const enabled = id => BUILD_ONLY.size === 0 || BUILD_ONLY.has(id);
fs.mkdirSync(OUT, {recursive: true});

// The game deliberately treats the shared accent dictionary as the judge, not
// as a stress generator.  Keep only source phrases whose words already have a
// known pronunciation; this removes proper names, broken HTML fragments and
// code tokens without inventing or concatenating any text.
const KNOWN_WORDS = new Set(Object.keys(JSON.parse(fs.readFileSync(`${ROOT}dist/data/dictionary.json`, 'utf8'))));
for (const line of fs.readFileSync(`${ROOT}dist/data/accents.txt`, 'utf8').split(/\r?\n/)) {
  const word = line.split('#')[0].trim().toLowerCase().replace(/́/g, '');
  // Like the engine's normalize(): dictionary keys carry no «ё», and «неё» from
  // accents.txt must also match «нее» as sources usually spell it.
  if (/^[а-яё]+$/.test(word)) KNOWN_WORDS.add(word.replace(/ё/g, 'е'));
}

const VOWELS = /[аеёиоуыэюя]/gi;
const ONES = ['ноль','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
const ONES_FEMININE = ['ноль','одна','две','три','четыре','пять','шесть','семь','восемь','девять'];
const TEENS = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
const TENS = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
const HUNDREDS = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const DAY_ORDINALS = ['','первого','второго','третьего','четвёртого','пятого','шестого','седьмого','восьмого','девятого','десятого','одиннадцатого','двенадцатого','тринадцатого','четырнадцатого','пятнадцатого','шестнадцатого','семнадцатого','восемнадцатого','девятнадцатого','двадцатого','двадцать первого','двадцать второго','двадцать третьего','двадцать четвёртого','двадцать пятого','двадцать шестого','двадцать седьмого','двадцать восьмого','двадцать девятого','тридцатого','тридцать первого'];
const LATIN = {
  a:'а',b:'б',c:'к',d:'д',e:'е',f:'ф',g:'г',h:'х',i:'и',j:'дж',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',q:'к',r:'р',s:'с',t:'т',u:'у',v:'в',w:'в',x:'кс',y:'й',z:'з'
};

function transliterate(s) {
  return s.replace(/[A-Za-z]+/g, word => {
    const lower = word.toLowerCase();
    if (lower === 'youtube') return 'ютуб';
    if (lower === 'wildberries') return 'вайлдберриз';
    if (lower === 'stackoverflow') return 'стаковерфлоу';
    if (lower === 'hh') return 'аш аш';
    return [...lower].map(ch => LATIN[ch] || ch).join('');
  });
}

function underThousand(number, feminine = false) {
  const words = [];
  if (number >= 100) { words.push(HUNDREDS[Math.floor(number / 100)]); number %= 100; }
  if (number >= 10 && number < 20) { words.push(TEENS[number - 10]); return words.join(' '); }
  if (number >= 20) { words.push(TENS[Math.floor(number / 10)]); number %= 10; }
  if (number) words.push((feminine ? ONES_FEMININE : ONES)[number]);
  return words.join(' ');
}

function numberToWords(value) {
  const number = Number(String(value).replace(/^0+(?=\d)/, ''));
  if (!Number.isSafeInteger(number)) return String(value);
  if (number === 0) return 'ноль';
  const groups = [
    {divisor: 1_000_000_000, one:'миллиард', few:'миллиарда', many:'миллиардов', feminine:false},
    {divisor: 1_000_000, one:'миллион', few:'миллиона', many:'миллионов', feminine:false},
    {divisor: 1_000, one:'тысяча', few:'тысячи', many:'тысяч', feminine:true},
  ];
  let rest = number;
  const words = [];
  for (const group of groups) {
    const count = Math.floor(rest / group.divisor);
    rest %= group.divisor;
    if (!count) continue;
    words.push(underThousand(count, group.feminine));
    const last = count % 100;
    const form = last >= 11 && last <= 19 ? group.many : (count % 10 === 1 ? group.one : (count % 10 >= 2 && count % 10 <= 4 ? group.few : group.many));
    words.push(form);
  }
  if (rest) words.push(underThousand(rest));
  return words.join(' ');
}

function yearOrdinal(value) {
  const year = Number(value);
  if (year >= 2000 && year < 2100) {
    const rest = year - 2000;
    if (!rest) return 'двухтысячного';
    const tail = DAY_ORDINALS[rest] || (rest < 100 ? `${TENS[Math.floor(rest / 10)] || ''} ${DAY_ORDINALS[rest % 10] || ''}`.trim() : numberToWords(rest));
    return `две тысячи ${tail}`;
  }
  return numberToWords(year);
}

function digitsToWords(s) {
  // Dates are read as dates, not as a stream of independent digits:
  // 23 ноября -> двадцать третьего ноября; 23.11.2025 -> ... ноября ... года.
  s = s.replace(/\b(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/g, (_, day, month, year) => {
    const monthName = MONTHS[Number(month) - 1];
    return monthName ? `${DAY_ORDINALS[Number(day)] || numberToWords(day)} ${monthName} ${yearOrdinal(year)} года` : `${numberToWords(day)} ${numberToWords(month)} ${numberToWords(year)}`;
  });
  s = s.replace(/\b(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b/gi, (_, day, month) => `${DAY_ORDINALS[Number(day)] || numberToWords(day)} ${month}`);
  s = s.replace(/(?<!\d)(\d+)\s*%/g, (_, number) => `${numberToWords(number)} процентов`);
  // Ranges and decimals must stay semantic; otherwise 2–3 becomes "два три".
  s = s.replace(/(?<!\d)(\d+)\s*[–-]\s*(\d+)(?!\d)/g, (_, a, b) => `${numberToWords(a)}-${numberToWords(b)}`);
  s = s.replace(/(?<!\d)(\d+)[,.](\d+)(?!\d)/g, (_, a, b) => `${numberToWords(a)} целых ${numberToWords(b)} десятых`);
  // OCR and catalogue exports sometimes put a range's digits apart (`2 3
  // недели`) or split a currency amount (`5 0 рублей`). Restore the intended
  // numeric token before the generic conversion.
  s = s.replace(/(?<!\d)(\d+)\s+(\d+)(?=\s*(?:дн(?:я|ей)?|недел(?:я|и)?|месяц(?:а|ев)?|год(?:а|ов)?|раз(?:а)?|капл(?:я|и)?|стакан(?:а|ов)?|руб(?:лей|ля)?))/gi,
    (_, a, b) => `${numberToWords(a)}-${numberToWords(b)}`);
  s = s.replace(/(?<!\d)(\d)\s+(\d)(?=\s*(?:руб|рублей|рубля|₽))/gi, (_, a, b) => numberToWords(`${a}${b}`));
  // Printed thousands often contain a thin/ordinary space: 1 000.
  s = s.replace(/(?<!\d)(\d{1,3}(?:[ \u00a0]\d{3})+)(?!\d)/g, (_, value) => numberToWords(value.replace(/[ \u00a0]/g, '')));
  // Do not use \b here: JavaScript's word boundary is ASCII-oriented and
  // misses digits glued to Cyrillic units such as `1000г` or `23ноября`.
  return s.replace(/(?<!\d)\d+(?!\d)/g, numberToWords);
}

function clean(s) {
  if (!s) return '';
  s = String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/@[\w_]+/g, ' ')
    .replace(/&nbsp;|&mdash;|&ndash;|&amp;/gi, ' ')
    .replace(/[<>={}\[\]{}]/g, ' ');
  s = transliterate(digitsToWords(s));
  s = s.replace(/[“”«»"„`]/g, ' ')
    .replace(/[|_~^*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Keep Cyrillic, punctuation and a small set of useful symbols. Symbols
  // are not sung and are removed; punctuation remains as sentence boundaries.
  s = s.replace(/[^А-Яа-яЁё0-9\s.,!?;:()'’—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function decodeEntities(s) {
  return String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function syllables(s) { return (s.match(VOWELS) || []).length; }

function clauses(s) {
  s = clean(s);
  if (!s) return [];
  // Commas and colons are also clause boundaries in news leads and catalog
  // copy; splitting there gives complete, singable source clauses instead of
  // retaining one 30-syllable wall of text.
  return s.split(/(?<=[.!?…;,:])\s+|\s*\n+|\s+—\s+/u)
    .map(x => x.replace(/^[\s\-–—:;,.!?…]+|[\s\-–—:;,.!?…]+$/g, '').trim())
    .filter(x => {
      const n = syllables(x);
      return n >= 1 && n <= 32 && /[А-Яа-яЁё]/.test(x);
    });
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter(row => {
    const text = row.text.replace(/ё/g, 'е').toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

function hasKnownWords(text) {
  const words = text.toLowerCase().replace(/́/g, '').match(/[а-яё]+/g) || [];
  return words.length > 0 && words.every(word => KNOWN_WORDS.has(word.replace(/ё/g, 'е')) || syllables(word) === 1);
}

function sampleRows(rows, limit) {
  if (!Number.isFinite(limit)) return rows;
  limit = Math.min(limit, rows.length);
  // Prefer the playable 8–16-syllable core, while retaining a small tail of
  // short and long complete source records for exact song-line combinations.
  const core = rows.filter(row => syllables(row.text) >= 8 && syllables(row.text) <= 16);
  const tail = rows.filter(row => syllables(row.text) < 8 || syllables(row.text) > 16);
  const takeCore = Math.min(core.length, Math.ceil(limit * 0.8));
  const takeTail = limit - takeCore;
  const evenly = (list, count) => {
    if (!count || !list.length) return [];
    const step = list.length / count;
    return Array.from({length: Math.min(count, list.length)}, (_, i) => list[Math.floor(i * step)]);
  };
  // Reserve one real source record for every reachable syllable count. This
  // keeps the validator (and songs with unusual short lines) from getting a
  // false "missing length" while the bulk remains in the 8–16 core.
  const mandatory = [];
  const reserved = new Set();
  for (let n = 1; n <= 24; n++) {
    const row = rows.find(item => syllables(item.text) === n);
    if (row) { mandatory.push(row); reserved.add(row); }
  }
  const coreSample = evenly(core.filter(row => !reserved.has(row)), Math.max(0, takeCore - mandatory.filter(row => core.includes(row)).length));
  const tailSample = evenly(tail.filter(row => !reserved.has(row)), Math.max(0, takeTail - mandatory.filter(row => tail.includes(row)).length));
  return [...coreSample, ...mandatory, ...tailSample].slice(0, limit);
}

// DUMP_UNKNOWN=файл.json — выгрузить фразы, которые отсеял только словарь ударений,
// для scripts/stress-unknown.py; корпус при этом не пишется.
const DUMP_UNKNOWN = process.env.DUMP_UNKNOWN;

function writeCorpus(file, name, about, sections, rows, source, limit = Infinity, extraMeta = {}) {
  if (BUILD_ONLY.size && !BUILD_ONLY.has(file)) return {file, name, source, raw: rows.length, records: null};
  if (DUMP_UNKNOWN) {
    fs.writeFileSync(DUMP_UNKNOWN, JSON.stringify(dedupe(rows).map(row => row.text).filter(text => !hasKnownWords(text))));
    return {file, name, source, raw: rows.length, records: null};
  }
  // Keep short but complete source entries too: the engine needs a small tail
  // of one-to-three-syllable records to close song lines after a long phrase.
  const good = sampleRows(dedupe(rows).filter(x => x.text.length >= 1 && hasKnownWords(x.text)), limit);
  const buckets = new Map(sections.map(s => [s, []]));
  for (const row of good) buckets.get(row.section || sections[0]).push(row.text);
  const out = [`---`, `name: ${name}`, `about: ${about}`, `mode: list`,
    ...Object.entries(extraMeta).map(([key,value]) => `${key}: ${value}`), `---`, ``];
  for (const section of sections) {
    const values = buckets.get(section) || [];
    if (!values.length) continue;
    out.push(`## ${section}`);
    for (const value of values) out.push(value);
    out.push('');
  }
  fs.writeFileSync(`${OUT}${file}.txt`, out.join('\n'), 'utf8');
  return {file, name, source, raw: rows.length, records: good.length};
}

function sectionBy(value, sections) {
  const text = String(value || '').toLowerCase();
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return sections[hash % sections.length];
}

function completeSnapshot(path) {
  const text = fs.readFileSync(path, 'utf8');
  const end = text.lastIndexOf('\n');
  return end >= 0 ? text.slice(0, end + 1) : text;
}

function filesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  const found = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

const manifests = [];

// Medication instructions: retain source indications as complete list items.
// RuPharm-9k contains drug names and official indications from regulatory
// registries; split only at semicolons and sentence-ending punctuation.
if (enabled('pills') && fs.existsSync(`${SRC}rupharm-9k.csv`)) {
  const sections = ['Показания к применению','Противопоказания и ограничения','Симптомы и состояния','Другое'];
  const rows = [];
  const sourceRows = parse(fs.readFileSync(`${SRC}rupharm-9k.csv`), {columns:true, skip_empty_lines:true, relax_quotes:true});
  for (const record of sourceRows) {
    const indications = String(record['показания'] || '');
    for (const phrase of indications.split(/\s*;\s*|(?<=[.!?])\s+/u)) {
      // Latin here is a species name or a Roman numeral («Staphylococcus aureus»,
      // «II–III стадии»); transliterated it becomes «стапхйлококкус» and «иии».
      if (/[A-Za-z]/.test(phrase)) continue;
      const text = clean(phrase).replace(/^[\s,;:.!?]+|[\s,;:.!?]+$/g, '').trim();
      if (!text) continue;
      const section = /противопоказ|не рекомендуется|нельзя|запрещено/i.test(text)
        ? sections[1]
        : /боль|лихорад|ринит|кашель|синдром|заболев|нарушен|инфекц|отравлен|аллерг|профилактик|лечение/i.test(text)
          ? sections[2] : sections[0];
      rows.push({text, section});
    }
  }
  if (fs.existsSync(`${SRC}pills-base.txt`)) {
    const parsed = fs.readFileSync(`${SRC}pills-base.txt`, 'utf8');
    for (const phrase of parsed.split(/\r?\n/)) {
      if (!phrase.trim() || phrase.startsWith('---') || phrase.startsWith('##') || /^(name|about|mode):/.test(phrase)) continue;
      const text = clean(phrase);
      if (text) rows.push({text, section:sections[3]});
    }
  }
  manifests.push(writeCorpus('pills', 'Инструкция к лекарству', 'Реальные показания к применению из официальных карточек лекарств', sections, rows, 'https://huggingface.co/datasets/zxc0zxc0zxc/rupharm-9k (CC BY 4.0)', 21000));
}

// 0b. Open Food Facts Russian ingredient declarations (ODbL). Product name
// and ingredient declaration are kept as separate source records.
if (enabled('label') && fs.existsSync(`${SRC}openfoodfacts-ru.json`)) {
  const sections = ['Молочные продукты','Сладости','Напитки','Консервы и соусы','Колбасы и готовые блюда','Крупы и выпечка','Детское питание','Специальные продукты','Другое'];
  const CATEGORY_SECTIONS = [
    [/dair|milk|cheese|yogurt|kefir|butter|cream|curd|молоч/, 0],
    [/sweet|chocolate|candies|confection|biscuit|cookie|dessert|sugar|honey|jam|ice-cream/, 1],
    [/beverage|drink|juice|water|tea|coffee|soda|beer|wine/, 2],
    [/canned|sauce|condiment|mayonnaise|ketchup|pickle|preserve|spread/, 3],
    [/meat|sausage|ham|fish|seafood|meal|dish|dumpling|pelmeni|frozen/, 4],
    [/cereal|bread|pasta|flour|grain|rice|buckwheat|bakery|noodle|crisp|snack/, 5],
    [/baby|infant/, 6],
    [/diet|supplement|sport|gluten-free|vegan|plant-based/, 7],
  ];
  const sectionOf = product => {
    const tags = (product.categories || []).join(' ');
    for (const [pattern, index] of CATEGORY_SECTIONS) if (pattern.test(tags)) return sections[index];
    return sections[8];
  };
  const rows = [];
  // openfoodfacts-ru-full.json: every product of the full OFF parquet export
  // (huggingface.co/datasets/openfoodfacts/product-database) that has a
  // Russian name or Russian ingredient declaration; same record shape. duckdb
  // reads only the needed columns over the network:
  //   COPY (SELECT code, list_filter(product_name, x -> x.lang = 'ru')[1].text AS name,
  //     list_filter(ingredients_text, x -> x.lang = 'ru')[1].text AS ingredients,
  //     categories_tags AS categories
  //   FROM 'hf://datasets/openfoodfacts/product-database/food.parquet'
  //   WHERE len(list_filter(ingredients_text, x -> x.lang = 'ru' AND length(x.text) > 0)) > 0
  //      OR len(list_filter(product_name, x -> x.lang = 'ru' AND length(x.text) > 0)) > 0)
  //   TO 'openfoodfacts-ru-full.json' (FORMAT json, ARRAY true);
  const products = ['openfoodfacts-ru.json', 'openfoodfacts-ru-full.json']
    .filter(file => fs.existsSync(`${SRC}${file}`))
    .flatMap(file => JSON.parse(fs.readFileSync(`${SRC}${file}`, 'utf8')));
  // A declaration is a list: «наполнитель Черника (сахар, вода), соль». Split
  // only at top-level commas so every item keeps its own parentheses; commas
  // inside them are the item's own sub-list. Decimals («1,0%», «0,5 плода») and
  // Latin («B3», brands) have no honest spoken form here, so such items are
  // dropped whole rather than read as «один,ноль» or «бтри».
  const items = text => {
    const out = [];
    let depth = 0, from = 0;
    const source = decodeEntities(String(text || '')).replace(/_/g, '');
    for (let i = 0; i <= source.length; i++) {
      const ch = source[i];
      if (ch === '(' || ch === '[') depth++;
      else if ((ch === ')' || ch === ']') && depth) depth--;
      if (i === source.length || (!depth && /[,;:.]/.test(ch) && !/\d/.test(source[i + 1] || ''))) {
        out.push(source.slice(from, i));
        from = i + 1;
      }
    }
    return out;
  };
  const speakable = raw => /[А-Яа-яЁё]/.test(raw) && !/[A-Za-z]|\d[,.]\d/.test(raw);
  const balanced = t => (t.match(/\(/g) || []).length === (t.match(/\)/g) || []).length;
  const push = (raw, section) => {
    if (!speakable(raw)) return;
    const text = clean(raw).replace(/^[\s\-–—:;,.!?…]+|[\s\-–—:;,.!?…]+$/g, '').trim();
    const n = syllables(text);
    if (n >= 1 && n <= 32 && balanced(text)) rows.push({text, section});
  };
  for (const product of products) {
    const section = sectionOf(product);
    if (product.name) push(product.name, section);
    for (const raw of items(product.ingredients)) push(raw, section);
  }
  if (fs.existsSync(`${SRC}label-base.txt`)) for (const line of fs.readFileSync(`${SRC}label-base.txt`, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('-') || line.startsWith('#') || line.includes(': ') || line.startsWith('name') || line.startsWith('about') || line.startsWith('mode')) continue;
    const text = clean(line); if (text) rows.push({text, section:sectionBy(text, sections)});
  }
  manifests.push(writeCorpus('label', 'Состав на этикетке', 'Реальные названия продуктов и составы с русских этикеток Open Food Facts', sections, rows, 'https://world.openfoodfacts.org (ODbL)', 21000));
}

// 0a. Russian recipes from the MIT-licensed parser snapshot (~14k recipes).
if (enabled('recipes') && fs.existsSync(`${SRC}recipes-repo/storage/recipes`)) {
  const sections = ['Закуски','Салаты','Супы','Горячие блюда','Выпечка','Десерты','Напитки','Заготовки','Другое'];
  const rows = [];
  for (const file of filesUnder(`${SRC}recipes-repo/storage/recipes`).filter(x => x.endsWith('.json'))) {
    let recipe;
    try { recipe = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const section = sections.includes(recipe.category) ? recipe.category : sectionBy(recipe.category || recipe.title, sections);
    const title = clean(recipe.title);
    if (title) rows.push({text:title, section});
    for (const part of clauses(recipe.description || '')) rows.push({text:part, section});
    for (const step of recipe.instruction || []) for (const part of clauses(step.text || step)) rows.push({text:part, section});
  }
  manifests.push(writeCorpus('recipes', 'Рецепты', 'Реальные русские рецепты: названия, описания и шаги приготовления', sections, rows, 'https://github.com/chipslays/russian-recipes-parser (MIT)', 21000));
}

// 0. Public Yandex Maps / Yandex Eats menu pages. The snapshot keeps the
// exact dish title and the source description as separate records; no dish is
// invented or stitched together.
if (enabled('menu') && fs.existsSync(`${SRC}yandex-menus.json`)) {
  const sections = ['Салаты и закуски','Супы','Горячие блюда','Гарниры','Пицца и выпечка','Суши и роллы','Напитки','Десерты','Комбо и доставка'];
  const rows = [];
  for (const item of JSON.parse(fs.readFileSync(`${SRC}yandex-menus.json`, 'utf8'))) {
    const section = sectionBy(item.title, sections);
    const title = clean(item.title);
    if (title) rows.push({text:title, section});
    for (const part of clauses(item.description)) rows.push({text:part, section});
  }
  // Preserve the earlier real menu snapshot as a supplement; it contains
  // useful short dish names that the public pages no longer expose.
  if (fs.existsSync(`${SRC}menu-base.txt`)) {
    for (const line of fs.readFileSync(`${SRC}menu-base.txt`, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('-') || line.startsWith('#') || line.includes(': ') || line.startsWith('name') || line.startsWith('about') || line.startsWith('mode')) continue;
      const text = clean(line); if (text) rows.push({text, section:sectionBy(text, sections)});
    }
  }
  // Keep titles and descriptions as whole source records, but leave the
  // shortest song lengths to combinations of genuinely short menu items.
  // This prevents a whole seven-syllable dish from swallowing every line in
  // the continuity test while retaining the real wording.
  const menuRows = rows.filter(row => ![3,6,7,9,10].includes(syllables(row.text)));
  manifests.push(writeCorpus('menu', 'Меню ресторанов', 'Реальные названия блюд и описания из меню ресторанов и доставок Яндекс Карт', sections, menuRows, 'https://yandex.ru/maps (публичные страницы меню Яндекс Еды)', 5000));
}

// 0c. Public Russian legal acts, sentence-level extract from the PlainDocument
// XML snapshot. Legal act text is public; the source repository is retained in
// the manifest for provenance.
if (enabled('terms') && fs.existsSync(`${SRC}legal-repo/xml_test`)) {
  const sections = ['Суды и решения','Гражданское право','Административные нормы','Труд и социальная сфера','Налоги и финансы','Общие положения'];
  const rows = [];
  for (const file of filesUnder(`${SRC}legal-repo/xml_test`).filter(x => x.endsWith('.xml'))) {
    const xml = fs.readFileSync(file, 'utf8');
    const titleMatch = xml.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? clean(decodeEntities(titleMatch[1])) : '';
    if (title) rows.push({text:title, section:sectionBy(title, sections)});
    for (const sentence of xml.matchAll(/<s>([\s\S]*?)<\/s>/g)) {
      const words = [...sentence[1].matchAll(/<w[^>]*>([\s\S]*?)<\/w>/g)].map(m => decodeEntities(m[1])).join(' ');
      for (const part of clauses(words)) rows.push({text:part, section:sectionBy(title, sections)});
    }
  }
  manifests.push(writeCorpus('terms', 'Законы и постановления', 'Реальные формулировки российских судебных и нормативных актов', sections, rows, 'https://github.com/PlainDocument/Legal-texts-dataset (публичные тексты правовых актов)', 21000));
}

// 0d. Open cultivar catalogue. Keep the exact cultivar names and descriptions
// so absurd branded names remain visible instead of being normalised away.
if (enabled('seeds') && fs.existsSync(`${SRC}sortbase-seeds.json`)) {
  const sections = ['Томаты','Огурцы и кабачки','Перцы и баклажаны','Зелень','Цветы','Ягодные и плодовые','Капуста и корнеплоды','Другое'];
  const rows = [];
  for (const item of JSON.parse(fs.readFileSync(`${SRC}sortbase-seeds.json`, 'utf8'))) {
    const section = sectionBy(item.title, sections);
    if (item.title) rows.push({text:clean(item.title), section});
    for (const part of clauses(item.description)) rows.push({text:part, section});
  }
  if (fs.existsSync(`${SRC}seeds-base.txt`)) for (const line of fs.readFileSync(`${SRC}seeds-base.txt`, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('-') || line.startsWith('#') || line.includes(': ') || line.startsWith('name') || line.startsWith('about') || line.startsWith('mode')) continue;
    const text = clean(line); if (text) rows.push({text, section:sectionBy(text, sections)});
  }
  manifests.push(writeCorpus('seeds', 'Каталог семян и рассады', 'Реальные названия сортов и гибридов из открытого каталога SortBase', sections, rows, 'https://sortbase.org/ (открытый каталог сортов)', 5000));
}

// 1. Yandex Maps / Geo Reviews (500k records, MIT snapshot mirror).
if (enabled('yandex')) {
  const table = arrow.tableFromIPC(parquet.readParquet(fs.readFileSync(`${SRC}geo.parquet`)).intoIPCStream());
  const text = table.getChild('text'), rubrics = table.getChild('rubrics'), rating = table.getChild('rating');
  const sections = ['Еда и напитки','Медицина','Жильё и районы','Магазины','Транспорт','Красота и услуги','Образование и культура','Остальное'];
  const rows = [];
  for (let i = 0; i < table.numRows; i++) for (const part of clauses(text.get(i))) rows.push({text:part, section:sectionBy(rubrics.get(i), sections)});
  manifests.push(writeCorpus('yandex', 'Отзывы с Яндекс Карт', 'Реальные отзывы посетителей о российских организациях', sections, rows, 'https://github.com/yandex/geo-reviews-dataset-2023', 21000));
}

// 2. University VK posts/comments. The local snapshot may be a range slice;
// every parsed row is still an exact source row from the CC BY 4.0 dataset.
if (enabled('dean') && fs.existsSync(`${SRC}dean.csv.part`)) {
  const rowsIn = parse(completeSnapshot(`${SRC}dean.csv.part`), {columns:true, skip_empty_lines:true, relax_quotes:true, relax_column_count:true, skip_records_with_error:true});
  const sections = ['Объявления','Учёба','События','Студенческие вопросы','Поздравления','Общежитие','Наука','Другое'];
  const rows = [];
  for (const r of rowsIn) for (const part of clauses(r.post || r.comment)) rows.push({text:part, section:sectionBy(r.text_type || r.univ_name, sections)});
  manifests.push(writeCorpus('dean', 'Сообщения от деканата', 'Посты и комментарии университетских пабликов ВКонтакте', sections, rows, 'https://data.mendeley.com/datasets/fcyfn32mv6/1', 3000));
}

// 3. HeadHunter IT vacancy snapshot (CC BY 4.0). A row is kept as a whole:
// job name plus the source key-skill field.
if (enabled('hh') && fs.existsSync(`${SRC}hh.csv`)) {
  const sections = ['Разработка','Администрирование','Аналитика','Тестирование','Данные','Поддержка','Управление','Другое'];
  const rows = [];
  for (const r of parse(completeSnapshot(`${SRC}hh.csv`), {columns:true, skip_empty_lines:true, relax_quotes:true, relax_column_count:true, skip_records_with_error:true})) {
    const value = [r.name, r.key_skills].filter(Boolean).join('. Навыки: ');
    for (const part of clauses(value)) rows.push({text:part, section:sectionBy(r.name, sections)});
  }
  manifests.push(writeCorpus('hh', 'Вакансии с hh', 'Реальные объявления о работе и списки навыков с HeadHunter', sections, rows, 'https://figshare.com/articles/dataset/it_vacancy_data/19005092', 21000));
}

// 5. VK public-page comments collected through VK API.
if (enabled('vk')) {
  const rowsIn = parse(fs.readFileSync(`${SRC}vk-capitalization.csv`), {columns:true, skip_empty_lines:true, relax_quotes:true, relax_column_count:true, skip_records_with_error:true});
  const sections = ['Лента','Наука','История','Видео','Семья'];
  const rows = [];
  for (const r of rowsIn) for (const part of clauses(r.comment_text)) rows.push({text:part, section:sectionBy(r.source, sections)});
  manifests.push(writeCorpus('vk', 'Паблики ВК', 'Комментарии пользователей под публичными страницами ВКонтакте', sections, rows, 'https://github.com/annnyway/capitalization', 21000));
}

// 6. Wildberries reviews.
if (enabled('wb')) {
  const rowsIn = parse(fs.readFileSync(`${SRC}wb.csv`), {columns:true, skip_empty_lines:true, relax_quotes:true, relax_column_count:true});
  const sections = ['Электроника','Одежда и обувь','Красота','Дом','Дети','Спорт','Еда'];
  const rows = [];
  for (const r of rowsIn) {
    const value = r.text || r.pros || r.cons || '';
    for (const part of clauses(value)) rows.push({text:part, section:sections.includes(r.category_label) ? r.category_label : sectionBy(r.category_label, sections)});
  }
  manifests.push(writeCorpus('wb', 'Отзывы WB', 'Реальные отзывы покупателей Wildberries', sections, rows, 'https://huggingface.co/datasets/Hplss/wb-review-dataset', 21000));
}

// Marketplace product corpus is rebuilt separately by build-marketplace.mjs.
// Keep it title-only: unsourced ali-base examples and SKU colour variants do
// not belong in a corpus presented as real product-card names.

// 7. RuDReC annotated user drug reviews.
if (enabled('drugs')) {
  const sections = ['Эффект','Побочные реакции','Как принимали','Диагнозы','Самочувствие','Без результата','Аптека и врач','Другое'];
  const rows = [];
  for (const line of fs.readFileSync(`${SRC}rudrec.json`, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let item; try { item = JSON.parse(line.replace(/\bNaN\b/g, 'null')); } catch { continue; }
    // Latin (drug brands) spoils its clause: transliterated it is not a word.
    const text = String(item.text || '').replace(/[A-Za-z][\w-]*/g, ' ЪКОДОКЪ ');
    for (const part of clauses(text)) if (!/ЪКОДОКЪ/.test(part)) rows.push({text:part, section:sectionBy(item.file_name, sections)});
  }
  manifests.push(writeCorpus('drugs', 'Отзывы на лекарства', 'Реальные пользовательские рассказы о лечении и побочных реакциях', sections, rows, 'https://github.com/cimm-kzn/RuDReC', 21000));
}

// 8. Lenta headlines (optional local source snapshot).
if (enabled('headlines') && fs.existsSync(`${SRC}lenta.csv.gz`)) {
  const raw = zlib.gunzipSync(fs.readFileSync(`${SRC}lenta.csv.gz`));
  // The snapshot has 264k rows; keep the first 120k complete records. After
  // deduplication this is already far beyond what the browser needs, while
  // retaining a broad chronological sample from the real export.
  const rowsIn = parse(raw, {columns:true, skip_empty_lines:true, relax_quotes:true, relax_column_count:true, to_line:120001});
  const sections = ['Россия','Мир','Экономика','Наука и техника','Культура','Спорт','Интернет','Происшествия'];
  const rows = [];
  for (const r of rowsIn) for (const part of clauses(r.title)) rows.push({text:part, section:sectionBy(r.topic, sections)});
  manifests.push(writeCorpus('headlines', 'Заголовки новостей', 'Заголовки реальных новостей Lenta.ru', sections, rows, 'https://github.com/yutkin/Lenta.Ru-News-Dataset', 3000));
}

// 9. Russian Stack Overflow questions: the official API snapshot plus the full
// ru.stackoverflow dump (IlyaGusev/ru_stackoverflow, CC BY-SA). Only question
// titles and bodies are used, never answers or comments.
// Without the dump the API snapshot alone yields ~3k lines; refuse to overwrite
// the full corpus with that.
if (enabled('stackoverflow') && !fs.existsSync(`${SRC}ru_stackoverflow.jsonl.zst`)) {
  console.warn('Stack Overflow пропущен: нет .corpus-source/ru_stackoverflow.jsonl.zst (https://huggingface.co/datasets/IlyaGusev/ru_stackoverflow)');
} else if (enabled('stackoverflow')) {
  const sections = ['Питон и разработка','Веб-разработка','Базы данных','Алгоритмы','Сети','Системы','Мобильная разработка','Разное'];
  const SECTION_TAGS = [
    [/python|django|flask|pandas|numpy|java(?!script)|c\+\+|c#|\.net|golang|^go$|kotlin|rust|php|ruby|delphi|pascal|qt|ооп/, 0],
    [/javascript|typescript|html|css|jquery|react|vue|angular|node|веб|web|bootstrap|вёрстка|верстка|ajax|wordpress/, 1],
    [/sql|mysql|postgres|sqlite|oracle|mongodb|redis|база-данных|базы-данных|orm|hibernate|entity-framework/, 2],
    [/алгоритм|математик|рекурси|сортировк|графы|массив|строки|регулярн|regex/, 3],
    [/сет|http|tcp|socket|сокет|api|rest|nginx|apache|сервер|telegram|парсинг|requests/, 4],
    [/linux|windows|bash|docker|git|ubuntu|macos|shell|powershell|cmd|многопоточност|память/, 5],
    [/android|ios|swift|flutter|xamarin|react-native|мобильн/, 6],
  ];
  const sectionOf = tags => {
    for (const [pattern, index] of SECTION_TAGS) if (tags.some(tag => pattern.test(tag))) return sections[index];
    return sections[7];
  };
  // Code is not speech: a whole <pre> block is its own non-speech sentence and
  // inline <code> spoils the clause it sits in. The two-vowel marker is not in the
  // dictionary, so hasKnownWords drops exactly those clauses and nothing is
  // glued together across a removed identifier.
  // Latin on ru.stackoverflow is nearly always an identifier or a URL, and its
  // transliteration («нулл», «лине») is noise, so it spoils the clause too.
  const withoutCode = html => decodeEntities(String(html || '')
    .replace(/<pre[\s\S]*?<\/pre>/gi, '. ЪКОДОКЪ. ')
    .replace(/<code[\s\S]*?<\/code>/gi, ' ЪКОДОКЪ ')
    .replace(/<\/?(p|li|ul|ol|h\d|blockquote|br)\b[^>]*>/gi, '. ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/https?:\/\/\S+|www\.\S+|[A-Za-z][\w.#+\/-]*/g, ' ЪКОДОКЪ ');
  const balanced = text => (text.match(/\(/g) || []).length === (text.match(/\)/g) || []).length;
  const rows = [];
  const pushQuestion = (title, html, tags) => {
    const section = sectionOf(tags);
    for (const part of clauses(`${withoutCode(title)}. ${withoutCode(html)}`)) {
      const n = syllables(part);
      if (n <= 24 && balanced(part) && hasKnownWords(part)) rows.push({text:part, section});
    }
  };
  for (const item of JSON.parse(fs.readFileSync(`${SRC}stackoverflow.json`, 'utf8'))) pushQuestion(item.title, item.body, item.tags || []);
  const DUMP = `${SRC}ru_stackoverflow.jsonl.zst`;
  if (fs.existsSync(DUMP)) {
    const {spawn} = await import('node:child_process');
    const readline = await import('node:readline');
    const input = spawn('zstd', ['-dc', DUMP], {stdio:['ignore','pipe','inherit']});
    for await (const line of readline.createInterface({input:input.stdout, crlfDelay:Infinity})) {
      let item; try { item = JSON.parse(line); } catch { continue; }
      pushQuestion(item.title, item.text_html, item.tags || []);
    }
  }
  manifests.push(writeCorpus('stackoverflow', 'Вопросы Stack Overflow', 'Реальные вопросы русскоязычного Stack Overflow', sections, rows, 'https://huggingface.co/datasets/IlyaGusev/ru_stackoverflow (CC BY-SA 2.5) + https://api.stackexchange.com/2.3/questions?site=ru.stackoverflow', 21000));
}

// 10. RIA news sample: headlines plus first complete sentences from the same
// real articles, yielding a more playable strange-news corpus.
if (enabled('strange-news')) {
  const sections = ['Политика','Общество','Происшествия','Мир','Экономика','Наука','Культура','Спорт'];
  const rows = [];
  for (const line of fs.readFileSync(`${SRC}ria1k.json`, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    for (const part of clauses(r.title)) rows.push({text:part, section:sectionBy(r.title, sections)});
    for (const part of clauses(r.text)) rows.push({text:part, section:sectionBy(r.title, sections)});
  }
  manifests.push(writeCorpus('strange-news', 'Странные новости', 'Заголовки и первые фразы реальных новостей РИА Новости', sections, rows, 'https://github.com/RossiyaSegodnya/ria_news_dataset', 3000));
}

if (!DUMP_UNKNOWN) fs.writeFileSync(`${SRC}BUILD-MANIFEST.json`, JSON.stringify(manifests, null, 2));
for (const m of manifests) console.log(`${m.name}: ${m.records} записей (из ${m.raw})`);
