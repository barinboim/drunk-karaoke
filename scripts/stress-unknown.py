# Ставит ударения словам, которых нет в словаре, моделью Silero Stress и дописывает их
# в dist/data/accents.txt отдельным помеченным разделом.
#
#   DUMP_UNKNOWN=/tmp/u.json CORPORA_ONLY=drugs node scripts/build-real-corpora.mjs
#   .corpus-source/venv/bin/python scripts/stress-unknown.py /tmp/u.json --section "…" --source "…"
#
# Модель ставится в сборочное окружение: .corpus-source/venv/bin/pip install silero-stress.
# Сначала запускай с --dry-run и смотри выборку глазами: модель ошибается редко, но
# системно («гликемиче́ского» вместо «гликеми́ческого»). Найденный шаблон ошибки добавь в FIXES.
import argparse, collections, json, random, re, sys, warnings
from pathlib import Path

warnings.filterwarnings('ignore')
ROOT = Path(__file__).resolve().parent.parent
ACCENTS = ROOT / 'dist/data/accents.txt'
VOWELS = 'аеёиоуыэюя'
MARK = '́'
# Замеченные системные промахи модели: (что поставила, как правильно).
FIXES = [('иче' + MARK + 'ск', 'и' + MARK + 'ческ')]
WORDS = {'акне' + MARK: 'а' + MARK + 'кне', 'манты' + MARK: 'ма' + MARK + 'нты'}
# Число, склеенное с единицей («10мг» → «десятьмг», «18г» → «восемнадцатьг»): не слово.
GLUED = re.compile(r'^(?:ноль|один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|\w+надцать|'
                   r'двадцать|тридцать|сорок|\w+десят|девяносто|сто|двести|триста|\w+сот|тысяч[аи]?)[а-яё]{1,3}$')

norm = lambda word: word.lower().replace(MARK, '').replace('ё', 'е')
vowels = lambda word: sum(ch in VOWELS for ch in word.lower())


def known_words():
    known = {key.replace('ё', 'е') for key in json.loads((ROOT / 'dist/data/dictionary.json').read_text())}
    for line in ACCENTS.read_text().splitlines():
        word = line.split('#')[0].strip()
        if re.fullmatch(r'[а-яёА-ЯЁ' + MARK + ']+', word):
            known.add(norm(word))
    return known


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('inputs', nargs='+', help='JSON-списки фраз, отсеянных словарём')
    parser.add_argument('--section', required=True, help='заголовок раздела в accents.txt')
    parser.add_argument('--source', required=True, help='откуда фразы, для шапки раздела')
    parser.add_argument('--dry-run', action='store_true', help='только показать выборку')
    args = parser.parse_args()

    from silero_stress import load_accentor
    known = known_words()
    phrases = sorted({p for path in args.inputs for p in json.loads(Path(path).read_text())})
    # Аббревиатуры читаются по буквам («ОРВИ» — о-эр-вэ-и): слогов больше, чем гласных.
    caps = {w.lower() for p in phrases for w in re.findall(r'[а-яёА-ЯЁ]+', p) if len(w) >= 2 and w.isupper()}
    accentor = load_accentor()
    votes = collections.defaultdict(collections.Counter)
    for phrase in phrases:
        for token in re.findall(r'[а-яёА-ЯЁ+]+', accentor(phrase)):
            bare = token.replace('+', '')
            if vowels(bare) < 2 or norm(bare) in known or bare.lower() in caps or GLUED.match(norm(bare)):
                continue
            if token.count('+') != 1:
                continue
            at = token.index('+')
            form = (token[:at] + token[at + 1] + ('' if token[at + 1].lower() == 'ё' else MARK) + token[at + 2:]).lower()
            votes[bare.lower()][form] += 1

    forms, fixed, disputed = [], 0, 0
    for word in sorted(votes):
        form, count = votes[word].most_common(1)[0]
        if count < sum(votes[word].values()):
            disputed += 1
        before = form
        for wrong, right in FIXES:
            form = form.replace(wrong, right)
        form = WORDS.get(form, form)
        fixed += form != before
        forms.append((form, sum(votes[word].values())))

    print(f'{len(phrases)} фраз, {len(forms)} новых слов, исправлено {fixed}, спорных {disputed}', file=sys.stderr)
    top = sorted(forms, key=lambda item: -item[1])[:60]
    random.seed(1)
    sample = random.sample(forms, min(90, len(forms)))
    print('ЧАСТЫЕ:', ' '.join(form for form, _ in top), file=sys.stderr)
    print('СЛУЧАЙНЫЕ:', ' '.join(form for form, _ in sample), file=sys.stderr)
    if args.dry_run or not forms:
        return
    head = (f'\n## {args.section}\n'
            f'# Слова, которых нет в OpenRussian, из фраз: {args.source}. Ударение поставила модель\n'
            f'# Silero Stress (github.com/snakers4/silero-stress) по всем фразам, где слово встречается;\n'
            f'# проверено выборкой глазами, системные промахи исправлены правилами FIXES в\n'
            f'# scripts/stress-unknown.py. Нашёл ошибку — правь прямо здесь.\n')
    with ACCENTS.open('a') as out:
        out.write(head + '\n'.join(form for form, _ in forms) + '\n')


if __name__ == '__main__':
    main()
