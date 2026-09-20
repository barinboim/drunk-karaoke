// Собирает компактные французский и немецкий словари IPA-Dict.
// Источник: open-dict-data/ipa-dict, файлы fr_FR.txt и de.txt.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const CACHE=path.join(ROOT,'.cache/ipa-dict');
const BASE='https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data';
const SOURCES={fr:`${BASE}/fr_FR.txt`,de:`${BASE}/de.txt`};
const LICENSE_URL='https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/LICENSE';
const WORD=/^[a-zàâæçéèêëîïôœùûüÿäöüß'’-]+$/i;

fs.mkdirSync(CACHE,{recursive:true});
const download=async(url,target)=>{
  if(fs.existsSync(target))return;
  const response=await fetch(url);
  if(!response.ok)throw Error(`IPA-Dict не скачался: ${response.status} (${url})`);
  fs.writeFileSync(target,Buffer.from(await response.arrayBuffer()));
};

for(const [language,url] of Object.entries(SOURCES)){
  const raw=path.join(CACHE,`${language}.txt`);
  await download(url,raw);
  const words={};
  for(const line of fs.readFileSync(raw,'utf8').split(/\r?\n/)){
    const [spelling,pronunciations]=line.split('\t');
    const word=spelling?.trim().toLowerCase().replace(/[’‘]/g,"'");
    if(!word||!WORD.test(word)||!pronunciations)continue;
    const ipa=pronunciations.split(/,\s*/)[0].trim().replace(/^\/(.*)\/$/,'$1');
    if(ipa)words[word]=ipa;
  }
  fs.writeFileSync(path.join(ROOT,'dist/data',`pronunciations-${language}.json`),JSON.stringify(words),'utf8');
  console.log(`${language}: ${Object.keys(words).length.toLocaleString('ru')} слов`);
}

const license=path.join(CACHE,'LICENSE');
await download(LICENSE_URL,license);
fs.writeFileSync(path.join(ROOT,'dist/data/IPA-DICT-LICENSE.txt'),[
  'IPA-Dict data source: https://github.com/open-dict-data/ipa-dict',
  'French source: fr_FR.txt; German source: de.txt',
  '',fs.readFileSync(license,'utf8'),
].join('\n'),'utf8');
console.log('Готово: два отдельных словаря в dist/data');
