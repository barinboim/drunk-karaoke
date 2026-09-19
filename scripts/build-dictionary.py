"""Compile OpenRussian word forms into a local browser lookup table. No ML."""
import csv
import json
import pathlib
import re
import shutil

root=pathlib.Path(__file__).resolve().parent.parent
source=root/'.cache/openrussian'
result={}
vowels='аеёиоуыэюя'
for name in ['adjectives','nouns','verbs','others']:
    with (source/(name+'.csv')).open(encoding='utf-8') as f:
        for row in csv.DictReader(f,delimiter='\t'):
            for field,value in row.items():
                if field is None or field in ('bare','translations_en','translations_de','aspect','partner','gender','animate','indeclinable','sg_only','pl_only') or not value:
                    continue
                for word in re.findall("[а-яёА-ЯЁ']+",value):
                    word=word.lower()
                    clean=word.replace("'",'')
                    if not clean or sum(c in vowels for c in clean)<2:
                        continue
                    positions=[]
                    if "'" in word:
                        positions=[sum(c in vowels for c in word[:m.start()])-1 for m in re.finditer("'",word)]
                    elif 'ё' in word:
                        positions=[sum(c in vowels for c in word[:word.index('ё')+1])-1]
                    if positions:
                        result.setdefault(clean.replace('ё','е'),set()).update(positions)
result={word:sorted(stresses) for word,stresses in sorted(result.items())}
(root/'dist/data/dictionary.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
shutil.copyfile(source/'LICENSE',root/'dist/data/OPENRUSSIAN-LICENSE.txt')
print(f'{len(result):,} accented word forms compiled from OpenRussian (CC BY-SA 4.0).')
