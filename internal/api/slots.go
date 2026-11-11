package api

import (
	"context"
	"errors"
	"time"

	_ "time/tzdata" // база зон зашита в бинарь: Europe/Moscow доступна без системного tzdata

	"github.com/mmurzin/ai-for-developers-project-387/internal/storage"
)

// Константы v1 (карта решений #13, пп. 5–8): Окно записи — 14 календарных
// дней начиная со следующего дня; Рабочие часы — ежедневно 9:00–18:00
// в зоне инстанса; старты — по сетке 15 минут от начала Рабочих часов.
const (
	bookingWindowDays = 14
	workStartHour     = 9
	workEndHour       = 18
	slotStep          = 15 * time.Minute
)

// instanceZone — часовой пояс инстанса: в нём заданы Рабочие часы
// и считается дата «сегодня» для Окна записи (решение #13, п. 7).
var instanceZone = mustLoadZone("Europe/Moscow")

func mustLoadZone(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic("time: zone " + name + " is unavailable: " + err.Error())
	}
	return loc
}

// SlotsAPI — публичная ручка Слотов: сетка вычисляется на лету
// из Рабочих часов и Окна записи, ничего не хранится.
type SlotsAPI struct {
	store *storage.Store
	now   func() time.Time
}

// NewSlotsAPI собирает хендлеры Слотов поверх хранилища и источника
// времени. now — внедряемый шов: продакшн передаёт time.Now,
// тесты — фиксированные часы для детерминированной сетки.
func NewSlotsAPI(store *storage.Store, now func() time.Time) SlotsAPI {
	return SlotsAPI{store: store, now: now}
}

// ListSlots отдаёт Слоты Типа звонка на Окно записи (публичная ручка):
// 200 с computed-сеткой (минус активные Записи), 404 для неизвестного
// идентификатора типа.
func (a SlotsAPI) ListSlots(ctx context.Context, request ListSlotsRequestObject) (ListSlotsResponseObject, error) {
	ct, err := a.store.GetCallType(ctx, request.Id)
	switch {
	case errors.Is(err, storage.ErrNotFound):
		return ListSlots404JSONResponse(ErrorBody{
			Code:    "call_type_not_found",
			Message: "Тип звонка не найден",
		}), nil
	case err != nil:
		return nil, err
	}

	// Занятость: активные Записи, пересекающиеся с Окном записи, —
	// их интервалы вырезаются из сетки Слотов (GLOSSARY.md: Слот —
	// свободное место). Записи всех Типов звонков: интервалы не
	// пересекаются между собой, поэтому вычет один для всех типов.
	windowStart, windowEnd := bookingWindowBounds(a.now())
	busyCalls, err := a.store.ListCallsInRange(ctx, windowStart, windowEnd)
	if err != nil {
		return nil, err
	}
	busy := make([]busyInterval, 0, len(busyCalls))
	for _, call := range busyCalls {
		busy = append(busy, busyInterval{start: call.StartsAt, end: call.EndsAt})
	}

	return ListSlots200JSONResponse(SlotList{Items: computeSlots(a.now(), ct.DurationMinutes, busy)}), nil
}

// busyInterval — интервал активной Записи, вырезаемый из сетки Слотов.
type busyInterval struct {
	start time.Time
	end   time.Time
}

// dayWorkBounds — границы Рабочих часов календарного дня в зоне:
// единое место сборки time.Date по константам рабочих часов, чтобы
// сетка Слотов и проверки Записей не разошлись. Месяц и день могут
// выходить за диапазон — time.Date нормализует (завтра = d+1 и т.п.).
func dayWorkBounds(zone *time.Location, y int, m time.Month, d int) (start, end time.Time) {
	return time.Date(y, m, d, workStartHour, 0, 0, 0, zone),
		time.Date(y, m, d, workEndHour, 0, 0, 0, zone)
}

// bookingWindowBounds — границы Окна записи от «сейчас»: от начала
// Рабочих часов первого дня (завтра) до конца Рабочих часов последнего.
func bookingWindowBounds(now time.Time) (time.Time, time.Time) {
	y, m, d := now.In(instanceZone).Date()
	start, _ := dayWorkBounds(instanceZone, y, m, d+1)
	_, end := dayWorkBounds(instanceZone, y, m, d+bookingWindowDays)
	return start, end
}

// overlapsBusy — пересекается ли [start, end) с каким-либо занятым
// интервалом: полуоткрытые интервалы, примыкание — не пересечение.
func overlapsBusy(start, end time.Time, busy []busyInterval) bool {
	for _, b := range busy {
		if b.start.Before(end) && b.end.After(start) {
			return true
		}
	}
	return false
}

// computeSlots вычисляет Слоты на Окно записи (чистая функция,
// GLOSSARY.md: Слот, Окно записи, Рабочие часы).
//
// Окно записи — bookingWindowDays календарных дней начиная со следующего
// за «сегодня» дня; дата «сегодня» считается в зоне инстанса (включая
// выходные). Внутри каждого дня — Рабочие часы workStartHour–workEndHour:
// старты идут по сетке slotStep от начала часа, Слот длится durationMinutes
// и должен вмещаться целиком, поэтому последний старт — не позже,
// чем за Длительность до конца Рабочих часов. Старты, пересекающиеся
// с активными Записями (busy), вырезаются. Времена строятся в зоне
// инстанса: на границе API маршалятся в ISO 8601 со смещением зоны.
func computeSlots(now time.Time, durationMinutes int32, busy []busyInterval) []Slot {
	duration := time.Duration(durationMinutes) * time.Minute

	today := now.In(instanceZone)
	y, m, d := today.Date()

	slots := make([]Slot, 0, bookingWindowDays*int(workEndHour-workStartHour)*2)
	for day := 1; day <= bookingWindowDays; day++ {
		workStart, workEnd := dayWorkBounds(instanceZone, y, m, d+day)
		for start := workStart; !start.Add(duration).After(workEnd); start = start.Add(slotStep) {
			end := start.Add(duration)
			if overlapsBusy(start, end, busy) {
				continue
			}
			slots = append(slots, Slot{StartsAt: start, EndsAt: end})
		}
	}
	return slots
}
