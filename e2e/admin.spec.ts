import { expect, test } from "@playwright/test"

// Сквозной сценарий #14: Владелец страницы создаёт Тип звонка в админке
// и видит его в списке. Без подмены API — настоящий сервер с SQLite.
// Идентификатор не должен совпадать с дефолтными Типами звонка из посева
// при старте (intro/consult, #26) и с типами соседних спек (strategy).

test("владелец создаёт Тип звонка и видит его в списке", async ({ page }) => {
  await page.goto("/admin")

  await page.getByLabel("Идентификатор").fill("review")
  await page.getByLabel("Название").fill("Ревью кода")
  await page.getByLabel("Описание").fill("Разбор вашего кода")
  await page.getByLabel("Длительность (минуты)").fill("45")
  await page.getByRole("button", { name: "Создать" }).click()

  await expect(page.getByText("Ревью кода — 45 минут")).toBeVisible()
  await expect(page.getByText("Разбор вашего кода")).toBeVisible()
})
