# Локальный словарь ударений

`dictionary.json` — производная от [OpenRussian / Badestrand/russian-dictionary](https://github.com/Badestrand/russian-dictionary), лицензия [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), копия в OPENRUSSIAN-LICENSE.txt. Авторы: команда и участники OpenRussian, исходные источники указаны в их репозитории.

Из четырёх TSV-таблиц сохранены словоформы и индексы ударных гласных (с нуля), без переводов. Варианты ударений сохранены; контекстное разрешение омографов не выполняется. Ё нормализуется к е только в ключе поиска. Преобразование: `scripts/build-dictionary.py`. Не используются нейросети или LLM.
