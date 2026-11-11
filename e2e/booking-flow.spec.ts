import { expect, test } from "@playwright/test"

import { addDays, dayKey, firstWindowDay } from "./dates"

// Замыкающий сквозной сценарий спеки #6 (#17): Владелец создаёт Тип
// звонка через UI админки → Гость выбирает Слот и создаёт Запись →
// Запись появляется у Владельца на странице «Предстоящие». Настоящий
// сервер с SQLite, без подмены API.
//
// Изоляция от соседних спек: все они делят один сервер и базу
// (workers параллельны), guest.spec записывается на первый день —
// поэтому здесь Запись создаётся в середине Окна записи (день 8),
// а данные Гостя уникальны, чтобы фильтр в предстоящих находил
// ровно нашу Запись.

test("владелец создаёт тип, гость записывается — Запись видна в предстоящих", async ({
  page,
}) => {
  // Владелец: создание Типа звонка через форму админки.
  await page.goto("/admin")

  await page.getByLabel("Идентификатор").fill("strategy")
  await page.getByLabel("Название").fill("Стратегическая сессия")
  await page.getByLabel("Описание").fill("Разбор стратегии и целей")
  await page.getByLabel("Длительность (минуты)").fill("30")
  await page.getByRole("button", { name: "Создать" }).click()

  await expect(page.getByText("Стратегическая сессия — 30 минут")).toBeVisible()

  // Гость: главная → календарь Слотов → Запись на день 8 Окна.
  await page.goto("/")

  await page
    .getByRole("link", { name: "Стратегическая сессия — 30 минут" })
    .click()
  await expect(page.getByRole("heading", { name: "Свободные Слоты" })).toBeVisible()

  // День 8 Окна может оказаться в следующем месяце: календарь
  // показывает месяц первого доступного дня — при необходимости
  // листаем месяц вперёд, не выходя за пределы Окна.
  const first = firstWindowDay()
  const midWindowDay = addDays(first, 7)
  if (midWindowDay.getMonth() !== first.getMonth()) {
    await page
      .getByRole("button", { name: "Перейти к следующему месяцу" })
      .click()
  }
  await page.locator(`td[data-day="${dayKey(midWindowDay)}"] button`).click()

  const daySlots = page.locator('section[aria-label="Слоты выбранного дня"]')
  const slotButton = daySlots.locator("li button").first()
  const slotTime = await slotButton.textContent()
  expect(slotTime).toBeTruthy()
  await slotButton.click()

  await page.getByLabel("Имя").fill("Мария")
  await page.getByLabel("Контакт").fill("maria@example.com")
  await page.getByRole("button", { name: "Записаться" }).click()

  await expect(page.getByRole("heading", { name: "Запись подтверждена" })).toBeVisible()

  // Владелец: Запись видна в предстоящих — тип, время со смещением,
  // данные Гостя.
  await page.goto("/admin/upcoming")

  const call = page.getByTestId("upcoming-call").filter({
    hasText: "maria@example.com",
  })
  await expect(call).toHaveCount(1)
  await expect(call).toContainText("Стратегическая сессия — 30 минут")
  await expect(call).toContainText(slotTime ?? "")
  await expect(call).toContainText("+03:00")
  await expect(call).toContainText("Мария")
})
