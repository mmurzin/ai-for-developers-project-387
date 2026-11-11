package api

import (
	"context"
	"errors"
	"time"

	"github.com/mmurzin/ai-for-developers-project-387/internal/storage"
)

// CallsAPI — ручная реализация ручки создания Записи из
// StrictServerInterface. Контракт — в api/main.tsp.
type CallsAPI struct {
	store *storage.Store
	now   func() time.Time
}

// NewCallsAPI собирает хендлеры Записей поверх хранилища и источника
// времени. now — внедряемый шов: продакшн передаёт time.Now, тесты —
// фиксированные часы (проверки «прошлое» и Окна записи зависят от них).
func NewCallsAPI(store *storage.Store, now func() time.Time) CallsAPI {
	return CallsAPI{store: store, now: now}
}

// CreateCall бронирует Запись Гостя: 201 с созданной Записью
// (длительность и endsAt — из Типа звонка), 409 при пересечении
// с активной Записью любого типа, 422 с кодом при ошибках данных.
func (a CallsAPI) CreateCall(ctx context.Context, request CreateCallRequestObject) (CreateCallResponseObject, error) {
	body := request.Body

	// startsAt: null оставляет zero-value — это тоже кривая дата.
	if body.StartsAt.IsZero() {
		return CreateCall422JSONResponse(ErrorBody{
			Code:    "invalid_date_format",
			Message: "startsAt: ожидается дата-время ISO 8601 со смещением, например 2026-11-05T10:00:00+03:00",
		}), nil
	}
	if body.GuestName == "" {
		return CreateCall422JSONResponse(ErrorBody{
			Code:    "empty_guest_name",
			Message: "имя Гостя не может быть пустым",
		}), nil
	}
	if body.GuestContact == "" {
		return CreateCall422JSONResponse(ErrorBody{
			Code:    "empty_guest_contact",
			Message: "контакт Гостя не может быть пустым",
		}), nil
	}

	ct, err := a.store.GetCallType(ctx, body.CallTypeId)
	switch {
	case errors.Is(err, storage.ErrNotFound):
		return CreateCall422JSONResponse(ErrorBody{
			Code:    "unknown_call_type",
			Message: "Тип звонка не найден",
		}), nil
	case err != nil:
		return nil, err
	}

	start := body.StartsAt
	if violation, resp := validateCallStart(a.now(), start, ct.DurationMinutes); violation {
		return resp, nil
	}

	call := storage.Call{
		CallTypeID:   ct.ID,
		StartsAt:     start,
		EndsAt:       start.Add(time.Duration(ct.DurationMinutes) * time.Minute),
		GuestName:    body.GuestName,
		GuestContact: body.GuestContact,
	}
	created, err := a.store.CreateCall(ctx, call)
	switch {
	case errors.Is(err, storage.ErrConflict):
		return CreateCall409JSONResponse(ErrorBody{
			Code:    "slot_taken",
			Message: "Это время уже занято другой Записью — выберите другой Слот",
		}), nil
	case err != nil:
		return nil, err
	}

	return CreateCall201JSONResponse(toAPICall(created, ct)), nil
}

// ListCalls отдаёт предстоящие Записи всех Типов звонков одним
// списком (Владелец страницы, без входа): ещё не начавшиеся к
// текущему моменту (starts_at >= now, начавшаяся Запись уже не
// предстоящая), по возрастанию начала. Значение range не из enum —
// 422 с кодом invalid_call_range.
func (a CallsAPI) ListCalls(ctx context.Context, request ListCallsRequestObject) (ListCallsResponseObject, error) {
	if !request.Params.Range.Valid() {
		return ListCalls422JSONResponse(ErrorBody{
			Code:    "invalid_call_range",
			Message: "поддерживается только range=upcoming",
		}), nil
	}

	calls, err := a.store.ListUpcomingCalls(ctx, a.now())
	if err != nil {
		return nil, err
	}

	// Название и Длительность звонка Типа звонка дублируются в каждой
	// Записи (см. модель Call в api/main.tsp): беру их из справочника
	// типов; FK в хранилище гарантирует, что тип каждой Записи существует.
	types, err := a.store.ListCallTypes(ctx)
	if err != nil {
		return nil, err
	}
	typesByID := make(map[string]storage.CallType, len(types))
	for _, ct := range types {
		typesByID[ct.ID] = ct
	}

	items := make([]Call, 0, len(calls))
	for _, call := range calls {
		items = append(items, toAPICall(call, typesByID[call.CallTypeID]))
	}
	return ListCalls200JSONResponse(CallList{Items: items}), nil
}

// validateCallStart проверяет время начала брони против правил
// записи: не прошлое, внутри Окна записи, внутри Рабочих часов
// целиком (с учётом Длительности звонка) и на сетке стартов.
// Все времена считаются в зоне инстанса (решения #13, пп. 5–8).
func validateCallStart(now, start time.Time, durationMinutes int32) (bool, CreateCall422JSONResponse) {
	unprocessable := func(code, message string) (bool, CreateCall422JSONResponse) {
		return true, CreateCall422JSONResponse(ErrorBody{Code: code, Message: message})
	}

	if start.Before(now) {
		return unprocessable("starts_at_in_past", "время начала Записи уже прошло")
	}

	// Окно записи: bookingWindowDays календарных дней начиная со следующего
	// за «сегодня» дня; «сегодня» — в зоне инстанса.
	today := now.In(instanceZone)
	localStart := start.In(instanceZone)
	ty, tm, td := today.Date()
	sy, sm, sd := localStart.Date()
	dayOffset := localDayNumber(sy, sm, sd) - localDayNumber(ty, tm, td)
	if dayOffset < 1 || dayOffset > bookingWindowDays {
		return unprocessable("outside_booking_window",
			"начало Записи должно быть внутри Окна записи: ближайшие 14 календарных дней, начиная со следующего дня")
	}

	// Рабочие часы: Запись вписывается целиком — конец не позже
	// конца Рабочих часов того же дня.
	workStart, workEnd := dayWorkBounds(instanceZone, sy, sm, sd)
	end := start.Add(time.Duration(durationMinutes) * time.Minute)
	if localStart.Before(workStart) || end.In(instanceZone).After(workEnd) {
		return unprocessable("outside_working_hours",
			"Запись должна целиком попадать в Рабочие часы 9:00–18:00 по времени инстанса")
	}

	// Запись создаётся на Слот (GLOSSARY.md): старт — на сетке стартов,
	// каждые 15 минут от начала Рабочих часов. Спека не требует этой
	// проверки явно, но бронь «между Слотами» выкраивала бы из сетки
	// дыры, неудобные для других Гостей (см. отчёт #16).
	if offset := localStart.Sub(workStart); offset%slotStep != 0 {
		return unprocessable("start_not_on_grid",
			"время начала должно быть кратно 15 минутам от начала Рабочих часов")
	}

	return false, CreateCall422JSONResponse{}
}

// localDayNumber — порядковый номер календарной даты в зоне инстанса
// (дни от эпохи; для разниц внутри Окна записи часовых поясов
// с целым смещением достаточно и точно).
func localDayNumber(y int, m time.Month, d int) int {
	return int(time.Date(y, m, d, 0, 0, 0, 0, time.UTC).Unix() / 86400)
}

// toAPICall — Запись хранилища в DTO контракта. Времена отдаются
// в зоне инстанса: на границе API — ISO 8601 со смещением зоны,
// как и у Слотов. Название и длительность типа дублируются
// сознательно (см. док-комментарий модели Call в api/main.tsp).
func toAPICall(call storage.Call, ct storage.CallType) Call {
	return Call{
		CallTypeId:      call.CallTypeID,
		CallTypeName:    ct.Name,
		DurationMinutes: ct.DurationMinutes,
		StartsAt:        call.StartsAt.In(instanceZone),
		EndsAt:          call.EndsAt.In(instanceZone),
		GuestName:       call.GuestName,
		GuestContact:    call.GuestContact,
	}
}
