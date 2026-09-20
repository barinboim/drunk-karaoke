#!/bin/bash
# Двойной щелчок в Finder — и игра открыта. Файл с расширением .command macOS
# запускает в Терминале; окно остаётся открытым, пока работает сервер, и закрытие
# окна сервер останавливает.
cd "$(dirname "$0")" || exit 1

echo "Пьяное караоке — локальный запуск"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Не найден node. Поставь Node.js: https://nodejs.org"
  echo
  read -r -p "Enter — закрыть окно "
  exit 1
fi

# Порт может быть занят прошлым запуском или другим проектом — ищем свободный.
port=4173
while lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; do
  port=$((port + 1))
done

# Список песен строится из папок с разметкой. Нет индекса — собираем сразу,
# иначе первый экран встретит пустой полкой без объяснений.
if [ ! -f dist/data/library.json ]; then
  echo "Индекса песен нет, собираю…"
  npm run library || echo "  (не получилось — игра откроется без своей библиотеки)"
  echo
fi

PORT=$port npm start &
server=$!
trap 'kill $server 2>/dev/null' EXIT INT TERM

# Ждём, пока сервер ответит, и только потом открываем браузер: иначе вкладка
# успевает показать «не удаётся подключиться».
for _ in $(seq 1 40); do
  if curl -sS -o /dev/null --max-time 1 "http://127.0.0.1:$port/" 2>/dev/null; then break; fi
  sleep 0.25
done

open "http://127.0.0.1:$port/"
echo
echo "Игра открыта: http://127.0.0.1:$port/"
echo "Чтобы остановить — закрой это окно или нажми Ctrl+C."
echo
wait $server
