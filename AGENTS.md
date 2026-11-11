# AGENTS.md

Учебный проект Хекслета «Календарь звонков»: Go-бэкенд в корне + SPA в `frontend/`. Всё управление — через mise, Makefile и `bin/` удалены намеренно.

## Инструменты и команды

Все инструменты (go 1.26, node 24, pnpm, golangci-lint, gotestsum, oapi-codegen, go-arch-lint) закреплены в `mise.toml`. Запуск задач — только `mise run <задача>` (`mise tasks` — список). Если голые `go`/`pnpm` недоступны — нет активации mise (`eval "$(mise activate zsh)"`); системный node — старый (18), не использовать.

- `mise run dev` — бэкенд + фронтенд параллельно; бэкенд `:8080` (переопределение через `PORT`, healthcheck `/health`), SQLite-файл через `DB_PATH` (дефолт `calls.db` в cwd), фронт `:5173` (`strictPort`), dev-прокси `/api` и `/health` → `:8080`
- `mise run check` — полный прогон проверок одной командой: lint + тесты Go + тесты фронта + браузерный сценарий `e2e` (Playwright против собранного бинаря с embed-фронтом) + дрейф-контроль `api-check` (регенерация и сверка с коммитом)
- `mise run lint` — golangci-lint (Go) + eslint (фронтенд), обе части обязательны к зелёному
- `mise run test` — gotestsum; один тест: `mise x -- go test ./tests/smoke/ -v -run TestAppStartup`
- `mise run frontend-test` / `frontend-build` / `frontend-install`
- `mise run e2e` — Playwright-сценарии из `e2e/` против настоящего сервера: собирает прод-бинарь целиком (фронт → embed → `go build`), поднимает его на `:8099` с throwaway-базой `tmp/e2e.db` (каждый прогон на чистой). `e2e-install` — установка браузеров (идемпотентно, no-op если на месте); `e2e-junit` — то же с junit-отчётом в `reports/`
- `mise run build` — прод-сборка целиком: сборка фронта → копия в `internal/web/dist` → `go build ./...` (фронт зашит в бинарь через `go:embed`, SPA-фолбэк для клиентских роутов в `internal/web`). Запускаемый бинарь не остаётся — `go build ./...` при мультипакетном паттерне отбрасывает артефакты; нужен бинарь — `mise x -- go build -o tmp/server ./cmd/server`
- `mise run docker-build` — сборка Docker-образа (без push); в `check` не входит — требует запущенного Docker-демона, но шаг есть в CI
- `mise run test-junit` / `frontend-test-junit` / `e2e-junit` — те же тесты, но с junit-отчётами в `reports/`; CI публикует их артифактами
- `mise run generate` — весь design-first пайплайн: `api/**/*.tsp` → `api/openapi.yaml` (tsp) → `internal/api/openapi.gen.go` (oapi-codegen) → `frontend/src/api/` (hey-api). См. секцию «API: design-first»
- `mise run api-check` — дрейф-контроль: регенерирует всё и роняет `git diff --exit-code`, если закоммиченные артефакты не соответствуют `.tsp` (в CI — отдельный шаг)
- `mise run api-install` — pnpm install внутри `api/` (не обязателен: pnpm 12 сам доустанавливает перед run-скриптами)
- Git-хуки: один раз на клон `git config core.hooksPath .githooks` — pre-commit ловит gofmt и билд-артефакт вместо placeholder в `internal/web/dist/index.html`; commit-msg проверяет заголовок (тип, русское описание, `(#N)` для реализации)

## Конвенции

- Бэкенд — stdlib-роутинг (net/http, mux Go 1.22+), без chi/gin. Новые ручки вешать под префикс `/api/...` — от этого зависит vite-прокси без правок конфига. Сгенерированный oapi-codegen роутинг тоже stdlib-паттернами (`"GET /health"`), конвенция не нарушается
- Go-зависимости вне stdlib — только осознанные: `modernc.org/sqlite` (хранилище, ADR-0001) и `github.com/oapi-codegen/runtime` (требуется сгенерированным кодом с телами/параметрами). Новые добавлять через ADR
- Зависимости фронта ставить pnpm внутри `frontend/`. Корень репо не должен становиться npm-пакетом (никаких package.json/node_modules в корне)
- Frontend: React 19 + TS + Tailwind 4 + shadcn (base: radix). Компоненты добавлять через shadcn MCP (opencode.json) или `pnpm dlx shadcn@latest add <имя>` из `frontend/`
- Тесты фронта: vitest + RTL + jest-dom, jsdom, setup `src/test/setup.ts`; импорты `{ test, expect }` из vitest явно (globals не включены)

## API: design-first (TypeSpec)

Единственный источник правды — `api/main.tsp` (типыpec-проект со своим `package.json`, версии пинованы в `api/pnpm-lock.yaml`; редактор — VS Code расширение TypeSpec).

- Пайплайн: `.tsp` → `api/openapi.yaml` (OpenAPI 3.0.0, эмиттер `@typespec/openapi3`) → `internal/api/openapi.gen.go` (oapi-codegen: strict-server + std-http) и `frontend/src/api/` (hey-api, fetch-клиент). Всё запускает `mise run generate`
- Правки руками только в `.tsp` и в ручном коде (`internal/api/health.go` — реализация сгенерированного `StrictServerInterface`, монтаж в `internal/server/server.go` через `HandlerWithOptions`). `openapi.yaml`, `*.gen.go`, `frontend/src/api/` — всегда производные: править нельзя, только регенерить и коммитить
- Сгенерированные артефакты коммитим сознательно: Go-билд и фронт не зависят от node/tsp, диф контракта виден в PR, дрейф ловит `mise run api-check` (в CI)
- `/health` описан в контракте, но живёт вне `/api` (инфраструктурный); catch-all `GET /api/` → 404 и SPA-фолбэк — ручные, вне кодгена
- Новая ручка: правишь `.tsp` → `mise run generate` → реализуешь метод в `internal/api/` → коммитишь контракт и артефакты одним коммитом
- Рабочий синтаксис версий кодгена (tsp 1.17 / oapi-codegen 2.8 / hey-api 0.99) и их грабли: [docs/agents/design-first-pipeline.md](docs/agents/design-first-pipeline.md)

## Коммиты

Формат Conventional Commits 1.0.0: `<type>(<scope>): <описание>` — описание на русском, инфинитив; `type`/`scope` — английские токены.

- Типы: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `ci`; scope — часть системы (`server`, `frontend`, `api`, `tools`, `agents`)
- `feat` → minor, `fix` → patch; breaking changes — `!` после типа или футер `BREAKING CHANGE: ...`
- Будущий деплой по тегам `v*` будет опираться на историю коммитов (semver)
- **Коммиты реализации ссылаются на тикеты**: номер в заголовке — `feat(api): типы звонков через весь стек (#14)`. Без тикета — только доки/хор
- Служебные заголовки хук пропускает: `Merge ...` (мердж ветки — `Merge branch '<name>': <описание>`), `Revert ...`, `chore(main): release ...`; всё остальное проверяется по правилам выше

## Ветки, PR и релизы

- Фичи спеки делаются через `/implement-spec` **одной веткой на спеку** (#14–#17 — одна ветка), тикеты выполняются по очереди; коммиты внутри ссылаются на свой тикет `(#N)`
- Финальный PR спеки мерджится **merge-commit**'ом, не squash — squash схлопнул бы ссылки на тикеты в один коммит. Перед мерджем — общее ревью всей ветки (`/code-review`)
- Мелкие chore/docs — короткой веткой + PR (merge-commit) или прямым коммитом в main
- Меняешь принятое решение (правила записи, окно, часы, процесс) — в том же PR обнови карту решений #13, спеку #6 и GLOSSARY.md
- Релизы: **release-please** (`.github/workflows/release-please.yml` + `release-please-config.json`) следит за main и копит conventional-коммиты в release-PR (бамп версий в `frontend/package.json` и `api/package.json` через extra-files + секция в CHANGELOG.md). Мердж release-PR = тег `vX.Y.Z` + GitHub Release
- Первый релиз — `v0.1.0` (опция `release-as` в конфиге); после его выхода `release-as` убрать, дальше версии считает история коммитов
- Требование «одна команда проверок» закрывается `mise run check`: lint + тесты Go + тесты фронта + браузерный сценарий Playwright с настоящим сервером (без подмены ответов API)

## Тесты

`tests/smoke/` — black-box: сам собирает бинарь (`go build ./cmd/server`), запускает на случайном свободном порту со throwaway-базой (`DB_PATH` во временный файл), опрашивает `/health` и `/` (index из embed). Не конфликтует с работающими dev-серверами; при правке пути/порта/health-роута учесть.

API-тесты — в `internal/server/` (httptest через реальный монтаж сервера с throwaway SQLite): проверяют внешнее поведение — статусы и тела, включая персистентность (новый сервер на том же файле базы).

Юнит-тесты хранилища — в `internal/storage/`: публичные методы `Store` на throwaway SQLite (пример — посев дефолтных Типов звонка, #26).

`e2e/` — браузерные сценарии Playwright (см. «Грабли»): запускаются только mise-задачами (`e2e`/`e2e-junit`), которые сначала собирают прод-бинарь.

## Линтеры: нестандартное

- `.golangci.yml` (v2-синтаксис): `gosec`/`noctx` отключены только в `*_test.go`; у `revive` выключен `package-comments` — не добавлять package-комментарии ради линтера
- В `cmd/server/main.go` строка лога помечена `#nosec G706` (taint из env `PORT`) — не удалять и не размножать: правило оставлено для будущего пользовательского ввода
- `go-arch-lint` установлен, конфига нет — `arch-lint.yml` заводить при появлении доменных пакетов

## Грабли (проверено на практике)

- `.github/workflows/hexlet-check.yml` — автогенерат Хекслета, никогда не править/удалять
- Скаффолды shadcn создают вложенный `.git` в рабочей директории — удалять сразу
- `shadcn mcp init ...` делает `npm install` в текущей папке (мусор в корне) — уже чистили один раз
- CLI shadcn 4.x: шаблон называется `-t vite` (не react); `-b/--base` — библиотека примитивов (radix), не цвет; неинтерактивно: `-t vite --base radix -p <пресет> -n <имя> --no-monorepo` (stdin-промпты не читает)
- pnpm 12 протаскивает `--` в скрипт: `pnpm run x -- --flag` не доезжает до утилиты — флаги оформлять отдельным полем в `scripts` (пример: `test:junit`)
- pnpm 12 сам доустанавливает зависимости перед `pnpm run <скрипт>` (на этом работает CI без явных install-шагов), но **не** перед `pnpm exec` — в mise-задачах вызывать скрипты через `pnpm --dir <пакет> run <скрипт>`, а не `pnpm exec <бинарь>`
- release-please работает на GITHUB_TOKEN: созданные им теги и релизы **не триггерят** другие воркфлоу (ограничение GitHub). Когда появится деплой по тегам — перейти на PAT/fine-grained token в секрете
- `internal/web/dist/index.html` — закоммиченный placeholder: без него `go:embed all:dist` не собирается на свежем чекауте. После `mise run build` этот файл заменяется реальным index из билда и висит «грязным» в git — это ожидаемо; не коммитить его попутно с фичами (вернуть: `git checkout -- internal/web/dist/index.html`)
- CI: junit-задачи дублируют обычные test/frontend-test с отчётами; если меняете состав `check`, mirrors в `.github/workflows/ci.yml` (lint + junit-варианты + браузеры + e2e-junit + upload-artifact)
- Playwright (проверено на практике): конфиг `e2e/playwright.config.ts` — голый объект **без импорта** `@playwright/test` (конфиг грузится обычным require, маппинг имён работает только для файлов тестов); `webServer` исполняется с cwd директории конфига — в конфиге задан `cwd: ".."`, пути в команде относительны корня репо; junit-выход — только через env `PLAYWRIGHT_JUNIT_OUTPUT_NAME` (CLI-флага нет), путь абсолютный; `e2e/` живёт без package.json — корень репо npm-пакетом не становится
- CI/деплой: деплой — Render, отдельный сервис `call-calendar-387`, собирается из репо по Dockerfile на каждый пуш в main. Старый сервис `call-calendar-386` этим репозиторием не управляется. Отставание прода от main ловит воркфлоу `deploy-drift`. API звать напрямую: `curl -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/...` — ключ в окружении оператора; если встроенные render-инструменты сессии ответили `unauthorized`, доступ всё равно есть через curl. Деплоя по тегам и systemd на VPS нет

## Agent skills

### Issue tracker

Issues tracked in GitHub Issues (`mmurzin/ai-for-developers-project-387`) via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five triage labels, label string equals role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Skill flow discipline

- Гриллинг (`/grill-with-docs`) заканчивается подтверждением общего понимания — и это **стоп-точка**. Подтверждение понимания ≠ команда на реализацию.
- После гриллинга агент предлагает пользователю ветку: `/to-spec` → `/to-tickets` (многосессионная работа) или `/implement` (помещается в одну сессию). Выбор делает пользователь.
- Реализация — только по явной команде пользователя (`/implement`, `/implement-spec`). Не продолжать писать код «в том же окне» в обход скилла: гейт `disable-model-invocation` защищает вход в скилл, и его обходят вызовом скилла, а не игнорированием.
