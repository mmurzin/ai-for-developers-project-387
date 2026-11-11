import { useCallback, useEffect, useState } from "react"

import { listSlots } from "@/api/sdk.gen"
import type { Slot } from "@/api/types.gen"

const LOAD_ERROR = "Не удалось загрузить Слоты"

type SlotsResult =
  | { kind: "ok"; items: Slot[] }
  | { kind: "error"; message: string; notFound: boolean }

// fetchSlots — один запрос Слотов без состояния: и начальная загрузка,
// и обновление после конфликта занятости используют одну логику разбора.
async function fetchSlots(callTypeId: string): Promise<SlotsResult> {
  try {
    const { data, error } = await listSlots({ path: { id: callTypeId } })
    if (error) {
      return {
        kind: "error",
        message: error.message,
        notFound: error.code === "call_type_not_found",
      }
    }
    return { kind: "ok", items: data?.items ?? [] }
  } catch {
    return { kind: "error", message: LOAD_ERROR, notFound: false }
  }
}

// useSlots — Слоты Типа звонка через сгенерированный hey-api клиент.
// 404 (тип не найден) отражается как notFound, остальные ошибки — текстом.
// loaded — успешный ответ Слотов уже применён (для шапки: строка Типа
// звонка появляется, только когда есть оба ответа). reload — повторная
// загрузка: после конфликта занятости занятый Слот должен исчезнуть
// из списка.
export function useSlots(callTypeId: string) {
  const [items, setItems] = useState<Slot[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [notFound, setNotFound] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const apply = useCallback((result: SlotsResult) => {
    if (result.kind === "error") {
      setNotFound(result.notFound)
      setError(result.message)
      return
    }
    setNotFound(false)
    setError(undefined)
    setItems(result.items)
    setLoaded(true)
  }, [])

  // setState — только в .then-колбэках, не в теле эффекта
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false
    fetchSlots(callTypeId).then((result) => {
      if (!cancelled) {
        apply(result)
      }
    })
    return () => {
      cancelled = true
    }
  }, [callTypeId, apply])

  const reload = useCallback(async () => {
    apply(await fetchSlots(callTypeId))
  }, [callTypeId, apply])

  return { items, error, notFound, loaded, reload }
}

export type DaySlots = {
  key: string
  label: string
  slots: Slot[]
}

// availableDayKeys — уникальные ключи дней («YYYY-MM-DD») из списка
// Слотов в календарном порядке. День есть в списке = день доступен
// в календаре; отдельных запросов доступность не требует.
export function availableDayKeys(slots: Slot[]): string[] {
  return Array.from(new Set(slots.map((slot) => slot.startsAt.slice(0, 10)))).sort()
}

// firstAvailableDayKey — ключ первого доступного дня: автовыбор при
// загрузке экрана. Без Слотов — undefined.
export function firstAvailableDayKey(slots: Slot[]): string | undefined {
  return availableDayKeys(slots)[0]
}

// dayKeyToDate — календарная дата из ключа дня «YYYY-MM-DD»: полночь
// локальной зоны, как ожидает react-day-picker (работает локальными
// геттерами). Компоненты даты собираем явно, не new Date(строка):
// дата-строки парсятся как UTC-полночь и сдвигают день в другой зоне.
export function dayKeyToDate(key: string): Date {
  const [year, month, day] = key.split("-").map(Number)
  return new Date(year, month - 1, day)
}

// dateToDayKey — ключ дня из даты календаря (локальные геттеры —
// зеркало dayKeyToDate). Зеркало dayKey из e2e/dates.ts: общий
// модуль невозможен (e2e живёт без package.json) — менять парой.
export function dateToDayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

// calendarMonthRange — границы навигации по месяцам: месяц первого
// доступного дня … месяц последнего. Окно записи занимает максимум
// два месяца, дальше календарь не листается. Порядок входа не важен:
// границы — min и max по самим ключам («YYYY-MM-DD» сравнивается
// лексикографически как календарная дата).
export function calendarMonthRange(dayKeys: string[]): {
  startMonth: Date
  endMonth: Date
} | undefined {
  if (dayKeys.length === 0) {
    return undefined
  }
  const sorted = [...dayKeys].sort()
  const first = dayKeyToDate(sorted[0]!)
  const last = dayKeyToDate(sorted[sorted.length - 1]!)
  return {
    startMonth: new Date(first.getFullYear(), first.getMonth(), 1),
    endMonth: new Date(last.getFullYear(), last.getMonth() + 1, 0),
  }
}

// slotDurationMinutes — длительность Слота в минутах из его границ
// (endsAt − startsAt), без дополнительных запросов. ISO-строки с любым
// смещением парсятся в моменты времени, разность от зоны не зависит.
export function slotDurationMinutes(slot: Slot): number {
  return (new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime()) / 60_000
}

// groupSlotsByDay группирует Слоты по календарным дням зоны инстанса:
// дата берётся из ISO-строки (первые 10 символов), порядок сохраняется.
export function groupSlotsByDay(slots: Slot[]): DaySlots[] {
  const groups = new Map<string, Slot[]>()
  for (const slot of slots) {
    const key = slot.startsAt.slice(0, 10)
    const existing = groups.get(key)
    if (existing) {
      existing.push(slot)
    } else {
      groups.set(key, [slot])
    }
  }
  return Array.from(groups, ([key, daySlots]) => ({
    key,
    label: formatDayLabel(key),
    slots: daySlots,
  }))
}

const WEEKDAYS = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
] as const

const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const

// formatDayLabel — «Суббота, 7 ноября» из ключа дня «YYYY-MM-DD»
// (календарная дата Слота в зоне инстанса). День недели считается
// по UTC-дате ключа: календарная дата от пояса не зависит.
export function formatDayLabel(key: string): string {
  const [year, month, day] = key.split("-").map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  return `${weekday}, ${day} ${MONTHS_GENITIVE[month - 1]}`
}

// formatSlotTime — время начала Слота с явным смещением: «09:00 (+03:00)».
export function formatSlotTime(iso: string): string {
  const time = iso.slice(11, 16)
  const offset = iso.slice(19)
  return offset ? `${time} (${offset})` : `${time} (UTC)`
}
