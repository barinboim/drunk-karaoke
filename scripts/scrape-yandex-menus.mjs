// Snapshot public Yandex Maps / Yandex Eats menu pages for the menu corpus.
// This is an offline acquisition step; the game never makes network requests.
import fs from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = `${ROOT}.corpus-source/yandex-menus.json`;
const HEADERS = {'user-agent':'Mozilla/5.0 (compatible; RobotKaraoke corpus snapshot)'};
const CITIES = [
  ['moscow','213','37.6173%2C55.7558'], ['saint-petersburg','2','30.3158%2C59.9391'],
  ['kazan','43','49.1064%2C55.7961'], ['nizhny-novgorod','47','44.0059%2C56.3269'],
  ['samara','51','50.1018%2C53.1959'], ['ufa','172','55.9587%2C54.7388'],
  ['rostov-on-don','39','39.7015%2C47.2357'], ['yekaterinburg','54','60.5975%2C56.8389'],
  ['novosibirsk','65','82.9204%2C55.0302'], ['krasnodar','35','38.9769%2C45.0355'],
  ['voronezh','193','39.2003%2C51.6608'], ['perm','50','56.2294%2C58.0105'],
  ['omsk','66','73.3686%2C54.9914'], ['saratov','194','46.0342%2C51.5331'],
  ['tyumen','55','65.5343%2C57.1531'], ['chelyabinsk','56','61.4026%2C55.1599'],
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const decode = value => value
  .replace(/&nbsp;/g,' ')
  .replace(/&amp;/g,'&')
  .replace(/&quot;/g,'"')
  .replace(/&#39;|&apos;/g,"'")
  .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
  .replace(/\s+/g,' ').trim();

async function get(url) {
  const response = await fetch(url,{headers:HEADERS});
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

const menuUrls = new Set();
const QUERIES = ['ресторан','кафе','бар','пиццерия','суши'];
for (const [city,code,ll] of CITIES) {
  for (const query of QUERIES) {
    const encoded = encodeURIComponent(query);
    const url = `https://yandex.ru/maps/${code}/${city}/search/${encoded}/?ll=${ll}&z=11`;
    try {
      const html = await get(url);
      for (const match of html.matchAll(/\/maps\/org\/[^"'\\s]+\/\d+\/menu\/?/g))
        menuUrls.add(`https://yandex.ru${match[0].replace(/\/$/,'/')}`);
    } catch (error) { console.warn(`search ${city}/${query}: ${error.message}`); }
    await sleep(180);
  }
}

const urls = [...menuUrls].slice(0,220);
const rows = [];
for (let i=0; i<urls.length; i+=4) {
  const batch = urls.slice(i,i+4);
  const pages = await Promise.all(batch.map(async url => {
    try { return {url,html:await get(url)}; }
    catch (error) { console.warn(`menu ${url}: ${error.message}`); return null; }
  }));
  for (const page of pages.filter(Boolean)) {
    const itemRe = /<div class="related-item-photo-view__title" title="([^"]*)">[\s\S]*?<div class="related-item-photo-view__description" title="([^"]*)">/g;
    for (const match of page.html.matchAll(itemRe)) {
      const title = decode(match[1]);
      const description = decode(match[2]);
      if (title) rows.push({url:page.url,title,description});
    }
  }
  await sleep(250);
}

const unique = [];
const seen = new Set();
for (const row of rows) {
  const key = `${row.title}\u0000${row.description}`.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key); unique.push(row);
}
fs.mkdirSync(`${ROOT}.corpus-source`,{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(unique,null,2),'utf8');
console.log(`Yandex menu pages: ${urls.length}; menu records: ${unique.length}; wrote ${OUT}`);
