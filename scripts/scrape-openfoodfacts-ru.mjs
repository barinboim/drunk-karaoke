// Snapshot Russian ingredient lists from the public Open Food Facts API.
// The database is ODbL; attribution and share-alike terms are recorded in the
// corpus source documentation.
import fs from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = `${ROOT}.corpus-source/openfoodfacts-ru.json`;
const rows = [];
async function get(url) {
  let error;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {headers:{'user-agent':'RobotKaraoke corpus snapshot'}, signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch (caught) { error = caught; await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1))); }
  }
  throw error;
}
for (let start = 1; start <= 180; start += 10) {
  const pages = await Promise.all(Array.from({length:10}, (_,i) => start+i).map(async page => {
    const url = `https://world.openfoodfacts.org/api/v2/search?languages_tags_en=russian&page_size=20&page=${page}&fields=code,product_name_ru,ingredients_text_ru,categories_tags`;
    try { return await get(url); } catch (error) { console.warn(`page ${page}: ${error.message}`); return {products:[]}; }
  }));
  for (const data of pages) for (const product of data.products || []) {
    const name = String(product.product_name_ru || '').trim();
    const ingredients = String(product.ingredients_text_ru || '').trim();
    if (ingredients || name) rows.push({code:product.code || '', name, ingredients, categories:product.categories_tags || []});
  }
  await new Promise(resolve => setTimeout(resolve, 200));
}
const unique = [];
const seen = new Set();
for (const row of rows) {
  const key = `${row.name}\u0000${row.ingredients}`.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key); unique.push(row);
}
fs.mkdirSync(`${ROOT}.corpus-source`,{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(unique,null,2),'utf8');
console.log(`Open Food Facts records: ${unique.length}; wrote ${OUT}`);
