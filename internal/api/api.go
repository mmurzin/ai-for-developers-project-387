package api

import (
	"time"

	"github.com/mmurzin/ai-for-developers-project-387/internal/storage"
)

// API собирает все strict-хендлеры контракта в один объект
// для передачи в NewStrictHandler: сгенерированный StrictServerInterface
// единый, а реализация разложена по файлам предметных областей.
type API struct {
	HealthAPI
	CallTypesAPI
	SlotsAPI
	CallsAPI
}

// NewAPI собирает API поверх хранилища и источника времени.
// now — шов времени для computed-Слотов и проверок брони
// (продакшн — time.Now, тесты — фиксированные часы).
func NewAPI(store *storage.Store, now func() time.Time) API {
	return API{
		HealthAPI:    HealthAPI{},
		CallTypesAPI: NewCallTypesAPI(store),
		SlotsAPI:     NewSlotsAPI(store, now),
		CallsAPI:     NewCallsAPI(store, now),
	}
}
