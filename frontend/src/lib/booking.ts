import { createCall } from "@/api/sdk.gen"
import type { Call } from "@/api/types.gen"

export type BookingDraft = {
  callTypeId: string
  startsAt: string
  guestName: string
  guestContact: string
}

export type BookingResult =
  | { ok: true; call: Call }
  | { ok: false; message: string }

const BOOKING_ERROR = "Не удалось создать Запись"

// bookCall — создание Записи Гостём на выбранный Слот. 201 — детали
// Записи для экрана подтверждения; ошибки контракта (409 конфликт
// занятости, 422 валидация) — понятным сообщением из ErrorBody.
export async function bookCall(draft: BookingDraft): Promise<BookingResult> {
  let result: Awaited<ReturnType<typeof createCall>>
  try {
    result = await createCall({ body: draft })
  } catch {
    return { ok: false, message: BOOKING_ERROR }
  }

  const { data, error } = result
  if (error || !data) {
    return { ok: false, message: error?.message ?? BOOKING_ERROR }
  }
  return { ok: true, call: data }
}
