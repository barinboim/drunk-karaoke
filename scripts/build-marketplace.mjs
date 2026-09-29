// Rebuild the local marketplace title corpus from the Wildberries snapshot.
// Keep whole product titles; ignore SKU color metadata and limit color-heavy titles.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = path.join(ROOT, '.corpus-source/wb-products-expanded.json');
const STRESS = path.join(ROOT, '.corpus-source/marketplace-stress.txt');
const OUTPUT = path.join(ROOT, 'dist/corpora/ali.txt');
const sections = ['Одежда и аксессуары','Дом и кухня','Красота и здоровье','Электроника','Детское и игрушки','Спорт, сад и авто','Разное'];
const vowels = /[аеёиоуыэюя]/gi;
const known = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/data/dictionary.json'), 'utf8'))));
for (const line of fs.readFileSync(path.join(ROOT, 'dist/data/accents.txt'), 'utf8').split(/\r?\n/)) {
  const word = line.split('#')[0].trim().toLowerCase().replace(/́/g, '');
  if (/^[а-яё]+$/.test(word)) known.add(word);
}
if (fs.existsSync(STRESS)) {
  for (const line of fs.readFileSync(STRESS, 'utf8').split(/\r?\n/)) {
    const word = line.trim().toLowerCase().replace(/́/g, '');
    if (/^[а-яё]+$/.test(word)) known.add(word);
  }
}
const latin = {a:'а',b:'б',c:'к',d:'д',e:'е',f:'ф',g:'г',h:'х',i:'и',j:'дж',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',q:'к',r:'р',s:'с',t:'т',u:'у',v:'в',w:'в',x:'кс',y:'й',z:'з'};
const ones = ['ноль','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
const tens = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
const hundreds = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
const colorWords = new Set(`белый белая белое белые белого белой белых белым белыми черный черная черное черные черного черной черных черным черными черно бело серый серая серое серые серого серой серых серым серыми красный красная красное красные красного красной красных красным красными синий синяя синее синие синего синей синих синим синими голубой голубая голубое голубые голубого голубой голубых голубым зеленый зеленая зеленое зеленые зеленого зеленой зеленых зеленым зеленый желтый желтая желтое желтые желтого желтой желтых желтым оранжевый оранжевая оранжевое оранжевые розовый розовая розовое розовые розового розовой розовых розовым фиолетовый фиолетовая фиолетовое фиолетовые пурпурный пурпурная пурпурное пурпурные коричневый коричневая коричневое коричневые бежевый бежевая бежевое бежевые бирюзовый бирюзовая бирюзовое бирюзовые мятный мятная мятное мятные хаки бордовый бордовая бордовое бордовые золотой золотая золотое золотые золотистый золотистая серебряный серебряная серебряное серебряные серебристый серебристая графит графитовый графитовая перламутровый прозрачный прозрачная прозрачное прозрачные лавандовый лавандовая молочный молочная молочное черно бело блэк блакк блек вайт уайт грей грэй блю блу ред редд голд силвер`.split(/\s+/));
function numberWords(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 9999) return String(value);
  if (n < 10) return ones[n];
  if (n < 20) return ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'][n - 10];
  if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`;
  if (n < 1000) return `${hundreds[Math.floor(n / 100)]}${n % 100 ? ` ${numberWords(n % 100)}` : ''}`;
  return `${numberWords(Math.floor(n / 1000))} тысяч${n % 1000 ? ` ${numberWords(n % 1000)}` : ''}`;
}
function cleanTitle(input) {
  let text = String(input || '').replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+|www\.\S+/gi, ' ');
  // Product dimensions are real spoken quantities: keep the multiplier and
  // unit as separate words before spelling out their numbers.
  text = text.replace(/(\d+)\s*[xх×*]\s*(\d+)/gi, '$1 на $2')
    .replace(/(\d)(?=[A-Za-zА-Яа-яЁё])/g, '$1 ');
  text = text.replace(/(?<!\d)\d+\s*%/g, (_, n) => `${numberWords(n)} процентов`)
    .replace(/(?<!\d)(\d+)\s*[–-]\s*(\d+)(?!\d)/g, (_, a, b) => `${numberWords(a)}-${numberWords(b)}`)
    .replace(/(?<!\d)\d+(?!\d)/g, numberWords);
  text = text.replace(/[A-Za-z]+/g, word => [...word.toLowerCase()].map(ch => latin[ch] || ch).join(''));
  return text.replace(/[“”«»"„`]/g, ' ').replace(/[|_~^*]+/g, ' ')
    .replace(/[^А-Яа-яЁё\s.,!?;:()'’—-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function sectionFor(value) {
  const text = String(value || '').toLowerCase();
  if (/одеж|обув|сумк|шапк|украшен|аксессуар/.test(text)) return sections[0];
  if (/дом|кухн|мебел|посуда|хранен/.test(text)) return sections[1];
  if (/красот|здоров|космет|гигиен|уход/.test(text)) return sections[2];
  if (/электрон|телефон|компьютер|наушник|техник/.test(text)) return sections[3];
  if (/дет|игруш|ребен|школь/.test(text)) return sections[4];
  if (/спорт|сад|авто|инструмент|туризм/.test(text)) return sections[5];
  return sections[6];
}
function syllableCount(text) { return (text.match(vowels) || []).length; }
function hasKnownWords(text) {
  const words = text.toLowerCase().replace(/́/g, '').match(/[а-яё]+/g) || [];
  return words.length > 0 && words.every(word => known.has(word) || syllableCount(word) === 1);
}
const unreadable = /акуапеел|бтридцать|винсон|даилй|дермаштамп|десигн|дреам|еасй|еау|кранберрй|куартз|кулпятнадцать|кусхион|ликуифект|маголд|мерлот|могрой|мылофф|оасйс|осбоурне|пеарлй|пксдвадцать|распберрй|рекхаргеабле|сиавид|сигкйа|слоучи|соголд|старварс|танненберг|терраин|хйперхикер|глоссйодин|хеат|автошторка|агератум|анниверсарй|арабис|баттер|ббанат|беновй|бернитом|бике|бисмарк|бумажного|версионс|виндбреакер|волканик|гелевая|глиттера|доротхй|ерик|жаккарда|инфинити|кейлон|кианитом|клаптон|конте|контрол|крепированная|кристал|кроппед|крупнолистовой|ктриста|логоманиа|майорикой|мдевятьсот|мпятьсот|нео|непроклеенный|нубука|одри|оффи|очищающая|пакетированный|палех|перекидного|пипинг|полигональное|проджект|пулевидный|ридинг|руббер|сампле|сеамлесс|себо|скарлетт|среднний|суит|схадов|таблетница|талкинг|токйо|топазом|тргрйодин|убтан|феелкозй|флееке|фотосессию|хдевять|хербалл|хивиор|хобо|хоод|цейлонский|чабрецом|чернитель|чоппер|яжемать/i;
function containsColor(text) {
  return (text.toLowerCase().match(/[а-яё]+/g) || []).some(word => colorWords.has(word));
}
function dedupe(rows) {
  const seen = new Set();
  return rows.filter(row => {
    const key = row.text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const products = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
const rows = dedupe(products.map(product => ({
  text: cleanTitle(product.imt_name),
  section: sectionFor(product.subj_root_name || product.subj_name),
})).filter(row => row.text && /[А-Яа-яЁё]/.test(row.text)
  && !/\d|[A-Za-z]/.test(row.text) && !unreadable.test(row.text)
  && syllableCount(row.text) <= 24 && hasKnownWords(row.text)));
const coreRows = rows.filter(row => syllableCount(row.text) >= 8 && syllableCount(row.text) <= 16);
// Limit color-bearing names to a small share: this adds enough medium-length
// whole titles without letting color variants dominate the marketplace corpus.
const plainCore = coreRows.filter(row => !containsColor(row.text));
const coloredCore = coreRows.filter(row => containsColor(row.text)).slice(0, 900);
const core = [...plainCore, ...coloredCore];
const tail = rows.filter(row => (syllableCount(row.text) < 8 || syllableCount(row.text) > 16) && !containsColor(row.text));
const selected = [...core, ...tail].slice(0, 15100);
const grouped = new Map(sections.map(section => [section, []]));
for (const row of selected) grouped.get(row.section).push(row.text);
const output = ['---', 'name: Товары из маркетплейсов', 'about: Реальные названия товарных карточек маркетплейса; названия с цветами ограничены', 'mode: list', 'license: CC0 1.0', 'source: https://huggingface.co/datasets/nyuuzyou/wb-products', 'attribution: nyuuzyou, Wildberries Products Dataset', 'changes: Названия отобраны целиком; числа записаны словами; латиница транслитерирована; удалены записи без проверенных ударений', '---', ''];
for (const section of sections) {
  if (!grouped.get(section).length) continue;
  output.push(`## ${section}`, ...grouped.get(section), '');
}
if (fs.existsSync(STRESS)) {
  const marks = fs.readFileSync(STRESS, 'utf8').trim();
  if (marks) output.push('## ~ударения', marks, '');
}
fs.writeFileSync(OUTPUT, output.join('\n'), 'utf8');
console.log(`WB title-only: ${selected.length} записей (${core.length} в диапазоне 8–16 слогов) из ${products.length} карточек.`);
