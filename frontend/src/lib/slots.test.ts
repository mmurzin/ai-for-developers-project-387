import { expect, test } from "vitest"

import {
  availableDayKeys,
  calendarMonthRange,
  dateToDayKey,
  dayKeyToDate,
  firstAvailableDayKey,
  formatDayLabel,
  formatSlotTime,
  groupSlotsByDay,
  slotDurationMinutes,
} from "@/lib/slots"

const slot = (startsAt: string, endsAt: string) => ({ startsAt, endsAt })

test("groupSlotsByDay группирует Слоты по календарным дням, сохраняя порядок", () => {
  const slots = [
    slot("2026-11-05T09:00:00+03:00", "2026-11-05T09:15:00+03:00"),
    slot("2026-11-05T09:15:00+03:00", "2026-11-05T09:30:00+03:00"),
    slot("2026-11-06T09:00:00+03:00", "2026-11-06T09:15:00+03:00"),
  ]

  const days = groupSlotsByDay(slots)

  expect(days).toHaveLength(2)
  expect(days[0]?.key).toBe("2026-11-05")
  expect(days[0]?.slots).toHaveLength(2)
  expect(days[1]?.key).toBe("2026-11-06")
  expect(days[1]?.label).toBe("Пятница, 6 ноября")
})

test("groupSlotsByDay возвращает пустой список без Слотов", () => {
  expect(groupSlotsByDay([])).toEqual([])
})

// Дни недели — независимая истина (календарь), не вывод реализации:
// 7 ноября 2026 — суббота, 18 ноября — среда.
test("formatDayLabel подписывает день недели и месяц по-русски", () => {
  expect(formatDayLabel("2026-11-07")).toBe("Суббота, 7 ноября")
  expect(formatDayLabel("2026-11-18")).toBe("Среда, 18 ноября")
  expect(formatDayLabel("2026-12-31")).toBe("Четверг, 31 декабря")
})

test("formatSlotTime показывает время с явным смещением", () => {
  expect(formatSlotTime("2026-11-05T09:00:00+03:00")).toBe("09:00 (+03:00)")
  expect(formatSlotTime("2026-11-05T17:45:00+03:00")).toBe("17:45 (+03:00)")
})

// Длительность — из границ Слота (endsAt − startsAt), без запросов.
// Длительности Типов звонка — независимая истина: 15 и 30 минут сеются
// дефолтными Типами (#26); слот через полночь — 23:45…00:00 = 15 минут.
test("slotDurationMinutes считает минуты из границ Слота", () => {
  expect(slotDurationMinutes(slot("2026-11-05T09:00:00+03:00", "2026-11-05T09:30:00+03:00"))).toBe(30)
  expect(slotDurationMinutes(slot("2026-11-05T09:00:00+03:00", "2026-11-05T09:15:00+03:00"))).toBe(15)
  expect(slotDurationMinutes(slot("2026-11-05T23:45:00+03:00", "2026-11-06T00:00:00+03:00"))).toBe(15)
})

// Доступность дня для календаря: день есть в списке Слотов = доступен.
test("availableDayKeys собирает уникальные дни Слотов в календарном порядке", () => {
  const slots = [
    slot("2026-12-08T09:00:00+03:00", "2026-12-08T09:15:00+03:00"),
    slot("2026-11-30T09:00:00+03:00", "2026-11-30T09:15:00+03:00"),
    slot("2026-12-01T09:00:00+03:00", "2026-12-01T09:15:00+03:00"),
    slot("2026-12-01T09:15:00+03:00", "2026-12-01T09:30:00+03:00"),
  ]

  expect(availableDayKeys(slots)).toEqual(["2026-11-30", "2026-12-01", "2026-12-08"])
})

test("availableDayKeys без Слотов — пустой список", () => {
  expect(availableDayKeys([])).toEqual([])
})

test("firstAvailableDayKey — первый из доступных дней, без Слотов — undefined", () => {
  const slots = [
    slot("2026-12-08T09:00:00+03:00", "2026-12-08T09:15:00+03:00"),
    slot("2026-11-30T09:00:00+03:00", "2026-11-30T09:15:00+03:00"),
  ]

  expect(firstAvailableDayKey(slots)).toBe("2026-11-30")
  expect(firstAvailableDayKey([])).toBeUndefined()
})

// windowSlots — по одному Слоту на каждый из `days` дней начиная с
// ключа `startKey`: имитация посева Окна записи без привязки к «сегодня».
function windowSlots(startKey: string, days: number) {
  const start = dayKeyToDate(startKey)
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(start)
    date.setDate(date.getDate() + i)
    const key = dateToDayKey(date)
    return slot(`${key}T09:00:00+03:00`, `${key}T09:30:00+03:00`)
  })
}

// Окно записи — всегда 14 календарных дней и может лечь на два
// месяца. Независимая истина: в ноябре 30 дней, значит Окно
// 2026-11-18..2026-12-01 — это 13 дней ноября (18…30) плюс 1 декабря.
// Даты фиксированы явно: хелперы «сегодня» не знают.
test("availableDayKeys даёт 14 дней Окна, пересекающего границу месяцев", () => {
  const keys = availableDayKeys(windowSlots("2026-11-18", 14))

  expect(keys).toHaveLength(14)
  expect(keys[0]).toBe("2026-11-18")
  expect(keys[13]).toBe("2026-12-01")
})

// То же Окно в календарных границах: навигация заперта в ноябре–декабре.
// Вход подан в обратном порядке — порядок не является частью контракта.
test("calendarMonthRange Окна через границу месяцев — ноябрь и декабрь", () => {
  const keys = availableDayKeys(windowSlots("2026-11-18", 14)).reverse()

  expect(calendarMonthRange(keys)).toEqual({
    startMonth: dayKeyToDate("2026-11-01"),
    endMonth: dayKeyToDate("2026-12-31"),
  })
})

// Ключ дня «YYYY-MM-DD» — календарная дата в зоне инстанса. Дата для
// календаря собирается из компонент ключа (не из new Date(строка):
// дата-строки парсятся как UTC-полночь и сдвигают день в другой зоне).
// Границы месяца и года — самые уязвимые места.
test("dayKeyToDate и dateToDayKey — взаимно однозначные преобразования", () => {
  for (const key of ["2026-11-05", "2026-12-31", "2027-01-01", "2026-03-01"]) {
    expect(dateToDayKey(dayKeyToDate(key))).toBe(key)
  }
})

test("calendarMonthRange возвращает undefined без дней", () => {
  expect(calendarMonthRange([])).toBeUndefined()
})

// Окно записи целиком в одном месяце: навигация заперта в нём.
test("calendarMonthRange в одном месяце — от первого до последнего числа", () => {
  expect(calendarMonthRange(["2026-11-11", "2026-11-18", "2026-11-24"])).toEqual({
    startMonth: dayKeyToDate("2026-11-01"),
    endMonth: dayKeyToDate("2026-11-30"),
  })
})

// Окно записи пересекает границу месяцев — максимум два месяца навигации.
test("calendarMonthRange через границу месяцев — два месяца", () => {
  expect(calendarMonthRange(["2026-11-25", "2026-12-08"])).toEqual({
    startMonth: dayKeyToDate("2026-11-01"),
    endMonth: dayKeyToDate("2026-12-31"),
  })
})

// Границы — min/max по самим ключам, а не первый/последний элемент:
// день с меньшим ключом может прийти позже (группировка сохраняет
// порядок ответа, сортировка — забота самой функции). «YYYY-MM-DD»
// сравнивается лексикографически как календарная дата.
// 18..30 ноября = 13 дней + 1 декабря: границы — ноябрь и декабрь.
test("calendarMonthRange не зависит от порядка дней на входе", () => {
  expect(calendarMonthRange(["2026-12-01", "2026-11-18", "2026-11-30"])).toEqual({
    startMonth: dayKeyToDate("2026-11-01"),
    endMonth: dayKeyToDate("2026-12-31"),
  })
})
