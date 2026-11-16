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

// Оболочка Панели владельца: слева меню, справа выбранная страница.
// Проверяем навигацию в отрыве от содержимого страниц (их тесты —
// в call-types.test.tsx и upcoming.test.tsx).

test("панель владельца: меню и страница Типов звонков по умолчанию", async () => {
  vi.spyOn(client, "get").mockResolvedValue(
    okResponse(200, { items: [] }) as never,
  )

  renderAppAt("/admin")

  expect(screen.getByText("Панель владельца")).toBeInTheDocument()
  const callTypes = screen.getByRole("link", { name: "Типы звонков" })
  expect(callTypes).toHaveAttribute("href", "/admin")
  expect(callTypes).toHaveAttribute("aria-current", "page")
  expect(screen.getByRole("link", { name: "Предстоящие" })).toHaveAttribute(
    "href",
    "/admin/upcoming",
  )
  expect(screen.getByRole("link", { name: "На главную" })).toHaveAttribute(
    "href",
    "/",
  )
  expect(
    await screen.findByRole("heading", { name: "Типы звонков" }),
  ).toBeInTheDocument()
})

test("меню переключает страницы: активный пункт подсвечивается", async () => {
  vi.spyOn(client, "get").mockResolvedValue(
    okResponse(200, { items: [] }) as never,
  )

  renderAppAt("/admin")

  fireEvent.click(screen.getByRole("link", { name: "Предстоящие" }))

  expect(
    await screen.findByRole("heading", { name: "Предстоящие" }),
  ).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Предстоящие" })).toHaveAttribute(
    "aria-current",
    "page",
  )
  expect(
    screen.getByRole("link", { name: "Типы звонков" }),
  ).not.toHaveAttribute("aria-current")
})
