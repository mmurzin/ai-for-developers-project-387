import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { MemoryRouter } from "react-router"

import { client } from "@/api/client.gen"
import { App } from "@/App"

const okResponse = (status: number, body: unknown) => ({
  data: body,
  error: undefined,
  request: {} as Request,
  response: new Response(JSON.stringify(body), { status }),
})

const errorResponse = (status: number, body: unknown) => ({
  data: undefined,
  error: body,
  request: {} as Request,
  response: new Response(JSON.stringify(body), { status }),
})

// Мок GET раздаёт ответы по URL запроса: экран Слотов шлёт два GET —
// Слоты Типа звонка (/api/call-types/{id}/slots) и список Типов
// звонков (/api/call-types). Ответы Слотов расходуются по запросам
// (перезагрузка списка после конфликта), последний повторяется;
// список Типов получает один ответ на все запросы.
function mockGet(responses: { slots: unknown[]; callTypes?: unknown }) {
  const callTypes = responses.callTypes ?? okResponse(200, { items: [] })
  let requested = 0
  return vi.spyOn(client, "get").mockImplementation((({ url }: { url?: string }) => {
    if (url === "/api/call-types") {
      return Promise.resolve(callTypes)
    }
    return Promise.resolve(responses.slots[Math.min(requested++, responses.slots.length - 1)])
  }) as never)
}

afterEach(() => {
  vi.restoreAllMocks()
})

function renderSlotsPage() {
  return render(
    <MemoryRouter initialEntries={["/call-types/intro"]}>
      <App />
    </MemoryRouter>,
  )
}

// mockConflict409 — ответ создания Записи при конфликте занятости:
// время уже разобрано кем-то другим.
function mockConflict409() {
  return vi.spyOn(client, "post").mockResolvedValueOnce(
    errorResponse(409, {
      code: "slot_taken",
      message: "Это время уже занято другой Записью — выберите другой Слот",
    }) as never,
  )
}

// mockBookingCreated — успешный ответ создания Записи (201) на Слот
// с границами startsAt/endsAt.
function mockBookingCreated(startsAt: string, endsAt: string) {
  return vi.spyOn(client, "post").mockResolvedValue(
    okResponse(201, {
      callTypeId: "intro",
      callTypeName: "Интро-звонок",
      durationMinutes: 15,
      startsAt,
      endsAt,
      guestName: "Миша",
      guestContact: "guest@example.com",
    }) as never,
  )
}

// submitBookingForm — заполнение формы Записи и отправка: общая
// цепочка тестов конфликта и подтверждения.
function submitBookingForm() {
  fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Миша" } })
  fireEvent.change(screen.getByLabelText("Контакт"), {
    target: { value: "guest@example.com" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Записаться" }))
}

// Кнопка дня календаря по ключу дня «YYYY-MM-DD»: react-day-picker
// помечает ячейку сетки атрибутом td[data-day] ISO-датой.
function dayButton(container: HTMLElement, dayKey: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `td[data-day="${dayKey}"] button`,
  )
  if (!button) {
    throw new Error(`день ${dayKey} не отображён в календаре`)
  }
  return button
}

// Ячейка дня: data-disabled — публичный сигнал react-day-picker о
// недоступности дня (из него же красится ячейка). Надёжнее атрибута
// disabled кнопки: день, оставшийся в фокусе после клика, получает
// только aria-disabled.
function dayCell(container: HTMLElement, dayKey: string) {
  const cell = container.querySelector(`td[data-day="${dayKey}"]`)
  if (!cell) {
    throw new Error(`ячейка дня ${dayKey} не отображена в календаре`)
  }
  return cell
}

test("первый доступный день выбран автоматически, колонка Слотов подписана датой", async () => {
  mockGet({
    slots: [
      okResponse(200, {
        items: [
          { startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:15:00+03:00" },
          { startsAt: "2026-11-05T09:15:00+03:00", endsAt: "2026-11-05T09:30:00+03:00" },
          { startsAt: "2026-11-06T10:00:00+03:00", endsAt: "2026-11-06T10:15:00+03:00" },
        ],
      }),
    ],
  })

  renderSlotsPage()

  // Заголовок колонки Слотов — дата автовыбранного первого дня.
  expect(
    await screen.findByRole("heading", { name: "Четверг, 5 ноября" }),
  ).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "09:00 (+03:00)" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "09:15 (+03:00)" })).toBeInTheDocument()
  // Слоты другого дня не показываются до выбора дня в календаре.
  expect(
    screen.queryByRole("button", { name: "10:00 (+03:00)" }),
  ).not.toBeInTheDocument()
  // В календаре автовыбранный день отмечен выбранным.
  expect(screen.getByRole("gridcell", { selected: true })).toHaveAttribute(
    "data-day",
    "2026-11-05",
  )
})

test("шапка показывает Тип звонка и длительность из списка Типов звонков", async () => {
  mockGet({
    slots: [
      okResponse(200, {
        items: [
          { startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:15:00+03:00" },
        ],
      }),
    ],
    callTypes: okResponse(200, {
      items: [
        { id: "intro", name: "Интро-звонок", description: "Знакомство", durationMinutes: 15 },
        { id: "consult", name: "Консультация", description: "", durationMinutes: 30 },
      ],
    }),
  })

  renderSlotsPage()

  // Строка «Название · N минут» приходит вторым GET (список Типов
  // звонков) и собирается поиском по идентификатору из роута; h1
  // экрана сохраняется.
  expect(await screen.findByText("Интро-звонок · 15 минут")).toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "Свободные Слоты" })).toBeInTheDocument()
})

// Принятая тихая деградация шапки: строка «Название · N минут» —
// вспомогательные данные. Сбой списка Типов звонков не валит экран
// Слотов: колонки работают от ответа Слотов, строка просто не
// рендерится, новых сообщений и ретраев нет.
test("сбой списка Типов звонков: колонки работают, строка шапки не рендерится", async () => {
  mockGet({
    slots: [
      okResponse(200, {
        items: [
          { startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:30:00+03:00" },
          { startsAt: "2026-11-06T10:00:00+03:00", endsAt: "2026-11-06T10:30:00+03:00" },
        ],
      }),
    ],
    callTypes: errorResponse(500, {
      code: "internal_error",
      message: "Не удалось загрузить список типов звонков",
    }),
  })

  renderSlotsPage()

  // Слоты загрузились успешно — экран живёт своей загрузкой: колонка
  // Слотов подписана, кнопки времён на месте, форма доступна для
  // выбора. Ни экрана ошибки, ни алертов — деградация тихая.
  expect(
    await screen.findByRole("heading", { name: "Четверг, 5 ноября" }),
  ).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "09:00 (+03:00)" })).toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "Свободные Слоты" })).toBeInTheDocument()
  expect(screen.getByLabelText("Имя")).toBeInTheDocument()
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole("button", { name: "09:00 (+03:00)" }))
  expect(screen.getByLabelText("Имя")).toBeEnabled()
  expect(screen.getByTestId("booking-summary")).toHaveTextContent(
    "09:00 (+03:00) – 09:30 (+03:00)",
  )
})

test("строка Типа звонка появляется, когда есть оба ответа", async () => {
  let resolveSlots!: (response: unknown) => void
  const slotsResponse = new Promise((resolve) => {
    resolveSlots = resolve
  })
  // Список Типов отвечает сразу, Слоты — когда тест решит.
  vi.spyOn(client, "get").mockImplementation((({ url }: { url?: string }) => {
    if (url === "/api/call-types") {
      return Promise.resolve(
        okResponse(200, {
          items: [
            { id: "intro", name: "Интро-звонок", description: "Знакомство", durationMinutes: 15 },
          ],
        }),
      )
    }
    return slotsResponse
  }) as never)

  renderSlotsPage()

  // Тип звонка уже известен, Слоты ещё грузятся: строки нет — если
  // Слоты ответят 404, экран «не найден» подменит всю шапку.
  expect(await screen.findByRole("heading", { name: "Свободные Слоты" })).toBeInTheDocument()
  expect(screen.queryByText("Интро-звонок · 15 минут")).not.toBeInTheDocument()

  // Пришёл ответ Слотов — строка на месте.
  resolveSlots(
    okResponse(200, {
      items: [
        { startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:15:00+03:00" },
      ],
    }),
  )
  expect(await screen.findByText("Интро-звонок · 15 минут")).toBeInTheDocument()
})

test("недоступны дни без Слотов и дни вне Окна записи", async () => {
  mockGet({
    slots: [
      okResponse(200, {
        items: [
          { startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:15:00+03:00" },
          { startsAt: "2026-11-06T09:00:00+03:00", endsAt: "2026-11-06T09:15:00+03:00" },
        ],
      }),
    ],
  })

  const { container } = renderSlotsPage()
  await screen.findByRole("heading", { name: "Четверг, 5 ноября" })

  expect(dayButton(container, "2026-11-05")).toBeEnabled()
  expect(dayButton(container, "2026-11-06")).toBeEnabled()
  // Выходные не глушатся как класс: суббота недоступна не из-за
  // выходного, а из-за отсутствия Слотов.
  expect(dayButton(container, "2026-11-07")).toBeDisabled()
  // День до первого доступного — вне Окна записи.
  expect(dayButton(container, "2026-11-04")).toBeDisabled()
})

test("навигация месяцами не выходит за пределы Окна записи", async () => {
  mockGet({
    slots: [
      okResponse(200, {
        items: [
          { startsAt: "2026-11-25T09:00:00+03:00", endsAt: "2026-11-25T09:15:00+03:00" },
          { startsAt: "2026-12-01T09:00:00+03:00", endsAt: "2026-12-01T09:15:00+03:00" },
          { startsAt: "2026-12-08T09:00:00+03:00", endsAt: "2026-12-08T09:15:00+03:00" },
        ],
      }),
    ],
  })

  renderSlotsPage()
  await screen.findByRole("heading", { name: "Среда, 25 ноября" })

  // По умолчанию показан месяц первого доступного дня.
  expect(screen.getByText("ноябрь 2026")).toBeInTheDocument()
  expect(
    screen.getByRole("button", { name: "Перейти к предыдущему месяцу" }),
  ).toHaveAttribute("aria-disabled", "true")
  expect(
    screen.getByRole("button", { name: "Перейти к следующему месяцу" }),
  ).not.toHaveAttribute("aria-disabled")

  // react-day-picker пересоздаёт кнопки навигации при смене месяца —
  // запрашиваем их заново после клика.
  fireEvent.click(screen.getByRole("button", { name: "Перейти к следующему месяцу" }))
  expect(screen.getByText("декабрь 2026")).toBeInTheDocument()
  // Дальше декабря навигация не идёт: Окно записи кончилось.
  expect(
    screen.getByRole("button", { name: "Перейти к следующему месяцу" }),
  ).toHaveAttribute("aria-disabled", "true")
  expect(
    screen.getByRole("button", { name: "Перейти к предыдущему месяцу" }),
  ).not.toHaveAttribute("aria-disabled")

  fireEvent.click(screen.getByRole("button", { name: "Перейти к предыдущему месяцу" }))
  expect(screen.getByText("ноябрь 2026")).toBeInTheDocument()
})

test("клик по другому Слоту или дню заменяет выбор", async () => {
  mockGet({
    slots: [
      okResponse(200, {
        items: [
          { startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:30:00+03:00" },
          { startsAt: "2026-11-05T09:30:00+03:00", endsAt: "2026-11-05T10:00:00+03:00" },
          { startsAt: "2026-11-06T10:00:00+03:00", endsAt: "2026-11-06T10:30:00+03:00" },
        ],
      }),
    ],
  })

  const { container } = renderSlotsPage()
  await screen.findByRole("heading", { name: "Четверг, 5 ноября" })

  // Первый выбор: 09:00.
  fireEvent.click(screen.getByRole("button", { name: "09:00 (+03:00)" }))
  expect(screen.getByRole("button", { name: "09:00 (+03:00)" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )

  // Клик по другому времени того же дня заменяет выбор: сводка
  // обновляется на новый интервал.
  fireEvent.click(screen.getByRole("button", { name: "09:30 (+03:00)" }))
  expect(screen.getByRole("button", { name: "09:30 (+03:00)" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  expect(screen.getByRole("button", { name: "09:00 (+03:00)" })).toHaveAttribute(
    "aria-pressed",
    "false",
  )
  expect(screen.getByTestId("booking-summary")).toHaveTextContent(
    "09:30 (+03:00) – 10:00 (+03:00)",
  )

  // Клик по другому дню тоже заменяет выбор: Слот сброшен, форма
  // снова неактивна, сводка — подсказка. Форма при этом не исчезает.
  fireEvent.click(dayButton(container, "2026-11-06"))
  expect(screen.getByRole("heading", { name: "Пятница, 6 ноября" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "10:00 (+03:00)" })).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "09:00 (+03:00)" }),
  ).not.toBeInTheDocument()
  expect(screen.getByTestId("booking-summary")).toHaveTextContent("Слот не выбран")
  expect(screen.getByLabelText("Имя")).toBeDisabled()
  expect(screen.getByRole("button", { name: "Записаться" })).toBeDisabled()

  // Возврат к первому дню: Слоты на месте, выбора нет.
  fireEvent.click(dayButton(container, "2026-11-05"))
  expect(screen.getByRole("button", { name: "09:00 (+03:00)" })).toHaveAttribute(
    "aria-pressed",
    "false",
  )
})

test("конфликт, опустошивший выбранный день, переключает на первый доступный", async () => {
  mockGet({
    slots: [
      okResponse(200, {
        items: [
          { startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:15:00+03:00" },
          { startsAt: "2026-11-06T10:30:00+03:00", endsAt: "2026-11-06T10:45:00+03:00" },
        ],
      }),
      // После конфликта день 6 ноября разобрали целиком: в Окне
      // остался только первый день.
      okResponse(200, {
        items: [{ startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:15:00+03:00" }],
      }),
    ],
  })
  mockConflict409()
  const { container } = renderSlotsPage()

  // Гость явно выбрал день 6 ноября в календаре (не автовыбор).
  await screen.findByRole("heading", { name: "Четверг, 5 ноября" })
  fireEvent.click(dayButton(container, "2026-11-06"))
  fireEvent.click(await screen.findByRole("button", { name: "10:30 (+03:00)" }))
  submitBookingForm()

  // Опустевший день исчез из списка — активным становится первый
  // доступный: колонка Слотов и отметка в календаре переключились.
  expect(await screen.findByRole("heading", { name: "Четверг, 5 ноября" })).toBeInTheDocument()
  expect(screen.getByRole("gridcell", { selected: true })).toHaveAttribute(
    "data-day",
    "2026-11-05",
  )
  // Опустевший день помечен недоступным в календаре, первый — доступен.
  expect(dayCell(container, "2026-11-06")).toHaveAttribute("data-disabled", "true")
  expect(dayCell(container, "2026-11-05")).not.toHaveAttribute("data-disabled")
  // Слот занятого дня больше не показывается, выбор сброшен.
  expect(screen.queryByRole("button", { name: "10:30 (+03:00)" })).not.toBeInTheDocument()
  expect(screen.getByTestId("booking-summary")).toHaveTextContent("Слот не выбран")
  // Сообщение конфликта остаётся видимым в колонке формы.
  const formColumn = screen.getByRole("region", { name: "Запись на Слот" })
  expect(await within(formColumn).findByRole("alert")).toHaveTextContent("уже занято")
})

test("конфликт, опустошивший всё Окно: сообщение остаётся, экран не падает", async () => {
  mockGet({
    slots: [
      okResponse(200, {
        items: [{ startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:15:00+03:00" }],
      }),
      // Конфликт забрал последний Слот Окна — свободных дней нет.
      okResponse(200, { items: [] }),
    ],
  })
  mockConflict409()
  renderSlotsPage()

  fireEvent.click(await screen.findByRole("button", { name: "09:00 (+03:00)" }))
  submitBookingForm()

  // Экран не падает: пустое состояние Окна без Слотов…
  expect(await screen.findByText("Свободных Слотов нет.")).toBeInTheDocument()
  // …но Гость по-прежнему видит, что произошло: сообщение конфликта
  // не теряется вместе с колонками.
  expect(await screen.findByRole("alert")).toHaveTextContent("уже занято")
})

test("после конфликта календарь листается к месяцу автовыбранного дня", async () => {
  mockGet({
    slots: [
      okResponse(200, {
        items: [
          { startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:15:00+03:00" },
          { startsAt: "2026-11-06T10:30:00+03:00", endsAt: "2026-11-06T10:45:00+03:00" },
          { startsAt: "2026-12-01T11:00:00+03:00", endsAt: "2026-12-01T11:15:00+03:00" },
        ],
      }),
      // День 6 ноября опустел после конфликта: остались 5 ноября
      // и 1 декабря.
      okResponse(200, {
        items: [
          { startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:15:00+03:00" },
          { startsAt: "2026-12-01T11:00:00+03:00", endsAt: "2026-12-01T11:15:00+03:00" },
        ],
      }),
    ],
  })
  mockConflict409()
  const { container } = renderSlotsPage()

  // Гость выбрал день 6 ноября и листнул календарь в декабрь.
  await screen.findByRole("heading", { name: "Четверг, 5 ноября" })
  fireEvent.click(dayButton(container, "2026-11-06"))
  fireEvent.click(screen.getByRole("button", { name: "Перейти к следующему месяцу" }))
  expect(screen.getByText("декабрь 2026")).toBeInTheDocument()

  // Запись на Слот дня 6 ноября (колонка Слотов не зависит от
  // показанного месяца) упирается в конфликт.
  fireEvent.click(screen.getByRole("button", { name: "10:30 (+03:00)" }))
  submitBookingForm()

  // Автовыбор переключился на первый доступный день — и календарь
  // вернулся к месяцу этого дня, а не остался в декабре.
  expect(await screen.findByRole("heading", { name: "Четверг, 5 ноября" })).toBeInTheDocument()
  expect(screen.getByText("ноябрь 2026")).toBeInTheDocument()
  expect(screen.getByRole("gridcell", { selected: true })).toHaveAttribute(
    "data-day",
    "2026-11-05",
  )
  expect(dayCell(container, "2026-11-06")).toHaveAttribute("data-disabled", "true")
})

test("«Записаться ещё раз» перезагружает Слоты и автовыбирает первый доступный день", async () => {
  const get = mockGet({
    slots: [
      okResponse(200, {
        items: [
          { startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:15:00+03:00" },
          { startsAt: "2026-11-06T10:30:00+03:00", endsAt: "2026-11-06T10:45:00+03:00" },
        ],
      }),
      // Запись Гостя заняла Слот дня 6 ноября: после «ещё раз» в
      // Окне остался только первый день.
      okResponse(200, {
        items: [{ startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:15:00+03:00" }],
      }),
    ],
  })
  mockBookingCreated("2026-11-06T10:30:00+03:00", "2026-11-06T10:45:00+03:00")
  const { container } = renderSlotsPage()

  // Гость записался на Слот дня 6 ноября — день выбран явно кликом.
  await screen.findByRole("heading", { name: "Четверг, 5 ноября" })
  fireEvent.click(dayButton(container, "2026-11-06"))
  fireEvent.click(screen.getByRole("button", { name: "10:30 (+03:00)" }))
  submitBookingForm()
  expect(
    await screen.findByRole("heading", { name: "Запись подтверждена" }),
  ).toBeInTheDocument()

  // Возврат к календарю: Слоты перезагружены, день Записи опустел —
  // активен первый доступный, выбора нет.
  fireEvent.click(screen.getByRole("button", { name: "Записаться ещё раз" }))
  expect(await screen.findByRole("heading", { name: "Четверг, 5 ноября" })).toBeInTheDocument()
  expect(screen.getByRole("gridcell", { selected: true })).toHaveAttribute(
    "data-day",
    "2026-11-05",
  )
  expect(dayCell(container, "2026-11-06")).toHaveAttribute("data-disabled", "true")
  expect(screen.getByTestId("booking-summary")).toHaveTextContent("Слот не выбран")
  // Три GET: список Типов звонка + Слоты до Записи и после «ещё раз».
  await waitFor(() => expect(get).toHaveBeenCalledTimes(3))
})

test("«Записаться ещё раз» при опустевшем Окне показывает пустое состояние", async () => {
  mockGet({
    slots: [
      okResponse(200, {
        items: [{ startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:15:00+03:00" }],
      }),
      // Запись Гостя забрала последний Слот Окна.
      okResponse(200, { items: [] }),
    ],
  })
  mockBookingCreated("2026-11-05T09:00:00+03:00", "2026-11-05T09:15:00+03:00")
  renderSlotsPage()

  fireEvent.click(await screen.findByRole("button", { name: "09:00 (+03:00)" }))
  submitBookingForm()
  fireEvent.click(await screen.findByRole("button", { name: "Записаться ещё раз" }))

  // Экран не падает: Окно пусто, Гость видит пустое состояние.
  expect(await screen.findByText("Свободных Слотов нет.")).toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "Свободные Слоты" })).toBeInTheDocument()
})

test("неизвестный тип звонка — понятное сообщение и путь назад", async () => {
  // Список Типов звонка отвечает успешно и знает «intro», но 404
  // Слотов важнее: экран «не найден» целиком заменяет шапку.
  mockGet({
    slots: [
      errorResponse(404, {
        code: "call_type_not_found",
        message: "Тип звонка не найден",
      }),
    ],
    callTypes: okResponse(200, {
      items: [
        { id: "intro", name: "Интро-звонок", description: "Знакомство", durationMinutes: 15 },
      ],
    }),
  })

  renderSlotsPage()

  expect(
    await screen.findByRole("heading", { name: "Тип звонка не найден" }),
  ).toBeInTheDocument()
  expect(screen.queryByText("Интро-звонок · 15 минут")).not.toBeInTheDocument()
  expect(screen.getByRole("link", { name: "К списку типов звонков" })).toHaveAttribute(
    "href",
    "/",
  )
})

test("форма Записи видна всегда, но до выбора Слота неактивна", async () => {
  mockGet({
    slots: [
      okResponse(200, {
        items: [
          { startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:30:00+03:00" },
          { startsAt: "2026-11-05T09:30:00+03:00", endsAt: "2026-11-05T10:00:00+03:00" },
        ],
      }),
    ],
  })

  renderSlotsPage()
  await screen.findByRole("heading", { name: "Четверг, 5 ноября" })

  // Колонка Записи и форма видны с первого взгляда...
  expect(screen.getByLabelText("Имя")).toBeInTheDocument()
  expect(screen.getByLabelText("Контакт")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Записаться" })).toBeInTheDocument()
  // ...но поля и кнопка неактивны, пока Гость не выбрал Слот.
  expect(screen.getByLabelText("Имя")).toBeDisabled()
  expect(screen.getByLabelText("Контакт")).toBeDisabled()
  expect(screen.getByRole("button", { name: "Записаться" })).toBeDisabled()
  // Сводки выбора ещё нет: вместо неё подсказка.
  expect(screen.getByText("Слот не выбран")).toBeInTheDocument()
  // Кнопки сброса выбора нет: выбор заменяется кликом по другому времени.
  expect(
    screen.queryByRole("button", { name: "Выбрать другое время" }),
  ).not.toBeInTheDocument()
})

test("выбор Слота активирует форму и показывает сводку выбора", async () => {
  mockGet({
    slots: [
      okResponse(200, {
        items: [
          { startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:30:00+03:00" },
        ],
      }),
    ],
  })

  renderSlotsPage()
  await screen.findByRole("heading", { name: "Четверг, 5 ноября" })

  fireEvent.click(screen.getByRole("button", { name: "09:00 (+03:00)" }))

  // Форма активируется выбором Слота.
  expect(screen.getByLabelText("Имя")).toBeEnabled()
  expect(screen.getByLabelText("Контакт")).toBeEnabled()
  expect(screen.getByRole("button", { name: "Записаться" })).toBeEnabled()

  // Сводка выбора: дата, интервал с явными смещениями, длительность
  // из границ Слота (без запросов).
  const summary = screen.getByTestId("booking-summary")
  expect(summary).toHaveTextContent("Четверг, 5 ноября")
  expect(summary).toHaveTextContent("09:00 (+03:00) – 09:30 (+03:00)")
  expect(summary).toHaveTextContent("30 минут")
})

test("гость записывается на Слот и видит подтверждение с деталями Записи", async () => {
  mockGet({
    slots: [
      okResponse(200, {
        items: [
          { startsAt: "2026-11-05T10:00:00+03:00", endsAt: "2026-11-05T10:15:00+03:00" },
        ],
      }),
    ],
  })
  const post = vi.spyOn(client, "post").mockResolvedValue(
    okResponse(201, {
      callTypeId: "intro",
      callTypeName: "Интро-звонок",
      durationMinutes: 15,
      startsAt: "2026-11-05T10:00:00+03:00",
      endsAt: "2026-11-05T10:15:00+03:00",
      guestName: "Миша",
      guestContact: "guest@example.com",
    }) as never,
  )

  renderSlotsPage()

  fireEvent.click(await screen.findByRole("button", { name: "10:00 (+03:00)" }))
  fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Миша" } })
  fireEvent.change(screen.getByLabelText("Контакт"), {
    target: { value: "guest@example.com" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Записаться" }))

  expect(
    await screen.findByRole("heading", { name: "Запись подтверждена" }),
  ).toBeInTheDocument()
  expect(screen.getByText("Интро-звонок")).toBeInTheDocument()
  expect(screen.getByText("Четверг, 5 ноября")).toBeInTheDocument()
  expect(screen.getByText("10:00 (+03:00) – 10:15 (+03:00)")).toBeInTheDocument()
  expect(screen.getByText("15 минут")).toBeInTheDocument()
  expect(screen.getByText("Миша")).toBeInTheDocument()
  expect(screen.getByText("guest@example.com")).toBeInTheDocument()
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/calls",
        body: {
          callTypeId: "intro",
          startsAt: "2026-11-05T10:00:00+03:00",
          guestName: "Миша",
          guestContact: "guest@example.com",
        },
      }),
    ),
  )
})

test("конфликт занятости: понятное сообщение и занятый Слот исчезает из списка", async () => {
  const get = mockGet({
    slots: [
      okResponse(200, {
        items: [
          { startsAt: "2026-11-05T10:00:00+03:00", endsAt: "2026-11-05T10:15:00+03:00" },
          { startsAt: "2026-11-05T10:15:00+03:00", endsAt: "2026-11-05T10:30:00+03:00" },
        ],
      }),
      // Повторная загрузка после конфликта: занятый Слот уже вырезан.
      okResponse(200, {
        items: [
          { startsAt: "2026-11-05T10:15:00+03:00", endsAt: "2026-11-05T10:30:00+03:00" },
        ],
      }),
    ],
  })
  vi.spyOn(client, "post").mockResolvedValueOnce(
    errorResponse(409, {
      code: "slot_taken",
      message: "Это время уже занято другой Записью — выберите другой Слот",
    }) as never,
  )

  renderSlotsPage()

  fireEvent.click(await screen.findByRole("button", { name: "10:00 (+03:00)" }))
  fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Миша" } })
  fireEvent.change(screen.getByLabelText("Контакт"), {
    target: { value: "guest@example.com" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Записаться" }))

  // Сообщение о конфликте — в колонке формы Записи.
  const formColumn = screen.getByRole("region", { name: "Запись на Слот" })
  expect(await within(formColumn).findByRole("alert")).toHaveTextContent("уже занято")

  // Выбор сброшен: форма снова неактивна, сводка — подсказка.
  expect(screen.getByLabelText("Имя")).toBeDisabled()
  expect(screen.getByLabelText("Контакт")).toBeDisabled()
  expect(screen.getByRole("button", { name: "Записаться" })).toBeDisabled()
  expect(screen.getByTestId("booking-summary")).toHaveTextContent("Слот не выбран")

  // Список обновился: занятый Слот исчез, соседний остался.
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "10:00 (+03:00)" }),
    ).not.toBeInTheDocument(),
  )
  expect(screen.getByRole("button", { name: "10:15 (+03:00)" })).toBeInTheDocument()
  // Три GET: список Типов звонка + две загрузки Слотов (до конфликта
  // и после).
  await waitFor(() => expect(get).toHaveBeenCalledTimes(3))
})
