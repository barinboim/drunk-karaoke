// Обратная связь: ссылка в подвале → форма → своя служба на VPS → Telegram.
//
// **Токена бота здесь нет и быть не может.** Сайт статический и лежит в публичном
// репозитории: всё, что попадает в эти файлы, читает любой посетитель. Токен во
// фронтенде означал бы чужой доступ к переписке бота и рассылку от его имени.
// Поэтому токен живёт только на VPS, а сюда ходит обычный POST.
//
// К словам игрока прикладывается технический отчёт. Спрашивать браузер и версию
// у человека бессмысленно: назовёт неточно или бросит форму на полпути.

/** Приёмник на своём VPS. Пустая строка — отправка выключена, форма предложит Telegram. */
const ENDPOINT='https://stats.barinbo.im:8446/feedback';
/** Куда написать руками, если служба лежит. */
const FALLBACK='https://t.me/barinboimgpt';
/** Имя проекта: служба общая с Dub Choice, по нему она выбирает чат. */
const PROJECT='drunkaraoke';

const started=Date.now();
const journal=[];
let describe=()=>({});

/** Шаг игрока в дневник сеанса. Дневник — единственное, что объясняет «оно сломалось». */
export function noteStep(text){
  const at=Math.round((Date.now()-started)/1000);
  journal.push(`${String(at).padStart(4)} с · ${text}`);
  if(journal.length>60)journal.shift();
}

/**
 * @param {() => Record<string,unknown>} context что показывать в отчёте о состоянии игры
 */
export function initFeedback(context){
  if(typeof context==='function')describe=context;
  addEventListener('error',event=>noteStep(`сбой JS: ${event.message}`));
  addEventListener('unhandledrejection',event=>{
    const reason=event.reason;
    noteStep(`сбой JS (промис): ${reason instanceof Error?`${reason.name}: ${reason.message}`:String(reason)}`);
  });
  for(const element of document.querySelectorAll('[data-feedback]'))
    element.addEventListener('click',openFeedback);
  // Подвал виден не на каждом экране игры, а сломаться может на любом.
  addEventListener('keydown',event=>{
    const target=event.target;
    if(target&&(target.tagName==='INPUT'||target.tagName==='TEXTAREA'||target.isContentEditable))return;
    if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='f'){
      event.preventDefault();openFeedback();
    }
  });
}

/* ---------- отчёт ---------- */

const line=(key,value)=>value===undefined||value===null||value===''?'':`${key}: ${value}`;

function codecs(){
  if(typeof MediaRecorder==='undefined')return ['MediaRecorder: нет'];
  const probes=['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','audio/webm;codecs=opus'];
  return probes.map(type=>`${type}: ${MediaRecorder.isTypeSupported(type)?'да':'нет'}`);
}

async function environment(){
  const out=[`user-agent: ${navigator.userAgent}`];
  const data=navigator.userAgentData;
  if(data?.getHighEntropyValues){
    try{
      const hints=await data.getHighEntropyValues(['platform','platformVersion','uaFullVersion','architecture','model']);
      out.push(
        line('браузер',`${(data.brands||[]).map(b=>`${b.brand} ${b.version}`).join(', ')} (${hints.uaFullVersion||'?'})`),
        line('система',`${hints.platform||'?'} ${hints.platformVersion||''}`.trim()),
        line('устройство',hints.model),
        line('мобильный',data.mobile?'да':'нет'),
      );
    }catch{/* подсказки необязательны */}
  }
  out.push(
    line('экран',`${screen.width}×${screen.height}, окно ${innerWidth}×${innerHeight}, dpr ${devicePixelRatio}`),
    line('ядер',navigator.hardwareConcurrency),
    line('память, ГБ',navigator.deviceMemory),
    line('микрофон',navigator.mediaDevices?.getUserMedia?'доступен браузеру':'браузер не умеет'),
  );
  return out.filter(Boolean);
}

const block=(title,rows)=>{
  const body=rows.filter(Boolean);
  return body.length?`\n[${title}]\n${body.join('\n')}`:'';
};

export async function buildReport(){
  const state=describe()||{};
  const out=[
    '--- пьяное караоке · отчёт ---',
    line('страница',location.pathname+location.search),
    line('время',`${new Date().toISOString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`),
    line('в сеансе',`${Math.round((Date.now()-started)/1000)} с`),
  ];
  const game=Object.entries(state).map(([key,value])=>line(key,value));
  out.push(block('игра',game));
  out.push(block('устройство',await environment()));
  out.push(block('кодеки браузера',codecs()));
  out.push(block('шаги игрока',journal.slice(-30)));
  return out.filter(Boolean).join('\n');
}

/* ---------- форма ---------- */

function openFeedback(){
  if(document.getElementById('feedbackModal'))return;
  noteStep('открыл форму обратной связи');

  const back=document.createElement('div');
  back.id='feedbackModal';back.className='fb-back';

  const card=document.createElement('div');card.className='fb-card';
  const title=document.createElement('h3');title.textContent='Сообщить о проблеме';
  const hint=document.createElement('p');hint.className='fb-hint';
  hint.textContent='Что случилось и что ты делал перед этим? Технический отчёт приложится сам.';

  const text=document.createElement('textarea');
  text.className='fb-text';text.rows=5;
  text.placeholder='Например: нажал «Записать», микрофон не включился';

  const contact=document.createElement('input');
  contact.type='text';contact.className='fb-contact';
  contact.placeholder='Telegram или почта, если нужен ответ — необязательно';

  // Отчёт показываем целиком: скрытый сбор данных быстро становится
  // репутационной проблемой, а прятать здесь нечего.
  const details=document.createElement('details');details.className='fb-details';
  const summary=document.createElement('summary');summary.textContent='Что уйдёт вместе с сообщением';
  const pre=document.createElement('pre');pre.className='fb-report';pre.textContent='…';
  details.append(summary,pre);
  buildReport().then(report=>{pre.textContent=report;});

  const status=document.createElement('p');status.className='fb-status';status.hidden=true;
  const send=document.createElement('button');send.type='button';send.className='pill blue';send.textContent='Отправить';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='pill';cancel.textContent='Отмена';
  cancel.addEventListener('click',()=>back.remove());
  const row=document.createElement('div');row.className='fb-actions';row.append(send,cancel);

  send.addEventListener('click',()=>submit(text.value.trim(),contact.value.trim(),pre,send,status));

  card.append(title,hint,text,contact,details,row,status);
  back.append(card);
  back.addEventListener('click',event=>{if(event.target===back)back.remove();});
  addEventListener('keydown',function escape(event){
    if(event.key!=='Escape')return;
    back.remove();removeEventListener('keydown',escape);
  });
  document.body.append(back);
  text.focus();
}

function show(status,message,bad){
  status.textContent=message;
  status.classList.toggle('bad',Boolean(bad));
  status.hidden=false;
}

async function submit(message,contact,pre,send,status){
  if(!message){show(status,'Напиши хоть строчку — иначе непонятно, что чинить.',true);return;}
  send.disabled=true;
  show(status,'Отправляю…',false);
  // Пересобираем отчёт на отправку: пока человек писал, он мог что-то сделать,
  // и это «что-то» обычно и есть причина.
  const report=await buildReport();
  pre.textContent=report;
  try{
    if(!ENDPOINT)throw Error('приёмник не настроен');
    const answer=await fetch(ENDPOINT,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({project:PROJECT,message,contact,report,page:location.pathname}),
    });
    if(!answer.ok)throw Error(`HTTP ${answer.status}`);
    show(status,'Дошло. Спасибо — разберусь.',false);
    send.hidden=true;
  }catch(error){
    console.error(error);
    // Служба лежит — не теряем написанное: кладём в буфер и показываем, куда отправить руками.
    navigator.clipboard?.writeText(`${message}\n\n${contact}\n\n${report}`).catch(()=>{});
    show(status,'Не отправилось. Текст скопирован в буфер — пришли его сюда:',true);
    const link=document.createElement('a');
    link.href=FALLBACK;link.target='_blank';link.rel='noopener';
    link.className='pill';link.textContent='Написать в Telegram';
    status.append(document.createElement('br'),link);
    send.disabled=false;
  }
}
