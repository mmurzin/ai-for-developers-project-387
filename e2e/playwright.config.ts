// Конфиг Playwright для e2e против настоящего Go-бинаря с embed-фронтом.
//
// ВАЖНО: без импорта "@playwright/test" — конфиг Playwright грузит обычным
// require из node, без node_modules резолвинг пакета не сработает (маппинг
// имён работает только для файлов тестов). Конфиг — голый объект-литерал.
export default {
  testDir: ".",
  timeout: 30000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8099",
  },
  webServer: {
    // cwd webServer по умолчанию — директория конфига (e2e/); бинарь и база
    // живут в tmp/ корня репо ($PWD раскрывается из cwd процесса).
    // rm -f tmp/e2e.db в mise-задаче e2e даёт каждый прогон на чистой базе.
    cwd: "..",
    command: 'PORT=8099 DB_PATH="$PWD/tmp/e2e.db" ./tmp/e2e-server',
    url: "http://127.0.0.1:8099/health",
    reuseExistingServer: false,
    timeout: 15000,
    stdout: "ignore",
  },
}
