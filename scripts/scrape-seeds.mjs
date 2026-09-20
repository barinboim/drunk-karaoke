// Snapshot real cultivar names and short descriptions from the open SortBase catalogue.
import fs from 'node:fs';
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = `${ROOT}.corpus-source/sortbase-seeds.json`;
const headers = {'user-agent':'RobotKaraoke corpus snapshot'};
const decode = s => s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/\s+/g,' ').trim();
const text = await (await fetch('https://sortbase.org/sitemap.xml',{headers})).text();
const urls = [...text.matchAll(/<loc>(https:\/\/sortbase\.org\/sort\/[^<]+)<\/loc>/g)].map(m=>m[1]);
const rows=[];
for (let i=0;i<urls.length;i+=12) {
  const pages=await Promise.all(urls.slice(i,i+12).map(async url=>{try{return await (await fetch(url,{headers})).text();}catch{return ''}}));
  for (let j=0;j<pages.length;j++) {
    const html=pages[j];
    const title=(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1];
    if (!title) continue;
    const desc=(html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)||[])[1] || '';
    rows.push({url:urls[i+j],title:decode(title),description:decode(desc)});
  }
}
const unique=[]; const seen=new Set();
for(const row of rows){const key=row.title.toLowerCase();if(seen.has(key))continue;seen.add(key);unique.push(row)}
fs.mkdirSync(`${ROOT}.corpus-source`,{recursive:true}); fs.writeFileSync(OUT,JSON.stringify(unique,null,2));
console.log(`SortBase cultivars: ${unique.length}; wrote ${OUT}`);
