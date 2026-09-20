import http from 'node:http';
import {createReadStream, readFileSync, existsSync, readdirSync} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCorpusFile} from '../dist/engine.js';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const index = path.join(root, 'data/library.json');
// Song folders stay where they are; only the indexed roots are exposed, read-only.
const roots = existsSync(index) ? (JSON.parse(readFileSync(index, 'utf8')).roots || []).map(p => path.resolve(p) + path.sep) : [];
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8','.mp3':'audio/mpeg','.ogg':'audio/ogg','.m4a':'audio/mp4','.wav':'audio/wav','.opus':'audio/ogg','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'};

function resolve(name) {
  const library = /^\/library\/(\d+)\/(.*)$/.exec(name);
  if (!library) {
    const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    return file.startsWith(root) ? file : null;
  }
  const base = roots[Number(library[1])];
  if (!base) return null;
  const file = path.resolve(base, library[2]);
  return file.startsWith(base) ? file : null;
}

// Локально список датасетов строится на лету: положил .txt в dist/corpora,
// обновил страницу — он в игре. Никаких команд. На GitHub Pages сервера нет,
// поэтому там тот же список собирает сборка перед публикацией.
function corporaIndex(){
  const folder=path.join(root,'corpora');
  if(!existsSync(folder))return [];
  return readdirSync(folder)
    .filter(name=>name.endsWith('.txt'))
    .sort()
    .map(file=>{
      const id=file.replace(/\.txt$/,'');
      let meta={};
      try{meta=parseCorpusFile(readFileSync(path.join(folder,file),'utf8')).meta;}catch{}
      return {id,file,name:meta.name||id,about:meta.about||'',language:meta.language||'ru'};
    });
}

http.createServer(async (req,res)=>{
  try {
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);return res.end();}
    const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if (name === '/corpora/index.json') {
      const body = Buffer.from(JSON.stringify(corporaIndex()), 'utf8');
      res.writeHead(200, {'Content-Type': types['.json'], 'Content-Length': body.length, 'Cache-Control': 'no-store'});
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    const file = resolve(name);
    if (!file) {res.writeHead(403);return res.end();}
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    let start=0,end=info.size-1,status=200;
    const range=req.headers.range;
    if (range) {
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1]&&!match[2])) {res.writeHead(416,{'Content-Range':`bytes */${info.size}`});return res.end();}
      start=match[1]?Number(match[1]):Math.max(0,info.size-Number(match[2]));
      end=match[1]&&match[2]?Math.min(Number(match[2]),end):end;
      if(start>end||start>=info.size) {res.writeHead(416,{'Content-Range':`bytes */${info.size}`});return res.end();}
      status=206;
    }
    res.writeHead(status,{'Content-Type':types[path.extname(file).toLowerCase()]||'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-cache',...(status===206?{'Content-Range':`bytes ${start}-${end}/${info.size}`}:{})});
    if(req.method==='HEAD') return res.end();
    createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
  } catch {res.writeHead(404);res.end('Файл не найден. Выполни npm run library, если список песен пуст.');}
}).listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log(`Пьяное караоке → http://127.0.0.1:${process.env.PORT||4173}  (${roots.length} папок с песнями)`));
