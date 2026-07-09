# HH reverse-proxy (обход гео-блокировки api.hh.ru)

`api.hh.ru` блокирует зарубежные серверные IP (Fly в Стокгольме → 403). Этот
контейнер разворачивается на **российском** сервере и проксирует запросы бота
к HeadHunter, чтобы HH видел RU-адрес.

**Безопасность и изоляция:**
- Отдельный контейнер Caddy, слушает только свой порт. Ничего на сервере не
  трогает (не лезет в nginx/CRM), сносится одной командой `docker compose down`.
- Проксирует **только на `https://api.hh.ru`** — это не открытый прокси.
- Пропускает лишь запросы с секретным заголовком `X-Proxy-Key` (иначе 403),
  чтобы прокси нельзя было использовать со стороны.

## Развёртывание на RU-сервере

Нужен Docker + docker compose.

```bash
# 1. Скопировать папку proxy/ на сервер (scp/git) и зайти в неё
cd proxy

# 2. Сгенерировать секрет
cp .env.example .env
sed -i "s/^HH_PROXY_KEY=.*/HH_PROXY_KEY=$(openssl rand -hex 24)/" .env
cat .env    # запомни HH_PROXY_KEY — он же понадобится боту

# 3. Поднять контейнер
docker compose up -d

# 4. Открыть порт наружу (если включён ufw)
sudo ufw allow 8088/tcp

# 5. Проверка (подставь свой ключ). Должен вернуться JSON вакансий:
KEY=$(grep HH_PROXY_KEY .env | cut -d= -f2)
curl -s -H "X-Proxy-Key: $KEY" "http://localhost:8088/vacancies?text=python&area=113&per_page=1" | head -c 200
echo
# без ключа → 403:
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8088/vacancies?text=python"
```

## Подключение бота (на Fly)

```bash
fly secrets set \
  HH_API_BASE="http://<IP-сервера>:8088" \
  HH_PROXY_KEY="<тот же секрет>" \
  -a find-job-bot
# Fly сам передеплоит машину с новыми секретами
```

Бот шлёт `X-Proxy-Key` на каждый запрос к HH (см. `src/sources/hh.ts`),
поэтому направив `HH_API_BASE` на прокси, HH снова начнёт отдавать вакансии.

## Снести

```bash
docker compose down
```
