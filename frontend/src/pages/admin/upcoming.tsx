import { Link } from "react-router"

import { formatDayLabel, formatSlotTime } from "@/lib/slots"
import { useUpcoming } from "@/lib/upcoming"

// Upcoming — страница Владельца «Предстоящие»: активные Записи всех
// Типов звонков одним списком по возрастанию начала (предзаданный
// профиль, без входа). У каждой — тип, время с явным смещением и
// данные Гостя.
export function Upcoming() {
  const { items, error } = useUpcoming()

  return (
    <div className="flex min-h-svh justify-center p-6">
      <div className="flex w-full max-w-xl flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-medium">Предстоящие</h1>
          <p className="text-muted-foreground text-sm">
            Записи всех типов звонков одним списком — по времени начала.
            Время указано со смещением часового пояса инстанса.
          </p>
          <Link
            to="/admin"
            className="text-muted-foreground underline-offset-4 text-sm hover:underline"
          >
            ← Типы звонков
          </Link>
        </header>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        {items.length === 0 && !error ? (
          <p className="text-muted-foreground text-sm">
            Предстоящих Записей нет.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((call) => (
              <li
                key={`${call.callTypeId}-${call.startsAt}`}
                className="flex flex-col gap-1 rounded-lg border p-4"
                data-testid="upcoming-call"
              >
                <p className="font-medium">
                  {call.callTypeName} — {call.durationMinutes} минут
                </p>
                <p className="text-sm tabular-nums">
                  {formatDayLabel(call.startsAt.slice(0, 10))},{" "}
                  {formatSlotTime(call.startsAt)} – {formatSlotTime(call.endsAt)}
                </p>
                <p className="text-muted-foreground text-sm">
                  {call.guestName}, {call.guestContact}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
