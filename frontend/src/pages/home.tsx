import { Link } from "react-router"

import { useCallTypes } from "@/lib/call-types"

// Home — гостевая главная: список Типов звонков (название, описание,
// длительность). Выбор типа ведёт на календарь его Слотов.
export function Home() {
  const { items, error } = useCallTypes()

  return (
    <div className="flex min-h-svh justify-center p-6">
      <div className="flex w-full max-w-xl flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-medium">Выберите тип звонка</h1>
          <p className="text-muted-foreground text-sm">
            Типы звонков, которые проводит Владелец страницы. Выберите
            один — откроется календарь свободных Слотов.
          </p>
        </header>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Пока нет ни одного типа звонка.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.id} className="rounded-lg border p-4">
                <Link
                  to={`/call-types/${item.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {item.name} — {item.durationMinutes} минут
                </Link>
                <p className="text-muted-foreground text-sm">{item.description}</p>
              </li>
            ))}
          </ul>
        )}

        <Link
          to="/admin"
          className="text-muted-foreground underline-offset-4 text-sm hover:underline"
        >
          Управление типами звонков
        </Link>
      </div>
    </div>
  )
}
