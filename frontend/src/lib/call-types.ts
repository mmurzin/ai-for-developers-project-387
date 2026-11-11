import { useCallback, useEffect, useRef, useState } from "react"

import { createCallType, listCallTypes } from "@/api/sdk.gen"
import type { CallType } from "@/api/types.gen"

export type CallTypeDraft = {
  id: string
  name: string
  description: string
  durationMinutes: number
}

type UseCallTypes = {
  items: CallType[]
  error?: string
  create: (draft: CallTypeDraft) => Promise<boolean>
}

const LOAD_ERROR = "Не удалось загрузить список типов звонков"

type CallTypesResult =
  | { kind: "ok"; items: CallType[] }
  | { kind: "error"; message: string }

// fetchCallTypes — один запрос списка Типов звонков без состояния
// (идиома lib/slots.ts): и начальная загрузка, и обновление после
// создания используют одну логику разбора. Сбой запроса (сеть,
// ответ без тела) — тот же текст, что и пустой ответ.
async function fetchCallTypes(): Promise<CallTypesResult> {
  try {
    const { data } = await listCallTypes()
    if (!data) {
      return { kind: "error", message: LOAD_ERROR }
    }
    return { kind: "ok", items: data.items ?? [] }
  } catch {
    return { kind: "error", message: LOAD_ERROR }
  }
}

// useCallTypes — список и создание Типов звонков через сгенерированный
// hey-api клиент. Ошибки создания (409/422 + ErrorBody) показываются
// владельцу как есть.
export function useCallTypes(): UseCallTypes {
  const [items, setItems] = useState<CallType[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  // Счётчик запросов: применяется только результат последнего —
  // поздний ответ начальной загрузки не затирает ошибку создания.
  const latestRequest = useRef(0)

  const apply = useCallback((result: CallTypesResult) => {
    if (result.kind === "error") {
      setError(result.message)
      return
    }
    setError(undefined)
    setItems(result.items)
  }, [])

  // setState — только в .then-колбэках, не в теле эффекта
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false
    const request = ++latestRequest.current
    fetchCallTypes().then((result) => {
      if (!cancelled && latestRequest.current === request) {
        apply(result)
      }
    })
    return () => {
      cancelled = true
    }
  }, [apply])

  const create = useCallback(
    async (draft: CallTypeDraft) => {
      // Создание — более новый запрос, чем начальная загрузка:
      // его результат (ошибка или свежий список) главный.
      const request = ++latestRequest.current
      const { error } = await createCallType({ body: draft })
      if (error) {
        if (latestRequest.current === request) {
          setError(error.message)
        }
        return false
      }
      const result = await fetchCallTypes()
      if (latestRequest.current === request) {
        apply(result)
      }
      return true
    },
    [apply],
  )

  return { items, error, create }
}

// useCallType — Тип звонка по идентификатору из роута: отдельного
// эндпоинта «прочитать один» нет, публичный список Типов звонков уже
// им пользуется, поэтому поиск в нём. undefined — список ещё не
// загружен, запрос не удался или идентификатора в списке нет:
// вызывающий решает, что показывать (экран Слотов ждёт и ответ
// Слотов — консервативно без строки, пока нет обоих ответов).
// Сбой списка — принятая тихая деградация: строка шапки —
// вспомогательные данные, экран Слотов работает от собственного
// ответа и не падает; ошибку не прокидываем и не ретраим.
export function useCallType(callTypeId: string): CallType | undefined {
  const [callType, setCallType] = useState<CallType | undefined>(undefined)

  // setState — только в .then-колбэках, не в теле эффекта
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false
    fetchCallTypes().then((result) => {
      if (!cancelled && result.kind === "ok") {
        setCallType(result.items.find((item) => item.id === callTypeId))
      }
    })
    return () => {
      cancelled = true
    }
  }, [callTypeId])

  return callType
}
