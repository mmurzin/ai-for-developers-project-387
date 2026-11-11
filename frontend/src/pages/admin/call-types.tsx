import { useState } from "react"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useCallTypes } from "@/lib/call-types"

const EMPTY_FORM = {
  id: "",
  name: "",
  description: "",
  durationMinutes: "",
}

// CallTypes — админка Владельца страницы: создание Типов звонка
// и список созданных (предзаданный профиль, без входа).
export function CallTypes() {
  const { items, error, create } = useCallTypes()
  const [form, setForm] = useState(EMPTY_FORM)

  const setField =
    (field: keyof typeof EMPTY_FORM) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [field]: event.target.value }))
    }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const created = await create({
      id: form.id.trim(),
      name: form.name.trim(),
      description: form.description.trim(),
      durationMinutes: Number(form.durationMinutes),
    })
    if (created) {
      setForm(EMPTY_FORM)
    }
  }

  return (
    <div className="flex min-h-svh justify-center p-6">
      <div className="flex w-full max-w-xl flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-medium">Типы звонков</h1>
          <p className="text-muted-foreground text-sm">
            Создавайте Типы звонков: Гость увидит их на главной странице и
            сможет записаться.
          </p>
          <Link
            to="/admin/upcoming"
            className="text-muted-foreground underline-offset-4 text-sm hover:underline"
          >
            Предстоящие →
          </Link>
        </header>

        <form
          className="flex flex-col gap-4 rounded-lg border p-6"
          onSubmit={handleSubmit}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="call-type-id">Идентификатор</Label>
            <Input
              id="call-type-id"
              value={form.id}
              onChange={setField("id")}
              placeholder="intro"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="call-type-name">Название</Label>
            <Input
              id="call-type-name"
              value={form.name}
              onChange={setField("name")}
              placeholder="Интро-звонок"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="call-type-description">Описание</Label>
            <Textarea
              id="call-type-description"
              value={form.description}
              onChange={setField("description")}
              placeholder="О чём этот звонок"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="call-type-duration">Длительность (минуты)</Label>
            <Input
              id="call-type-duration"
              type="number"
              min={5}
              max={240}
              step={1}
              value={form.durationMinutes}
              onChange={setField("durationMinutes")}
              placeholder="15"
              required
            />
          </div>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}

          <Button type="submit">Создать</Button>
        </form>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Созданные типы</h2>
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Пока нет ни одного типа звонка.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border p-4"
                  data-testid="call-type"
                >
                  <p className="font-medium">
                    {item.name} — {item.durationMinutes} минут
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {item.description}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
