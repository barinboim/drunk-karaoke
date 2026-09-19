// Оценка считается вне потока интерфейса: разбор высоты по целой песне — это
// сотни миллионов операций, на главном потоке экран бы замер.
import {measureTake,summarize} from './score.js';

self.onmessage=({data})=>{
  try{
    const measured=data.takes.flatMap(take=>measureTake(take,data.lines));
    self.postMessage({id:data.id,result:summarize(measured,data.lines)});
  }catch(error){self.postMessage({id:data.id,error:error.message});}
};
