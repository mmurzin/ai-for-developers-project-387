package api

import (
	"context"
)

// HealthAPI — ручная реализация сгенерированного StrictServerInterface
// из internal/api/openapi.gen.go. Контракт — в api/main.tsp.
type HealthAPI struct{}

// Health отвечает, что сервис жив: {"status":"ok"}.
func (HealthAPI) Health(_ context.Context, _ HealthRequestObject) (HealthResponseObject, error) {
	return Health200JSONResponse(HealthStatus{Status: "ok"}), nil
}
