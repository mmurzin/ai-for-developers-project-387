# Сборка образа приложения: бинарь Go с зашитым (embed) фронтом.
# Версии стадий соответствуют mise.toml (node 24, pnpm 12.16.1, go 1.26).

# --- Фронтенд: vite-сборка SPA
FROM node:24.22-alpine AS frontend
RUN npm install -g pnpm@12.16.1
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
# сначала только манифесты — слой с зависимостями кешируется
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# --- Бэкенд: статический бинарь (CGO выключен: modernc.org/sqlite — pure Go)
FROM golang:1.26-alpine AS backend
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
# вместо закоммиченного placeholder'а — реальный билд фронта
RUN rm -rf internal/web/dist
COPY --from=frontend /app/frontend/dist ./internal/web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# Каталог для SQLite: владелец — nonroot (uid 65532), WORKDIR в distroless
# создаёт каталоги от root, поэтому готовим /data в стадии сборки
RUN mkdir -p /out/data && chown -R 65532:65532 /out/data

# --- Рантайм: только бинарь и пустая writable-директория
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=backend /out/server /server
COPY --from=backend --chown=nonroot:nonroot /out/data /data
WORKDIR /data
ENV DB_PATH=/data/calls.db
# PORT задаёт платформа (Render); по умолчанию — 8080 для локального запуска
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/server"]
