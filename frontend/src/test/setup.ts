import "@testing-library/jest-dom/vitest"

// vitest globals выключены (конвенция репо), поэтому RTL не регистрирует
// авто-cleanup: без ручного afterEach DOM копится между тестами.
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

afterEach(() => {
  cleanup()
})
