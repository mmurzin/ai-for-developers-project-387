package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/mmurzin/ai-for-developers-project-387/internal/api"
	"github.com/mmurzin/ai-for-developers-project-387/internal/storage"
	"github.com/mmurzin/ai-for-developers-project-387/internal/web"
)

// NewServer собирает сервер с роутами контракта и SPA-фолбэком.
// now — источник времени для computed-Слотов (шов для детерминированных
// тестов; продакшн передаёт time.Now).
func NewServer(addr string, store *storage.Store, now func() time.Time) *http.Server {
	mux := http.NewServeMux()

	// Роуты из TypeSpec-контракта (api/main.tsp → api/openapi.yaml):
	// типизированные strict-хендлеры, паттерны Go 1.22 на общем мухе.
	//
	// RequestErrorHandlerFunc: ошибки декодинга тела по умолчанию отдаются
	// 400 текстом. Поле не того типа (например, нецелая длительность) и
	// кривая дата-время (startsAt Записи) — это ошибки валидации данных,
	// а не синтаксиса: 422 с телом ErrorBody. Битый JSON остаётся 400.
	// StdHTTPServerOptions.ErrorHandlerFunc: ошибки разбора path/query-
	// параметров (роутинг кодгена) по умолчанию отдаются 400 plain text.
	// Отсутствие обязательного query-параметра (range у списка Записей) —
	// ошибка запроса: 400 с телом ErrorBody, как у остальных ручек.
	api.HandlerWithOptions(
		api.NewStrictHandlerWithOptions(api.NewAPI(store, now), nil, api.StrictHTTPServerOptions{
			RequestErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
				var typeErr *json.UnmarshalTypeError
				if errors.As(err, &typeErr) {
					api.WriteError(w, http.StatusUnprocessableEntity, "invalid_field_type",
						fmt.Sprintf("поле %s: неверный тип", typeErr.Field))
					return
				}
				var parseErr *time.ParseError
				if errors.As(err, &parseErr) {
					api.WriteError(w, http.StatusUnprocessableEntity, "invalid_date_format",
						"поле startsAt: ожидается дата-время ISO 8601 со смещением, например 2026-11-05T10:00:00+03:00")
					return
				}
				api.WriteError(w, http.StatusBadRequest, "malformed_json",
					"тело запроса не является корректным JSON")
			},
		}),
		api.StdHTTPServerOptions{
			BaseRouter: mux,
			ErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
				var required *api.RequiredParamError
				if errors.As(err, &required) {
					api.WriteError(w, http.StatusBadRequest, "missing_query_param",
						fmt.Sprintf("query-параметр %q обязателен", required.ParamName))
					return
				}
				api.WriteError(w, http.StatusBadRequest, "invalid_query_param", err.Error())
			},
		},
	)

	mux.Handle("GET /", web.Handler())

	// Резерв под будущие ручки: неизвестные /api/* — 404, а не SPA-фолбэк.
	mux.HandleFunc("GET /api/", http.NotFound)

	return &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}
