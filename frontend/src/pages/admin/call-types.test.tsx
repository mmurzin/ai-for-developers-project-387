import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { MemoryRouter } from "react-router"

import { App } from "@/App"
import { client } from "@/api/client.gen"

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <App />
    </MemoryRouter>,
  )
}

const okResponse = (status: number, body: unknown) => ({
  data: body,
  error: undefined,
  request: {} as Request,
  response: new Response(JSON.stringify(body), { status }),
})

const errorResponse = (status: number, body: unknown) => ({
  data: undefined,
  error: body,
  request: {} as Request,
  response: new Response(JSON.stringify(body), { status }),
})

afterEach(() => {
  vi.restoreAllMocks()
})

test("список типов звонков загружается на странице админки", async () => {
  vi.spyOn(client, "get").mockResolvedValue(
    okResponse(200, {
      items: [
        {
          id: "intro",
          name: "Интро-звонок",
          description: "Знакомство",
          durationMinutes: 15,
        },
      ],
    }) as never,
  )

  renderAdmin()

  expect(await screen.findByText(/Интро-звонок — 15 минут/)).toBeInTheDocument()
  expect(screen.getByText("Знакомство")).toBeInTheDocument()
})

test("владелец создаёт тип звонка и видит его в списке", async () => {
  const get = vi
    .spyOn(client, "get")
    .mockResolvedValueOnce(okResponse(200, { items: [] }) as never)
    .mockResolvedValueOnce(
      okResponse(200, {
        items: [
          {
            id: "deep-dive",
            name: "Разбор",
            description: "Глубокий разбор",
            durationMinutes: 60,
          },
        ],
      }) as never,
    )
  const post = vi
    .spyOn(client, "post")
    .mockResolvedValueOnce(
      okResponse(201, {
        id: "deep-dive",
        name: "Разбор",
        description: "Глубокий разбор",
        durationMinutes: 60,
      }) as never,
    )

  renderAdmin()

  fireEvent.change(screen.getByLabelText("Идентификатор"), {
    target: { value: "deep-dive" },
  })
  fireEvent.change(screen.getByLabelText("Название"), {
    target: { value: "Разбор" },
  })
  fireEvent.change(screen.getByLabelText("Описание"), {
    target: { value: "Глубокий разбор" },
  })
  fireEvent.change(screen.getByLabelText("Длительность (минуты)"), {
    target: { value: "60" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Создать" }))

  expect(await screen.findByText(/Разбор — 60 минут/)).toBeInTheDocument()
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/call-types",
        body: {
          id: "deep-dive",
          name: "Разбор",
          description: "Глубокий разбор",
          durationMinutes: 60,
        },
      }),
    ),
  )
  expect(get).toHaveBeenCalledTimes(2)
})

test("ошибка создания показывается владельцу", async () => {
  vi.spyOn(client, "get").mockResolvedValue(
    okResponse(200, { items: [] }) as never,
  )
  vi.spyOn(client, "post").mockResolvedValueOnce(
    errorResponse(409, {
      code: "duplicate_id",
      message: "Тип звонка с таким идентификатором уже существует",
    }) as never,
  )

  renderAdmin()

  fireEvent.change(screen.getByLabelText("Идентификатор"), {
    target: { value: "intro" },
  })
  fireEvent.change(screen.getByLabelText("Название"), {
    target: { value: "Интро-звонок" },
  })
  fireEvent.change(screen.getByLabelText("Описание"), {
    target: { value: "Знакомство" },
  })
  fireEvent.change(screen.getByLabelText("Длительность (минуты)"), {
    target: { value: "15" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Создать" }))

  expect(
    await screen.findByText("Тип звонка с таким идентификатором уже существует"),
  ).toBeInTheDocument()
})
