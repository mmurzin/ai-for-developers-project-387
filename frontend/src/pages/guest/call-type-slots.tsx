import { useState } from "react"
import { Link, useParams } from "react-router"
import { ru } from "react-day-picker/locale"

import type { Call, Slot } from "@/api/types.gen"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { bookCall } from "@/lib/booking"
import { useCallType } from "@/lib/call-types"
import {
  availableDayKeys,
  calendarMonthRange,
  dateToDayKey,
  dayKeyToDate,
  formatDayLabel,
  formatSlotTime,
  groupSlotsByDay,
  slotDurationMinutes,
  useSlots,
} from "@/lib/slots"

const EMPTY_FORM = {
  guestName: "",
  guestContact: "",
}

// CallTypeSlots — гостевая страница Слотов выбранного Типа звонка:
// три колонны «Календарь | Слоты выбранного дня | Запись» (ниже lg —
// вертикальная стопка в том же порядке). Сетка вычислена API (Окно
// записи, Рабочие часы), время — с явным смещением часового пояса.
// В шапке — Название Типа звонка и длительность из списка Типов
// звонков (поиск по идентификатору роута); строка появляется, только
// когда есть оба ответа — Слотов и списка, чтобы не мигать перед
// экраном «не найден». Первый доступный день выбирается
// автоматически по единому правилу — загрузка, «Записаться ещё раз»
// и опустевший после конфликта день; в календаре недоступны дни вне
// Окна и дни без Слотов. Колонка Записи видна всегда: до выбора
// Слота поля неактивны, над формой — сводка выбора (дата, интервал,
// длительность из границ Слота). 201 — экран подтверждения, конфликт
// — понятное сообщение, остающееся видимым даже когда Окно опустело
// целиком, и свежий список Слотов без занятого.
export function CallTypeSlots() {
  const { id = "" } = useParams()
  const { items, error, notFound, loaded, reload } = useSlots(id)
  const callType = useCallType(id)

  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null)
  const [monthOverride, setMonthOverride] = useState<Date | null>(null)
  const [selected, setSelected] = useState<Slot | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [bookingError, setBookingError] = useState<string | undefined>(undefined)
  const [confirmed, setConfirmed] = useState<Call | null>(null)

  if (notFound) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <div className="flex w-full max-w-md flex-col gap-4">
          <h1 className="text-2xl font-medium">Тип звонка не найден</h1>
          <p className="text-muted-foreground text-sm">
            Возможно, Владелец страницы его удалил.
          </p>
          <Link
            to="/"
            className="text-muted-foreground underline-offset-4 text-sm hover:underline"
          >
            К списку типов звонков
          </Link>
        </div>
      </div>
    )
  }

  const days = groupSlotsByDay(items)
  const dayKeys = availableDayKeys(items)
  const available = new Set(dayKeys)
  // Активный день выводится из списка — единое правило автовыбора
  // первого доступного дня: загрузка, «Записаться ещё раз» и
  // опустевший после конфликта день (выбранный ключ исчез из
  // списка — отображается первый доступный).
  const activeDayKey =
    selectedDayKey !== null && available.has(selectedDayKey)
      ? selectedDayKey
      : (dayKeys[0] ?? null)
  const activeDay = activeDayKey === null ? undefined : days.find((d) => d.key === activeDayKey)
  const months = calendarMonthRange(dayKeys)

  const pickSlot = (slot: Slot) => {
    setSelected(slot)
    setBookingError(undefined)
  }

  // Смена дня сбрасывает выбранный Слот: форма Записи привязана
  // к конкретному времени, другого дня его не видно.
  const pickDay = (date: Date) => {
    const key = dateToDayKey(date)
    if (!available.has(key) || key === activeDayKey) {
      return
    }
    setSelectedDayKey(key)
    setSelected(null)
    setBookingError(undefined)
  }

  const resetBooking = () => {
    setSelectedDayKey(null)
    setMonthOverride(null)
    setSelected(null)
    setForm(EMPTY_FORM)
    setBookingError(undefined)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) {
      return
    }

    const result = await bookCall({
      callTypeId: id,
      startsAt: selected.startsAt,
      guestName: form.guestName.trim(),
      guestContact: form.guestContact.trim(),
    })
    if (result.ok) {
      setConfirmed(result.call)
      return
    }

    // Конфликт (409): время занято кем-то другим. Показываем сообщение
    // и обновляем список — занятый Слот исчезает, выбор сбрасывается.
    // Месяц календаря возвращается к активному дню: если конфликт
    // опустошил выбранный день, активным станет первый доступный, и
    // автопереключение должно быть видно в календаре, даже если Гость
    // листал месяцы.
    setBookingError(result.message)
    setSelected(null)
    setMonthOverride(null)
    await reload()
  }

  // Сообщение последней неудачной Записи (конфликт занятости) — один
  // рендер на обе точки показа: пустое состояние Окна и колонку
  // Записи (ветки взаимоисключающие, на экране — максимум один).
  const bookingErrorAlert = bookingError ? (
    <p role="alert" className="text-destructive text-sm">
      {bookingError}
    </p>
  ) : null

  if (confirmed) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <div className="flex w-full max-w-md flex-col gap-6">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-medium">Запись подтверждена</h1>
            <p className="text-muted-foreground text-sm">
              Владелец страницы свяжется с вами по указанному контакту.
            </p>
          </header>

          <dl
            className="flex flex-col gap-3 rounded-lg border p-6 text-sm"
            data-testid="booking-details"
          >
            <div className="flex justify-between gap-6">
              <dt className="text-muted-foreground">Тип звонка</dt>
              <dd className="font-medium">{confirmed.callTypeName}</dd>
            </div>
            <div className="flex justify-between gap-6">
              <dt className="text-muted-foreground">Дата</dt>
              <dd>{formatDayLabel(confirmed.startsAt.slice(0, 10))}</dd>
            </div>
            <div className="flex justify-between gap-6">
              <dt className="text-muted-foreground">Время</dt>
              <dd className="tabular-nums">
                {formatSlotTime(confirmed.startsAt)} – {formatSlotTime(confirmed.endsAt)}
              </dd>
            </div>
            <div className="flex justify-between gap-6">
              <dt className="text-muted-foreground">Длительность</dt>
              <dd>{confirmed.durationMinutes} минут</dd>
            </div>
            <div className="flex justify-between gap-6">
              <dt className="text-muted-foreground">Имя</dt>
              <dd>{confirmed.guestName}</dd>
            </div>
            <div className="flex justify-between gap-6">
              <dt className="text-muted-foreground">Контакт</dt>
              <dd>{confirmed.guestContact}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setConfirmed(null)
                resetBooking()
                void reload()
              }}
            >
              Записаться ещё раз
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/">К списку типов звонков</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh justify-center p-6">
      <div className="flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-medium">Свободные Слоты</h1>
          {callType && loaded ? (
            <p className="text-muted-foreground text-sm font-medium">
              {callType.name} · {callType.durationMinutes} минут
            </p>
          ) : null}
          <p className="text-muted-foreground text-sm">
            Время указано с явным смещением часового пояса инстанса.
            Выберите день и Слот, чтобы записаться.
          </p>
          <Link
            to="/"
            className="text-muted-foreground underline-offset-4 text-sm hover:underline"
          >
            ← К списку типов звонков
          </Link>
        </header>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        {days.length === 0 && !error ? (
          <div className="flex flex-col gap-2">
            {bookingErrorAlert}
            <p className="text-muted-foreground text-sm">Свободных Слотов нет.</p>
          </div>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[auto_minmax(240px,1fr)_minmax(320px,400px)]">
            <section
              aria-label="Календарь выбора дня"
              className="flex justify-center rounded-lg border p-3 lg:justify-start"
            >
              <Calendar
                mode="single"
                locale={ru}
                weekStartsOn={1}
                month={monthOverride ?? (activeDayKey ? dayKeyToDate(activeDayKey) : undefined)}
                onMonthChange={setMonthOverride}
                selected={activeDayKey ? dayKeyToDate(activeDayKey) : undefined}
                onSelect={(date) => {
                  if (date) {
                    pickDay(date)
                  }
                }}
                disabled={(date) => !available.has(dateToDayKey(date))}
                startMonth={months?.startMonth}
                endMonth={months?.endMonth}
                required
                autoFocus={false}
              />
            </section>

            <section
              aria-label="Слоты выбранного дня"
              className="flex min-w-0 flex-col gap-3"
            >
              <h2 className="text-lg font-medium">{activeDay?.label}</h2>
              <ul className="flex flex-wrap gap-2">
                {activeDay?.slots.map((slot) => {
                  const isSelected = selected?.startsAt === slot.startsAt
                  return (
                    <li key={slot.startsAt}>
                      <button
                        type="button"
                        onClick={() => pickSlot(slot)}
                        aria-pressed={isSelected}
                        className={`rounded-md border px-3 py-1.5 text-sm tabular-nums transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/10 font-medium"
                            : "hover:bg-muted"
                        }`}
                      >
                        {formatSlotTime(slot.startsAt)}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section
              className="flex flex-col gap-4 rounded-lg border p-6"
              aria-label="Запись на Слот"
            >
              <h2 className="text-lg font-medium">Запись на Слот</h2>

              {selected ? (
                <p className="text-sm" data-testid="booking-summary">
                  {formatDayLabel(selected.startsAt.slice(0, 10))},{" "}
                  {formatSlotTime(selected.startsAt)} – {formatSlotTime(selected.endsAt)} ·{" "}
                  {slotDurationMinutes(selected)} минут
                </p>
              ) : (
                <p className="text-muted-foreground text-sm" data-testid="booking-summary">
                  Слот не выбран
                </p>
              )}

              {bookingErrorAlert}

              <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="guest-name">Имя</Label>
                  <Input
                    id="guest-name"
                    value={form.guestName}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, guestName: event.target.value }))
                    }
                    placeholder="Как к вам обращаться"
                    required
                    disabled={!selected}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="guest-contact">Контакт</Label>
                  <Input
                    id="guest-contact"
                    value={form.guestContact}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, guestContact: event.target.value }))
                    }
                    placeholder="Email или телефон для связи"
                    required
                    disabled={!selected}
                  />
                </div>

                <Button type="submit" disabled={!selected}>
                  Записаться
                </Button>
              </form>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
