# Источники десяти реальных корпусов

Все файлы `dist/corpora/{yandex,dean,hh,vk,wb,drugs,headlines,stackoverflow,strange-news}.txt` собраны офлайн из открытых выгрузок. Строки не сочинялись: HTML очищен, числа записаны словами, латиница транслитерирована, а фразы с неизвестным игре ударением отобраны только после проверки общего словаря.

Девять новых корпусов увеличены до примерно 3 000 записей; `ali.txt` («Товары с маркетплейса») — до 5 000 карточек. `wb.txt` остаётся отдельным корпусом отзывов покупателей.

| Файл | Источник | Лицензия / примечание |
|---|---|---|
| `yandex.txt` | [Yandex Geo Reviews Dataset 2023](https://github.com/yandex/geo-reviews-dataset-2023) | MIT; отзывы из Яндекс Карт, PII удалены |
| `dean.txt` | [University VK publics](https://data.mendeley.com/datasets/fcyfn32mv6/1) | CC BY 4.0; посты и комментарии 9 187 вузовских пабликов |
| `hh.txt` | [IT vacancy data](https://figshare.com/articles/dataset/it_vacancy_data/19005092) | CC BY 4.0; объявления и навыки из выгрузки HeadHunter |
| `vk.txt` | [capitalization](https://github.com/annnyway/capitalization) | открытый CSV комментариев пяти публичных страниц ВКонтакте |
| `wb.txt` | [WB review dataset](https://huggingface.co/datasets/Hplss/wb-review-dataset) | CC BY-NC-SA 4.0; реальные отзывы покупателей Wildberries |
| `ali.txt` | [wb-products](https://huggingface.co/datasets/nyuuzyou/wb-products) + исходный корпус товаров | CC0; реальные названия карточек Wildberries, объединены с исходными товарными названиями без отзывов |
| `drugs.txt` | [RuDReC](https://github.com/cimm-kzn/RuDReC) | открытый корпус пользовательских отзывов о лекарствах; использованы тексты отзывов |
| `headlines.txt` | [Lenta.Ru News Dataset](https://github.com/yutkin/Lenta.Ru-News-Dataset) | открытая выгрузка заголовков и метаданных Lenta.ru |
| `stackoverflow.txt` | [Stack Exchange API, ru.stackoverflow](https://api.stackexchange.com/2.3/questions?site=ru.stackoverflow) | Stack Exchange Data License / CC BY-SA; снимок вопросов с телами |
| `strange-news.txt` | [RIA News Dataset](https://github.com/RossiyaSegodnya/ria_news_dataset) | CC BY-NC-ND; заголовки и фразы из реальных материалов РИА Новости |

Точные размеры последней сборки и количество отобранных строк находятся в `.corpus-source/BUILD-MANIFEST.json` (локальный build-артефакт). Повторная сборка выполняется командой `NODE_OPTIONS=--max-old-space-size=8192 node scripts/build-real-corpora.mjs` после одноразовой установки сборочных библиотек `npm install --no-save parquet-wasm apache-arrow csv-parse`.

## Что выяснилось при сборке

- Все новые файлы используют явный `mode: list`: строки остаются целыми записями, а разделы
  служат только для разнообразия словаря.
- Лимит обычной сборки — около 3 000 записей на корпус; `ali.txt` ограничен 5 000 карточками.
  После удаления дублей и неизвестных ударений итоговое число может быть немного меньше.
- `wb.txt` содержит только отзывы. `ali.txt` содержит только названия товарных карточек и
  варианты цвета; отзывы туда не попадают.
- Общий словарь ударений остаётся единственным источником нормы: `npm run accents` после
  сборки сообщает ноль локальных ударений в новых корпусах.

Проверка результата:

```sh
npm run corpora
npm test
npm run accents
```
