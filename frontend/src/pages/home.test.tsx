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

function renderHome() {
  return render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  )
}

test("гость видит Типы звонков с названием, описанием и длительностью", async () => {
  vi.spyOn(client, "get").mockResolvedValue(
    okResponse(200, {
      items: [
        {
          id: "intro",
          name: "Интро-звонок",
          description: "Знакомство",
          durationMinutes: 15,
        },
        {
          id: "deep-dive",
          name: "Разбор",
          description: "Глубокий разбор",
          durationMinutes: 60,
        },
      ],
    }) as never,
  )

  renderHome()

  const intro = await screen.findByRole("link", { name: "Интро-звонок — 15 минут" })
  expect(intro).toHaveAttribute("href", "/call-types/intro")
  expect(screen.getByText("Знакомство")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Разбор — 60 минут" })).toHaveAttribute(
    "href",
    "/call-types/deep-dive",
  )
})

test("с главной есть ссылка на админку", async () => {
  vi.spyOn(client, "get").mockResolvedValue(okResponse(200, { items: [] }) as never)

  renderHome()

  expect(screen.getByRole("link", { name: "Управление типами звонков" })).toHaveAttribute(
    "href",
    "/admin",
  )
})

test("ошибка загрузки типов показывается гостю", async () => {
  vi.spyOn(client, "get").mockResolvedValue(
    ({
      data: undefined,
      error: { message: "бой" },
      request: {} as Request,
      response: new Response("{}", { status: 500 }),
    }) as never,
  )

  renderHome()

  expect(await screen.findByRole("alert")).toBeInTheDocument()
})
