import { render, screen } from "@testing-library/react"
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

afterEach(() => {
  vi.restoreAllMocks()
})

function renderUpcoming() {
  return render(
    <MemoryRouter initialEntries={["/admin/upcoming"]}>
      <App />
    </MemoryRouter>,
  )
}

test("предстоящие Записи одним списком: тип, время со смещением, Гость", async () => {
  vi.spyOn(client, "get").mockResolvedValue(
    okResponse(200, {
      items: [
        {
          callTypeId: "intro",
          callTypeName: "Интро-звонок",
          durationMinutes: 15,
          startsAt: "2026-11-05T09:00:00+03:00",
          endsAt: "2026-11-05T09:15:00+03:00",
          guestName: "Миша",
          guestContact: "guest@example.com",
        },
        {
          callTypeId: "deep-dive",
          callTypeName: "Разбор",
          durationMinutes: 60,
          startsAt: "2026-11-06T15:00:00+03:00",
          endsAt: "2026-11-06T16:00:00+03:00",
          guestName: "Анна",
          guestContact: "anna@example.com",
        },
      ],
    }) as never,
  )

  renderUpcoming()

  expect(await screen.findByText(/Интро-звонок — 15 минут/)).toBeInTheDocument()
  expect(screen.getByText(/Разбор — 60 минут/)).toBeInTheDocument()

  const calls = screen.getAllByTestId("upcoming-call")
  expect(calls).toHaveLength(2)
  expect(calls[0]).toHaveTextContent("Четверг, 5 ноября")
  expect(calls[0]).toHaveTextContent("09:00 (+03:00) – 09:15 (+03:00)")
  expect(calls[0]).toHaveTextContent("Миша")
  expect(calls[0]).toHaveTextContent("guest@example.com")
  expect(calls[1]).toHaveTextContent("Пятница, 6 ноября")
  expect(calls[1]).toHaveTextContent("15:00 (+03:00) – 16:00 (+03:00)")
  expect(calls[1]).toHaveTextContent("Анна")
  expect(calls[1]).toHaveTextContent("anna@example.com")
})

test("пустой список предстоящих — валидное состояние", async () => {
  vi.spyOn(client, "get").mockResolvedValue(
    okResponse(200, { items: [] }) as never,
  )

  renderUpcoming()

  expect(await screen.findByText("Предстоящих Записей нет.")).toBeInTheDocument()
})

test("со страницы предстоящих есть путь к Типам звонков", async () => {
  vi.spyOn(client, "get").mockResolvedValue(
    okResponse(200, { items: [] }) as never,
  )

  renderUpcoming()

  expect(
    await screen.findByRole("link", { name: "← Типы звонков" }),
  ).toHaveAttribute("href", "/admin")
})
