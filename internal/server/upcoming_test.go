package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// getCalls — GET /api/calls с сырой query-строкой ("" — без параметров).
func getCalls(t *testing.T, srv *http.Server, rawQuery string) *httptest.ResponseRecorder {
	t.Helper()

	rec := httptest.NewRecorder()
	path := "/api/calls"
	if rawQuery != "" {
		path += "?" + rawQuery
	}
	srv.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

// newUpcomingTestServer — сервер с мутабельными часами: Записи сеются
// при одном «сейчас», затем часы переводятся вперёд — предстоящие
// пересчитываются без пересоздания сервера (фильтр на шве now).
func newUpcomingTestServer(t *testing.T) (*http.Server, *time.Time) {
	t.Helper()

	now := testNow
	srv := newTestServerAtClock(t, t.TempDir()+"/upcoming.db", func() time.Time { return now })
	return srv, &now
}

// Пустой список — валидный ответ: items присутствует и пуст.
func TestListUpcomingCallsEmptyList(t *testing.T) {
	srv, _ := newUpcomingTestServer(t)

	rec := getCalls(t, srv, "range=upcoming")

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/calls?range=upcoming: status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if got := strings.TrimSpace(rec.Body.String()); got != `{"items":[]}` {
		t.Errorf("empty upcoming list body = %s, want %s", got, `{"items":[]}`)
	}
}

// Предстоящие Записи всех Типов звонков одним списком: порядок —
// по возрастанию начала (не по времени брони), у каждой — тип
// (название, длительность), начало ISO со смещением, имя и контакт
// Гостя.
func TestListUpcomingCallsOrdersAndFields(t *testing.T) {
	srv, _ := newUpcomingTestServer(t)
	seedCallType(t, srv, "intro", 15)
	seedCallType(t, srv, "hour", 60)

	// Сеем в обратном хронологическом порядке: порядок выдачи должен
	// определяться началом Звонка, а не попаданием в базу.
	if rec := postCall(t, srv, callBody("intro", day1+"T11:00:00+03:00", "Анна", "anna@example.com")); rec.Code != http.StatusCreated {
		t.Fatalf("seed intro at 11:00: status = %d, want %d; body: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if rec := postCall(t, srv, callBody("hour", day1+"T09:00:00+03:00", "Борис", "boris@example.com")); rec.Code != http.StatusCreated {
		t.Fatalf("seed hour at 09:00: status = %d, want %d; body: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	rec := getCalls(t, srv, "range=upcoming")

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/calls?range=upcoming: status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var list struct {
		Items []callDTO `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode upcoming calls: %v; body: %s", err, rec.Body.String())
	}
	if len(list.Items) != 2 {
		t.Fatalf("upcoming calls count = %d, want 2; body: %s", len(list.Items), rec.Body.String())
	}

	first, second := list.Items[0], list.Items[1]
	if first.CallTypeId != "hour" || first.CallTypeName != "Звонок hour" || first.DurationMinutes != 60 {
		t.Errorf("first call type = %q/%q/%d min, want hour/Звонок hour/60 min", first.CallTypeId, first.CallTypeName, first.DurationMinutes)
	}
	if first.StartsAt != day1+"T09:00:00+03:00" || first.EndsAt != day1+"T10:00:00+03:00" {
		t.Errorf("first call interval = %s…%s, want %sT09:00:00+03:00…%sT10:00:00+03:00", first.StartsAt, first.EndsAt, day1, day1)
	}
	if first.GuestName != "Борис" || first.GuestContact != "boris@example.com" {
		t.Errorf("first call guest = %q/%q, want Борис/boris@example.com", first.GuestName, first.GuestContact)
	}
	if second.CallTypeId != "intro" || second.CallTypeName != "Звонок intro" || second.DurationMinutes != 15 {
		t.Errorf("second call type = %q/%q/%d min, want intro/Звонок intro/15 min", second.CallTypeId, second.CallTypeName, second.DurationMinutes)
	}
	if second.StartsAt != day1+"T11:00:00+03:00" {
		t.Errorf("second call startsAt = %s, want %sT11:00:00+03:00", second.StartsAt, day1)
	}
	if second.GuestName != "Анна" || second.GuestContact != "anna@example.com" {
		t.Errorf("second call guest = %q/%q, want Анна/anna@example.com", second.GuestName, second.GuestContact)
	}
}

// Граница «предстоящего»: попадают только ещё не начавшиеся Записи.
// Часы переводятся вперёд без пересборки сервера: прошедшая и идущая
// (начавшаяся, но не закончившаяся) Записи исчезают из выдачи;
// начало ровно в «сейчас» — ещё предстоящее (граница включающая,
// starts_at >= now).
func TestListUpcomingCallsBoundaryOnNow(t *testing.T) {
	srv, now := newUpcomingTestServer(t)
	seedCallType(t, srv, "half", 30)
	seedCallType(t, srv, "hour", 60)

	// Три Записи 5 ноября (Окно записи от testNow = 4 ноября):
	// 09:00–09:30, 10:00–11:00 и 12:00–12:30 (+03:00).
	for _, b := range []struct{ id, at string }{
		{"half", day1 + "T09:00:00+03:00"},
		{"hour", day1 + "T10:00:00+03:00"},
		{"half", day1 + "T12:00:00+03:00"},
	} {
		if rec := postCall(t, srv, callBody(b.id, b.at, "Гость", "guest@example.com")); rec.Code != http.StatusCreated {
			t.Fatalf("seed %s at %s: status = %d, want %d; body: %s", b.id, b.at, rec.Code, http.StatusCreated, rec.Body.String())
		}
	}

	// Часы: 5 ноября 10:30 по Москве (07:30 UTC). Запись 09:00 уже
	// прошла, 10:00 идёт, 12:00 — предстоящая.
	*now = time.Date(2026, time.November, 5, 7, 30, 0, 0, time.UTC)

	rec := getCalls(t, srv, "range=upcoming")

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/calls?range=upcoming: status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var list struct {
		Items []callDTO `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode upcoming calls: %v; body: %s", err, rec.Body.String())
	}
	if len(list.Items) != 1 {
		t.Fatalf("upcoming calls count = %d, want 1 (только 12:00; 09:00 прошла, 10:00 идёт); body: %s", len(list.Items), rec.Body.String())
	}
	if list.Items[0].StartsAt != day1+"T12:00:00+03:00" {
		t.Errorf("remaining call startsAt = %s, want %sT12:00:00+03:00", list.Items[0].StartsAt, day1)
	}

	// Часы: ровно начало Записи (12:00+03 = 09:00 UTC) — граница
	// включающая, Запись ещё предстоящая.
	*now = time.Date(2026, time.November, 5, 9, 0, 0, 0, time.UTC)

	rec = getCalls(t, srv, "range=upcoming")
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode upcoming calls at boundary: %v; body: %s", err, rec.Body.String())
	}
	if len(list.Items) != 1 || list.Items[0].StartsAt != day1+"T12:00:00+03:00" {
		t.Errorf("call starting exactly at now: items = %+v, want единственная Запись 12:00", list.Items)
	}
}

// Отсутствие ?range= — обязательный query-параметр: сгенерированный
// роутинг отвечает 400, монтаж сервера приводит тело к ErrorBody
// (JSON), а не дефолтному plain text.
func TestListCallsMissingRangeParamReturns400JSON(t *testing.T) {
	srv, _ := newUpcomingTestServer(t)

	rec := getCalls(t, srv, "")

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("GET /api/calls: status = %d, want %d; body: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	decodeErrorBody(t, rec, "missing_query_param")
	if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "application/json") {
		t.Errorf("GET /api/calls: Content-Type = %q, want application/json", got)
	}
}

// Значение range не из enum (?range=past) — 422 с machine-readable
// кодом invalid_call_range.
func TestListCallsUnknownRangeReturns422(t *testing.T) {
	srv, _ := newUpcomingTestServer(t)

	rec := getCalls(t, srv, "range=past")

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("GET /api/calls?range=past: status = %d, want %d; body: %s", rec.Code, http.StatusUnprocessableEntity, rec.Body.String())
	}
	decodeErrorBody(t, rec, "invalid_call_range")
}
