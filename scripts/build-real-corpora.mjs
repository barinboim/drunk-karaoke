// Build the ten real-web corpora selected for Robot Karaoke.
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
fs.mkdirSync(OUT, {recursive: true});

// The game deliberately treats the shared accent dictionary as the judge, not
// as a stress generator.  Keep only source phrases whose words already have a
// known pronunciation; this removes proper names, broken HTML fragments and
// code tokens without inventing or concatenating any text.
const KNOWN_WORDS = new Set(Object.keys(JSON.parse(fs.readFileSync(`${ROOT}dist/data/dictionary.json`, 'utf8'))));
for (const line of fs.readFileSync(`${ROOT}dist/data/accents.txt`, 'utf8').split(/\r?\n/)) {
  const word = line.split('#')[0].trim().toLowerCase().replace(/́/g, '');
  if (/^[а-яё]+$/.test(word)) KNOWN_WORDS.add(word);
}

const VOWELS = /[аеёиоуыэюя]/gi;
const DIGITS = {0:'ноль',1:'один',2:'два',3:'три',4:'четыре',5:'пять',6:'шесть',7:'семь',8:'восемь',9:'девять'};
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

function digitsToWords(s) {
  return s.replace(/\d+/g, number => [...number].map(d => DIGITS[d]).join(' '));
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
  return words.length > 0 && words.every(word => KNOWN_WORDS.has(word) || syllables(word) === 1);
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

function writeCorpus(file, name, about, sections, rows, source, limit = Infinity, extraMeta = {}) {
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

const manifests = [];

// 1. Yandex Maps / Geo Reviews (500k records, MIT snapshot mirror).
{
  const table = arrow.tableFromIPC(parquet.readParquet(fs.readFileSync(`${SRC}geo.parquet`)).intoIPCStream());
  const text = table.getChild('text'), rubrics = table.getChild('rubrics'), rating = table.getChild('rating');
  const sections = ['Еда и напитки','Медицина','Жильё и районы','Магазины','Транспорт','Красота и услуги','Образование и культура','Остальное'];
  const rows = [];
  for (let i = 0; i < table.numRows; i++) for (const part of clauses(text.get(i))) rows.push({text:part, section:sectionBy(rubrics.get(i), sections)});
  manifests.push(writeCorpus('yandex', 'Отзывы с Яндекс Карт', 'Реальные отзывы посетителей о российских организациях', sections, rows, 'https://github.com/yandex/geo-reviews-dataset-2023', 3000));
}

// 2. University VK posts/comments. The local snapshot may be a range slice;
// every parsed row is still an exact source row from the CC BY 4.0 dataset.
if (fs.existsSync(`${SRC}dean.csv.part`)) {
  const rowsIn = parse(completeSnapshot(`${SRC}dean.csv.part`), {columns:true, skip_empty_lines:true, relax_quotes:true, relax_column_count:true, skip_records_with_error:true});
  const sections = ['Объявления','Учёба','События','Студенческие вопросы','Поздравления','Общежитие','Наука','Другое'];
  const rows = [];
  for (const r of rowsIn) for (const part of clauses(r.post || r.comment)) rows.push({text:part, section:sectionBy(r.text_type || r.univ_name, sections)});
  manifests.push(writeCorpus('dean', 'Сообщения от деканата', 'Посты и комментарии университетских пабликов ВКонтакте', sections, rows, 'https://data.mendeley.com/datasets/fcyfn32mv6/1', 3000));
}

// 3. HeadHunter IT vacancy snapshot (CC BY 4.0). A row is kept as a whole:
// job name plus the source key-skill field.
if (fs.existsSync(`${SRC}hh.csv`)) {
  const sections = ['Разработка','Администрирование','Аналитика','Тестирование','Данные','Поддержка','Управление','Другое'];
  const rows = [];
  for (const r of parse(completeSnapshot(`${SRC}hh.csv`), {columns:true, skip_empty_lines:true, relax_quotes:true, relax_column_count:true, skip_records_with_error:true})) {
    const value = [r.name, r.key_skills].filter(Boolean).join('. Навыки: ');
    for (const part of clauses(value)) rows.push({text:part, section:sectionBy(r.name, sections)});
  }
  manifests.push(writeCorpus('hh', 'Вакансии с hh', 'Реальные объявления о работе и списки навыков с HeadHunter', sections, rows, 'https://figshare.com/articles/dataset/it_vacancy_data/19005092', 3000));
}

// 5. VK public-page comments collected through VK API.
{
  const rowsIn = parse(fs.readFileSync(`${SRC}vk-capitalization.csv`), {columns:true, skip_empty_lines:true, relax_quotes:true, relax_column_count:true, skip_records_with_error:true});
  const sections = ['Лента','Наука','История','Видео','Семья'];
  const rows = [];
  for (const r of rowsIn) for (const part of clauses(r.comment_text)) rows.push({text:part, section:sectionBy(r.source, sections)});
  manifests.push(writeCorpus('vk', 'Паблики ВК', 'Комментарии пользователей под публичными страницами ВКонтакте', sections, rows, 'https://github.com/annnyway/capitalization', 3000));
}

// 6. Wildberries reviews.
{
  const rowsIn = parse(fs.readFileSync(`${SRC}wb.csv`), {columns:true, skip_empty_lines:true, relax_quotes:true, relax_column_count:true});
  const sections = ['Электроника','Одежда и обувь','Красота','Дом','Дети','Спорт','Еда'];
  const rows = [];
  for (const r of rowsIn) {
    const value = r.text || r.pros || r.cons || '';
    for (const part of clauses(value)) rows.push({text:part, section:sections.includes(r.category_label) ? r.category_label : sectionBy(r.category_label, sections)});
  }
  manifests.push(writeCorpus('wb', 'Отзывы WB', 'Реальные отзывы покупателей Wildberries', sections, rows, 'https://huggingface.co/datasets/Hplss/wb-review-dataset', 3000));
}

// 6b. Existing marketplace product-name corpus expanded with real Wildberries
// product-card titles from the public-domain wb-products export. Reviews stay
// in wb.txt; this block only reads the imt_name field (never review text).
if (fs.existsSync(`${SRC}ali-base.txt`) && fs.existsSync(`${SRC}wb-products-5000.json`)) {
  const sections = ['Телефоны и аксессуары','Одежда женская','Одежда мужская','Дом и кухня','Красота и здоровье','Инструменты и авто','Детское и игрушки','Сад, спорт и туризм','Описание, доставка и отзывы'];
  const rows = [];
  let section = sections[0];
  for (const line of fs.readFileSync(`${SRC}ali-base.txt`, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('## ')) { section = trimmed.slice(3).trim(); continue; }
    if (trimmed.startsWith('---') || trimmed.startsWith('name:') || trimmed.startsWith('about:')) continue;
    if (!trimmed.startsWith('#')) rows.push({text:trimmed, section:sections.includes(section) ? section : sections[0]});
  }
  for (const product of JSON.parse(fs.readFileSync(`${SRC}wb-products-5000.json`, 'utf8'))) {
    // Keep the card title and its card-level colour variant only; descriptions
    // and reviews are deliberately excluded from this product-name corpus.
    const title = [product.imt_name, product.nm_colors_names].filter(Boolean).join(', ');
    const normalized = clean(title);
    const count = syllables(normalized);
    if (normalized && count >= 1 && count <= 32 && /[А-Яа-яЁё]/.test(normalized))
      rows.push({text:normalized, section:sectionBy(product.subj_root_name || product.subj_name, sections)});
  }
  manifests.push(writeCorpus('ali', 'Товары с маркетплейса', 'Реальные названия товарных карточек и варианты цвета Wildberries вместе с исходными товарными названиями', sections, rows, 'https://huggingface.co/datasets/nyuuzyou/wb-products (CC0)', 5000));
}

// 7. RuDReC annotated user drug reviews.
{
  const sections = ['Эффект','Побочные реакции','Как принимали','Диагнозы','Самочувствие','Без результата','Аптека и врач','Другое'];
  const rows = [];
  for (const line of fs.readFileSync(`${SRC}rudrec.json`, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let item; try { item = JSON.parse(line.replace(/\bNaN\b/g, 'null')); } catch { continue; }
    for (const part of clauses(item.text || '')) rows.push({text:part, section:sectionBy(item.file_name, sections)});
  }
  manifests.push(writeCorpus('drugs', 'Отзывы на лекарства', 'Реальные пользовательские рассказы о лечении и побочных реакциях', sections, rows, 'https://github.com/cimm-kzn/RuDReC', 3000));
}

// 8. Lenta headlines.
{
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

// 9. Russian Stack Overflow questions through the official public API.
{
  const items = JSON.parse(fs.readFileSync(`${SRC}stackoverflow.json`, 'utf8'));
  const sections = ['Питон и разработка','Веб-разработка','Базы данных','Алгоритмы','Сети','Системы','Мобильная разработка','Разное'];
  const rows = [];
  for (const item of items) {
    const value = `${item.title || ''}. ${item.body || ''}`;
    for (const part of clauses(value)) rows.push({text:part, section:sectionBy((item.tags || []).join(' '), sections)});
  }
  manifests.push(writeCorpus('stackoverflow', 'Вопросы Stack Overflow', 'Реальные вопросы русскоязычного Stack Overflow', sections, rows, 'https://api.stackexchange.com/2.3/questions?site=ru.stackoverflow', 3000));
}

// 10. RIA news sample: headlines plus first complete sentences from the same
// real articles, yielding a more playable strange-news corpus.
{
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

fs.writeFileSync(`${SRC}BUILD-MANIFEST.json`, JSON.stringify(manifests, null, 2));
for (const m of manifests) console.log(`${m.name}: ${m.records} записей (из ${m.raw})`);
