"""Prepare the user's local UltraStar chart and backing track; no downloads."""
import array
import json
import pathlib
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
source = next(ROOT.glob('жуки*'))
chart = next(source.glob('*Минус*.txt'))
parser = "import fs from 'node:fs'; import {parseUltraStar} from './dist/ultrastar.js'; process.stdout.write(JSON.stringify(parseUltraStar(fs.readFileSync(0,'utf8'))));"
parsed = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', parser], input=chart.read_bytes(), cwd=ROOT))
lines, bpm, gap = parsed['lines'], parsed['bpm'], parsed['gap']
audio = next(source.glob('-*.mp3'))
duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(audio)]))
pcm = array.array('h', subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(audio), '-ac', '1', '-ar', '1000', '-f', 's16le', '-']))
chunk = max(1, len(pcm) // 240)
wave = [round((sum(v*v for v in pcm[i:i+chunk]) / len(pcm[i:i+chunk]))**.5, 2) for i in range(0, len(pcm), chunk)]
peak = max(wave)
wave = [round(v / peak, 3) for v in wave]
target = ROOT / 'dist'
(target / 'media').mkdir(exist_ok=True)
shutil.copyfile(audio, target / 'media/batareyka.mp3')
data = {'title': 'Батарейка', 'artist': 'Жуки', 'bpm': bpm, 'gap': gap, 'duration': duration, 'audio': 'media/batareyka.mp3', 'lines': lines, 'waveform': wave}
(target / 'data/song.json').write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
print(f'Prepared {len(lines)} lines / {sum(len(x["notes"]) for x in lines)} syllables; {duration:.2f}s. Original files unchanged.')
