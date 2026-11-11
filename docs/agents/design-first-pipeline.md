# Design-first пайплайн: рабочий синтаксис и грабли версий

Рабочие комбинации версий (tsp 1.17 / oapi-codegen 2.8 / hey-api 0.99), найденные практикой: только то, что конфиги и компилятор сами не расскажут без дорогих итераций.

## TypeSpec (tsp 1.17)

- Объектные значения в декораторах — только `#{...}`; `{...}` — тип-выражение, компилятор ответит `expect-value`.
- `@service(#{ title: ... })` не принимает `version`: версия задаётся отдельно — `@OpenAPI.info(#{ version: "0.0.1" })` на том же namespace.
- Операция без `@route` получает маршрут `/` — пиши явный `@route("/...")` + `@get`/`@post` у каждой операции.

## oapi-codegen (2.8)

- Конфиг v2.8 — плоские флаги: `generate: { models: true, std-http-server: true, strict-server: true }`.
- `output-options.include-routing` удалён: метод-паттерны Go 1.22 (`"GET /health"`) генерируются по умолчанию.
- Подключение: `HandlerWithOptions(strict, StdHTTPServerOptions{BaseRouter: mux})`; strict-интерфейс реализуется вручную рядом с генерённым файлом.

## hey-api (0.99)

- Рантайм-клиент вкомплечен в `@hey-api/openapi-ts` (с 0.73): `@hey-api/client-fetch` не ставить — deprecated.
- Форматирование вывода — `output.postProcess: ["prettier"]`; опция `format` deprecated.

## Поток и команды

`api/main.tsp` → `api/openapi.yaml` → `internal/api/openapi.gen.go` + `frontend/src/api/` — см. AGENTS.md «API: design-first»; генерация — `mise run generate`, дрейф — `mise run api-check`.
