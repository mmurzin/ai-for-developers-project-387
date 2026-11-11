import { defineConfig } from "@hey-api/openapi-ts";

// Генерация типизированного TS-клиента из единого контракта api/openapi.yaml
// (производный артефакт: правится только api/main.tsp, реген — pnpm run gen:api).
export default defineConfig({
  client: "fetch",
  input: "../api/openapi.yaml",
  output: {
    path: "src/api",
    // вывод отформатирован локальным prettier: pnpm format и регенерация
    // не создают диффов друг у друга
    postProcess: ["prettier"],
  },
});
