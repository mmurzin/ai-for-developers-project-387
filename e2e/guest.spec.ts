import { expect, test } from "@playwright/test"

import { addDays, dayKey, firstWindowDay, windowDaysInFirstMonth } from "./dates"

// Сквозной сценарий #15: Гость открывает главную, выбирает Тип звонка
// и видит календарь выбора дня с вычисленными Слотами. Тип не сеется
// сценарием: «Консультация» — дефолтный Тип звонка, посеянный сервером
// при старте на пустой базе (#26); создание через UI закрыто admin.spec.ts.

test("гость выбирает тип звонка и видит календарь слотов", async ({ page }) => {
  await page.goto("/")

  await page.getByRole("link", { name: "Консультация — 30 минут" }).click()

  await expect(page.getByRole("heading", { name: "Свободные Слоты" })).toBeVisible()

  // Шапка показывает, на что записывается Гость: строка «Название ·
  // N минут» приходит из списка Типов звонков поиском по id роута
  // («Консультация» — дефолтный посев сервера, 30 минут).
  await expect(page.getByText("Консультация · 30 минут")).toBeVisible()

  // Окно записи — всегда 14 календарных дней со следующего дня,
  // включая выходные: в показанном месяце доступны ровно те дни
  // Окна, что в него попадают (месяц первого доступного дня).
  const grid = page.getByRole("grid")
  const enabledDays = grid.getByRole("button", { disabled: false })
  await expect(enabledDays).toHaveCount(windowDaysInFirstMonth())

  // Первый доступный день Окна доступен, сегодняшний (до Окна) — нет.
  const first = firstWindowDay()
  await expect(page.locator(`td[data-day="${dayKey(first)}"] button`)).toBeEnabled()
  const today = new Date()
  if (today.getMonth() === first.getMonth()) {
    await expect(page.locator(`td[data-day="${dayKey(today)}"] button`)).toBeDisabled()
  }

  // Первый доступный день выбран автоматически: сетка его Слотов
  // детерминирована — первый старт 09:00, для длительности 30 минут
  // последний старт 17:30. Время — с явным смещением зоны инстанса
  // (Europe/Moscow, +03:00).
  const daySlots = page.locator('section[aria-label="Слоты выбранного дня"]')
  await expect(daySlots.locator("li").first()).toHaveText("09:00 (+03:00)")
  await expect(daySlots.locator("li").last()).toHaveText("17:30 (+03:00)")
})

// Сквозной сценарий #16: Гость выбирает Тип звонка, записывается
// на Слот через постоянную форму Записи (имя, контакт) и видит
// подтверждение с деталями Записи. Время созданной Записи исчезает
// из Слотов. Тип — дефолтный «Консультация» из посева при старте
// сервера (#26).

test("гость записывается на Слот и видит подтверждение", async ({ page }) => {
  await page.goto("/")

  await page.getByRole("link", { name: "Консультация — 30 минут" }).click()
  await expect(page.getByRole("heading", { name: "Свободные Слоты" })).toBeVisible()

  const daySlots = page.locator('section[aria-label="Слоты выбранного дня"]')
  const booking = page.locator('section[aria-label="Запись на Слот"]')

  // Колонка Записи видна всегда: до выбора Слота сводка — подсказка,
  // поля и кнопка «Записаться» неактивны.
  await expect(booking).toBeVisible()
  await expect(booking.getByTestId("booking-summary")).toHaveText("Слот не выбран")
  await expect(page.getByLabel("Имя")).toBeDisabled()
  await expect(page.getByLabel("Контакт")).toBeDisabled()
  await expect(page.getByRole("button", { name: "Записаться" })).toBeDisabled()

  // Клавиатурная доставка «день → время → форма» без мыши. Дни
  // календаря и времена — настоящие кнопки: фокус ставим явно
  // (focus()), выбор — Enter (нативное поведение кнопки; стрелочную
  // навигацию самой библиотеки не трогаем). Проверяем выбор на
  // втором дне Окна и возвращаемся к первому — Запись останется на
  // нём, как в исходном сценарии.
  const first = firstWindowDay()
  const second = addDays(first, 1)
  const sameMonth =
    first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth()
  if (!sameMonth) {
    // Второй день Окна — уже в следующем месяце: и календарь
    // листаем с клавиатуры (Enter по кнопке навигации).
    await page.getByRole("button", { name: "Перейти к следующему месяцу" }).focus()
    await page.keyboard.press("Enter")
  }
  await page.locator(`td[data-day="${dayKey(second)}"] button`).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("gridcell", { selected: true })).toHaveAttribute(
    "data-day",
    dayKey(second),
  )

  // Возврат к первому дню Окна тем же способом.
  if (!sameMonth) {
    await page.getByRole("button", { name: "Перейти к предыдущему месяцу" }).focus()
    await page.keyboard.press("Enter")
  }
  await page.locator(`td[data-day="${dayKey(first)}"] button`).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("gridcell", { selected: true })).toHaveAttribute(
    "data-day",
    dayKey(first),
  )

  // Слот — тоже клавишей: первый старт дня — 09:00 (+03:00).
  await daySlots.getByRole("button", { name: "09:00 (+03:00)" }).focus()
  await page.keyboard.press("Enter")

  // Выбор активирует форму; сводка — интервал со смещениями и
  // длительность из границ Слота, без дополнительных запросов.
  await expect(page.getByLabel("Имя")).toBeEnabled()
  await expect(booking.getByTestId("booking-summary")).toContainText(
    "09:00 (+03:00) – 09:30 (+03:00)",
  )
  await expect(booking.getByTestId("booking-summary")).toContainText("30 минут")

  await page.getByLabel("Имя").fill("Миша")
  await page.getByLabel("Контакт").fill("guest@example.com")
  // Отправка формы — тоже с клавиатуры: Enter в поле ввода (нативная
  // отправка формы с кнопкой submit).
  await page.getByLabel("Контакт").press("Enter")

  // Подтверждение с деталями Записи: тип, время, имя.
  await expect(page.getByRole("heading", { name: "Запись подтверждена" })).toBeVisible()
  const details = page.getByTestId("booking-details")
  await expect(details).toContainText("Консультация")
  await expect(details).toContainText("30 минут")
  await expect(details).toContainText("09:00 (+03:00) – 09:30 (+03:00)")
  await expect(details).toContainText("Миша")
  await expect(details).toContainText("guest@example.com")

  // «Записаться ещё раз» возвращает к календарю: первый доступный
  // день Окна выбран автоматически, время созданной Записи вырезано
  // из Слотов. Запись 09:00–09:30 убирает старты 09:00 и 09:15
  // (каждый заезжает в интервал), но не 09:30 — примыкающий справа.
  await page.getByRole("button", { name: "Записаться ещё раз" }).click()
  await expect(page.getByRole("gridcell", { selected: true })).toHaveAttribute(
    "data-day",
    dayKey(firstWindowDay()),
  )
  await expect(daySlots.getByRole("button", { name: "09:00 (+03:00)" })).toHaveCount(0)
  await expect(daySlots.getByRole("button", { name: "09:15 (+03:00)" })).toHaveCount(0)
  await expect(daySlots.getByRole("button", { name: "09:30 (+03:00)" })).toBeVisible()
  // Выбор сброшен: сводка снова подсказка, форма неактивна.
  await expect(booking.getByTestId("booking-summary")).toHaveText("Слот не выбран")
  await expect(page.getByLabel("Имя")).toBeDisabled()
})
