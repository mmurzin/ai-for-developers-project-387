import { useEffect, useState } from "react"

import { listCalls } from "@/api/sdk.gen"
import type { Call } from "@/api/types.gen"

const LOAD_ERROR = "Не удалось загрузить предстоящие Записи"

// useUpcoming — предстоящие Записи всех Типов звонков одним списком
// (страница Владельца, без входа) через сгенерированный hey-api клиент.
// API отдаёт их по возрастанию начала; время — ISO со смещением.
export function useUpcoming() {
  const [items, setItems] = useState<Call[]>([])
  const [error, setError] = useState<string | undefined>(undefined)

  // setState — только в .then/.catch-колбэках, не в теле эффекта
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false
    listCalls({ query: { range: "upcoming" } }).then(
      ({ data }) => {
        if (cancelled) {
          return
        }
        if (!data) {
          setError(LOAD_ERROR)
          return
        }
        setError(undefined)
        setItems(data.items ?? [])
      },
      () => {
        if (!cancelled) {
          setError(LOAD_ERROR)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  return { items, error }
}
