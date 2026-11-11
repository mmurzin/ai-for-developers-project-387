package api

import (
	"context"
	"errors"

	"github.com/mmurzin/ai-for-developers-project-387/internal/storage"
)

// CallTypesAPI — ручная реализация ручек Типов звонка из StrictServerInterface.
// Контракт — в api/main.tsp.
type CallTypesAPI struct {
	store *storage.Store
}

// NewCallTypesAPI собирает хендлеры Типов звонка поверх хранилища.
func NewCallTypesAPI(store *storage.Store) CallTypesAPI {
	return CallTypesAPI{store: store}
}

// CreateCallType валидирует и сохраняет Тип звонка:
// 201 с созданным типом, 409 при дубликате идентификатора,
// 422 при пустых полях или длительности вне 5–240.
func (a CallTypesAPI) CreateCallType(ctx context.Context, request CreateCallTypeRequestObject) (CreateCallTypeResponseObject, error) {
	body := request.Body

	if body.Id == "" {
		return CreateCallType422JSONResponse(ErrorBody{
			Code:    "empty_id",
			Message: "идентификатор Типа звонка не может быть пустым",
		}), nil
	}
	if body.Name == "" {
		return CreateCallType422JSONResponse(ErrorBody{
			Code:    "empty_name",
			Message: "название Типа звонка не может быть пустым",
		}), nil
	}
	if body.DurationMinutes < 5 || body.DurationMinutes > 240 {
		return CreateCallType422JSONResponse(ErrorBody{
			Code:    "duration_out_of_range",
			Message: "длительность звонка должна быть целым числом минут от 5 до 240",
		}), nil
	}

	created := storage.CallType{
		ID:              body.Id,
		Name:            body.Name,
		Description:     body.Description,
		DurationMinutes: body.DurationMinutes,
	}

	err := a.store.CreateCallType(ctx, created)
	switch {
	case errors.Is(err, storage.ErrDuplicate):
		return CreateCallType409JSONResponse(ErrorBody{
			Code:    "duplicate_id",
			Message: "Тип звонка с таким идентификатором уже существует",
		}), nil
	case err != nil:
		return nil, err
	}

	return CreateCallType201JSONResponse(toAPICallType(created)), nil
}

// ListCallTypes отдаёт все созданные Типы звонков (публичная ручка).
func (a CallTypesAPI) ListCallTypes(ctx context.Context, _ ListCallTypesRequestObject) (ListCallTypesResponseObject, error) {
	types, err := a.store.ListCallTypes(ctx)
	if err != nil {
		return nil, err
	}

	items := make([]CallType, len(types))
	for i, ct := range types {
		items[i] = toAPICallType(ct)
	}

	return ListCallTypes200JSONResponse(CallTypeList{Items: items}), nil
}

func toAPICallType(ct storage.CallType) CallType {
	return CallType{
		Id:              ct.ID,
		Name:            ct.Name,
		Description:     ct.Description,
		DurationMinutes: ct.DurationMinutes,
	}
}
