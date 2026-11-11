// Даты Окна записи для браузерных сценариев: Окно — всегда 14
// календарных дней со следующего дня, включая выходные. Сценарии
// вычисляют ожидания от текущей даты, чтобы работать в любой день
// запуска, включая переход через границу месяцев.

export const BOOKING_WINDOW_DAYS = 14

export function addDays(base: Date, days: number): Date {
  const date = new Date(base)
  date.setDate(date.getDate() + days)
  return date
}

// Ключ дня «YYYY-MM-DD» в локальной зоне — тот же формат, каким
// react-day-picker помечает ячейку сетки (td[data-day]).
// Зеркало dateToDayKey из frontend/src/lib/slots.ts: общий модуль
// невозможен (e2e живёт без package.json) — менять только парой.
export function dayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

// Первый доступный день Окна: завтра — с этого дня сервер сеет Слоты.
export function firstWindowDay(): Date {
  return addDays(new Date(), 1)
}

// Сколько дней Окна попадает в месяц первого доступного дня:
// столько доступных дней видно в календаре при открытии (показан
// месяц первого доступного дня; хвост Окна может уйти в следующий).
export function windowDaysInFirstMonth(): number {
  const first = firstWindowDay()
  const lastDayOfMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return Math.min(BOOKING_WINDOW_DAYS, lastDayOfMonth - first.getDate() + 1)
}
