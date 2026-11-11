import { fireEvent, render, screen } from "@testing-library/react"
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

// Мок различает ручки по URL: главная грузит список типов,
// страница типа — его Слоты.
const mockAPI = (types: unknown, slots: unknown) => {
  vi.spyOn(client, "get").mockImplementation(((options: { url?: string }) => {
    if (options?.url === "/api/call-types/{id}/slots") {
      return Promise.resolve(okResponse(200, slots))
    }
    return Promise.resolve(okResponse(200, types))
  }) as never)
}

afterEach(() => {
  vi.restoreAllMocks()
})

function renderAppAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

test("главная показывает Типы звонков гостю", async () => {
  mockAPI(
    {
      items: [
        { id: "intro", name: "Интро-звонок", description: "Знакомство", durationMinutes: 15 },
      ],
    },
    { items: [] },
  )

  renderAppAt("/")

  expect(
    await screen.findByRole("heading", { name: "Выберите тип звонка" }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole("link", { name: "Интро-звонок — 15 минут" }),
  ).toBeInTheDocument()
})

test("выбор типа открывает календарь Слотов", async () => {
  mockAPI(
    {
      items: [
        { id: "intro", name: "Интро-звонок", description: "Знакомство", durationMinutes: 15 },
      ],
    },
    {
      items: [
        { startsAt: "2026-11-05T09:00:00+03:00", endsAt: "2026-11-05T09:15:00+03:00" },
      ],
    },
  )

  renderAppAt("/")
  fireEvent.click(await screen.findByRole("link", { name: "Интро-звонок — 15 минут" }))

  expect(await screen.findByRole("heading", { name: "Свободные Слоты" })).toBeInTheDocument()
  expect(await screen.findByText("09:00 (+03:00)")).toBeInTheDocument()
})

test("неизвестный маршрут ведёт на главную", async () => {
  mockAPI({ items: [] }, { items: [] })

  renderAppAt("/booking/15")

  expect(
    await screen.findByRole("heading", { name: "Выберите тип звонка" }),
  ).toBeInTheDocument()
})
