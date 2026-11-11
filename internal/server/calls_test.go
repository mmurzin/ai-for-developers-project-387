package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mmurzin/ai-for-developers-project-387/internal/api"
)

// callDTO — Запись как она приходит с границы API: даты — строки ISO 8601
// с явным смещением, без приведения к time.Time (смещение проверяем как есть).
type callDTO struct {
	CallTypeId      string `json:"callTypeId"`
	CallTypeName    string `json:"callTypeName"`
	DurationMinutes int32  `json:"durationMinutes"`
	StartsAt        string `json:"startsAt"`
	EndsAt          string `json:"endsAt"`
	GuestName       string `json:"guestName"`
	GuestContact    string `json:"guestContact"`
}

// postCall — POST /api/calls с сырым JSON-телом.
func postCall(t *testing.T, srv *http.Server, body string) *httptest.ResponseRecorder {
	t.Helper()
	return postJSON(t, srv, "/api/calls", body)
}

// callBody собирает тело брони: тип, начало (ISO со смещением), имя, контакт.
func callBody(callTypeID, startsAt, name, contact string) string {
	return fmt.Sprintf(`{"callTypeId":%q,"startsAt":%q,"guestName":%q,"guestContact":%q}`,
		callTypeID, startsAt, name, contact)
}

// decodeCallBody разбирает тело ответа брони или падает с контекстом.
func decodeCallBody(t *testing.T, rec *httptest.ResponseRecorder) callDTO {
	t.Helper()
	var call callDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &call); err != nil {
		t.Fatalf("decode call body: %v; body: %s", err, rec.Body.String())
	}
	return call
}

// decodeErrorBody разбирает ErrorBody и проверяет код и непустое сообщение.
func decodeErrorBody(t *testing.T, rec *httptest.ResponseRecorder, wantCode string) {
	t.Helper()
	var errBody api.ErrorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &errBody); err != nil {
		t.Fatalf("decode error body: %v; body: %s", err, rec.Body.String())
	}
	if errBody.Code != wantCode {
		t.Errorf("error code = %q, want %q", errBody.Code, wantCode)
	}
	if errBody.Message == "" {
		t.Errorf("error message is empty")
	}
}

// Окно записи от testNow (4 ноября 2026): 5–18 ноября 2026.
// Времена — в зоне инстанса (Europe/Moscow, +03:00).
const (
	day1 = "2026-11-05"
)

func TestCreateCallReturns201WithCallFromTypeDuration(t *testing.T) {
	srv := newSlotsTestServer(t)
	seedCallType(t, srv, "intro", 30)

	rec := postCall(t, srv, callBody("intro", day1+"T10:00:00+03:00", "Миша", "guest@example.com"))

	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /api/calls: status = %d, want %d; body: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	call := decodeCallBody(t, rec)
	if call.CallTypeId != "intro" {
		t.Errorf("callTypeId = %q, want %q", call.CallTypeId, "intro")
	}
	if call.CallTypeName != "Звонок intro" {
		t.Errorf("callTypeName = %q, want %q", call.CallTypeName, "Звонок intro")
	}
	// Длительность — из типа, endsAt вычислен сервером.
	if call.DurationMinutes != 30 {
		t.Errorf("durationMinutes = %d, want 30", call.DurationMinutes)
	}
	if call.StartsAt != day1+"T10:00:00+03:00" {
		t.Errorf("startsAt = %q, want %q", call.StartsAt, day1+"T10:00:00+03:00")
	}
	if call.EndsAt != day1+"T10:30:00+03:00" {
		t.Errorf("endsAt = %q, want %q", call.EndsAt, day1+"T10:30:00+03:00")
	}
	if call.GuestName != "Миша" {
		t.Errorf("guestName = %q, want %q", call.GuestName, "Миша")
	}
	if call.GuestContact != "guest@example.com" {
		t.Errorf("guestContact = %q, want %q", call.GuestContact, "guest@example.com")
	}
}

// То же мгновение, отправленное в UTC: границы API отвечают в зоне инстанса,
// нормализация дат не должна менять смысл времени.
func TestCreateCallNormalizesOffsetToInstanceZone(t *testing.T) {
	srv := newSlotsTestServer(t)
	seedCallType(t, srv, "intro", 30)

	// 07:30Z = 10:30 по Москве.
	rec := postCall(t, srv, callBody("intro", day1+"T07:30:00Z", "Миша", "guest@example.com"))

	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /api/calls: status = %d, want %d; body: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	call := decodeCallBody(t, rec)
	if call.StartsAt != day1+"T10:30:00+03:00" {
		t.Errorf("startsAt = %q, want %q (нормализация в зону инстанса)", call.StartsAt, day1+"T10:30:00+03:00")
	}
	if call.EndsAt != day1+"T11:00:00+03:00" {
		t.Errorf("endsAt = %q, want %q", call.EndsAt, day1+"T11:00:00+03:00")
	}
}

func TestCreateCallValidation(t *testing.T) {
	// Часы теста: testNow = 4 ноября 2026, 12:30 по Москве.
	// Окно записи: 5–18 ноября 2026; Рабочие часы 9:00–18:00 (+03:00).
	cases := []struct {
		name     string
		callType string // "" — тип не сеется, в теле ghost
		body     string
		wantCode string
	}{
		{
			name:     "unknown call type",
			callType: "",
			body:     callBody("ghost", day1+"T10:00:00+03:00", "Миша", "guest@example.com"),
			wantCode: "unknown_call_type",
		},
		{
			name:     "empty guest name",
			callType: "intro",
			body:     callBody("intro", day1+"T10:00:00+03:00", "", "guest@example.com"),
			wantCode: "empty_guest_name",
		},
		{
			name:     "empty guest contact",
			callType: "intro",
			body:     callBody("intro", day1+"T10:00:00+03:00", "Миша", ""),
			wantCode: "empty_guest_contact",
		},
		{
			name:     "malformed startsAt",
			callType: "intro",
			body:     callBody("intro", "завтра в десять", "Миша", "guest@example.com"),
			wantCode: "invalid_date_format",
		},
		{
			name:     "start in the past",
			callType: "intro",
			body:     callBody("intro", "2026-11-03T10:00:00+03:00", "Миша", "guest@example.com"),
			wantCode: "starts_at_in_past",
		},
		{
			name:     "today is outside booking window",
			callType: "intro",
			body:     callBody("intro", "2026-11-04T15:00:00+03:00", "Миша", "guest@example.com"),
			wantCode: "outside_booking_window",
		},
		{
			name:     "day 15 is outside booking window",
			callType: "intro",
			body:     callBody("intro", "2026-11-19T10:00:00+03:00", "Миша", "guest@example.com"),
			wantCode: "outside_booking_window",
		},
		{
			name:     "before working hours",
			callType: "intro",
			body:     callBody("intro", day1+"T08:45:00+03:00", "Миша", "guest@example.com"),
			wantCode: "outside_working_hours",
		},
		{
			name:     "does not fit into working hours entirely",
			callType: "intro",
			body:     callBody("intro", day1+"T17:45:00+03:00", "Миша", "guest@example.com"),
			wantCode: "outside_working_hours",
		},
		{
			name:     "start off the 15-minute grid",
			callType: "intro",
			body:     callBody("intro", day1+"T10:07:00+03:00", "Миша", "guest@example.com"),
			wantCode: "start_not_on_grid",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := newSlotsTestServer(t)
			if tc.callType != "" {
				seedCallType(t, srv, tc.callType, 30)
			}

			rec := postCall(t, srv, tc.body)

			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("POST /api/calls: status = %d, want %d; body: %s", rec.Code, http.StatusUnprocessableEntity, rec.Body.String())
			}
			decodeErrorBody(t, rec, tc.wantCode)
		})
	}
}

// Частичное наложение разной длительности: 60 минут с 10:00, затем
// 30 минут с 10:30 — интервалы пересекаются. Вторая бронь отправлена
// в UTC (07:30Z): нормализация времён в хранилище не должна терять
// конфликт между разными смещениями.
func TestCreateCallPartialOverlapDifferentDurations(t *testing.T) {
	srv := newSlotsTestServer(t)
	seedCallType(t, srv, "hour", 60)
	seedCallType(t, srv, "half", 30)

	if rec := postCall(t, srv, callBody("hour", day1+"T10:00:00+03:00", "Первый", "a@example.com")); rec.Code != http.StatusCreated {
		t.Fatalf("first booking: status = %d, want %d; body: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	rec := postCall(t, srv, callBody("half", day1+"T07:30:00Z", "Второй", "b@example.com"))

	if rec.Code != http.StatusConflict {
		t.Fatalf("overlapping booking: status = %d, want %d; body: %s", rec.Code, http.StatusConflict, rec.Body.String())
	}
	decodeErrorBody(t, rec, "slot_taken")
}

// Примыкание: интервалы полуоткрытые [начало, конец).
// После брони 10:00–11:00: начало ровно в конец (11:00) и конец ровно
// в начало (09:30–10:00) — допустимы; 10:30 — внутри, конфликт.
func TestCreateCallAdjacency(t *testing.T) {
	srv := newSlotsTestServer(t)
	seedCallType(t, srv, "hour", 60)
	seedCallType(t, srv, "half", 30)

	if rec := postCall(t, srv, callBody("hour", day1+"T10:00:00+03:00", "Первый", "a@example.com")); rec.Code != http.StatusCreated {
		t.Fatalf("base booking 10:00–11:00: status = %d, want %d; body: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	// Конец ровно в начало существующей: 09:30–10:00 — примыкание слева.
	if rec := postCall(t, srv, callBody("half", day1+"T09:30:00+03:00", "Слева", "l@example.com")); rec.Code != http.StatusCreated {
		t.Errorf("adjacent left 09:30: status = %d, want %d; body: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	// Начало внутри существующей: «10:30 после 10:00–11:00» — конфликт.
	if rec := postCall(t, srv, callBody("half", day1+"T10:30:00+03:00", "Внутри", "m@example.com")); rec.Code != http.StatusConflict {
		t.Errorf("inner start 10:30: status = %d, want %d; body: %s", rec.Code, http.StatusConflict, rec.Body.String())
	} else {
		decodeErrorBody(t, rec, "slot_taken")
	}

	// Начало ровно в конец существующей: «11:00 после 10:00–11:00» — примыкание справа.
	if rec := postCall(t, srv, callBody("half", day1+"T11:00:00+03:00", "Справа", "r@example.com")); rec.Code != http.StatusCreated {
		t.Errorf("adjacent right 11:00: status = %d, want %d; body: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
}

// Гонка: одновременные брони одного Слота. Проверка атомарна
// (транзакция SQLite с писательским локом) — ровно одна 201,
// остальные — 409.
func TestCreateCallRaceSingleWinner(t *testing.T) {
	srv := newSlotsTestServer(t)
	seedCallType(t, srv, "intro", 30)

	const racers = 10
	body := callBody("intro", day1+"T10:00:00+03:00", "Гость", "guest@example.com")

	start := make(chan struct{})
	statuses := make([]int, racers)
	var wg sync.WaitGroup
	for i := range racers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/calls", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			srv.Handler.ServeHTTP(rec, req)

			statuses[i] = rec.Code
		}()
	}
	close(start)
	wg.Wait()

	var created, conflicts, other int
	for _, status := range statuses {
		switch status {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
			conflicts++
		default:
			other++
		}
	}
	if created != 1 || conflicts != racers-1 || other != 0 {
		t.Fatalf("race results: created = %d, conflicts = %d, other = %d; want created = 1, conflicts = %d, other = 0 (statuses: %v)",
			created, conflicts, other, racers-1, statuses)
	}
}

// bookedSlotStarts — множество стартов Слотов типа после брони.
func bookedSlotStarts(t *testing.T, srv *http.Server, callTypeID string) map[string]bool {
	t.Helper()

	status, slots := getSlots(t, srv, callTypeID)
	if status != http.StatusOK {
		t.Fatalf("GET /api/call-types/%s/slots: status = %d, want %d", callTypeID, status, http.StatusOK)
	}
	starts := make(map[string]bool, len(slots))
	for _, s := range slots {
		starts[s.StartsAt] = true
	}
	return starts
}

func wantSlot(t *testing.T, starts map[string]bool, startsAt, context string, want bool) {
	t.Helper()

	if got := starts[startsAt]; got != want {
		t.Errorf("%s: слот %s присутствует = %v, want %v", context, startsAt, got, want)
	}
}

// Активные Записи вырезаются из Слотов — в том числе для типов другой
// длительности на пересекающиеся времена: 60 минут с 10:00 убивает
// 15-минутные старты 10:00–10:45 и 30-минутные 10:00–10:45, но не 11:00;
// примыкающие (кончающиеся ровно в 10:00) остаются.
func TestSlotsExcludeBookedCalls(t *testing.T) {
	srv := newSlotsTestServer(t)
	seedCallType(t, srv, "intro", 15)
	seedCallType(t, srv, "half", 30)
	seedCallType(t, srv, "hour", 60)

	if rec := postCall(t, srv, callBody("hour", day1+"T10:00:00+03:00", "Гость", "guest@example.com")); rec.Code != http.StatusCreated {
		t.Fatalf("book 60 min at 10:00: status = %d, want %d; body: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	// Тот же тип: занятый старт исчез, примыкающие (9:00–10:00 и 11:00–12:00) на месте.
	hour := bookedSlotStarts(t, srv, "hour")
	wantSlot(t, hour, day1+"T10:00:00+03:00", "часовой тип", false)
	wantSlot(t, hour, day1+"T09:00:00+03:00", "часовой тип", true)
	wantSlot(t, hour, day1+"T11:00:00+03:00", "часовой тип", true)

	// 15-минутный тип: старты 10:00–10:45 пересекают [10:00, 11:00);
	// 9:45 кончается ровно в начало брони, 11:00 примыкает справа.
	intro := bookedSlotStarts(t, srv, "intro")
	for _, m := range []string{"10:00", "10:15", "10:30", "10:45"} {
		wantSlot(t, intro, day1+"T"+m+":00+03:00", "15-минутный тип", false)
	}
	wantSlot(t, intro, day1+"T09:45:00+03:00", "15-минутный тип", true)
	wantSlot(t, intro, day1+"T11:00:00+03:00", "15-минутный тип", true)

	// 30-минутный тип: заняты старты 10:00–10:45 (каждый заезжает в бронь),
	// свободны 9:30 (кончается в 10:00) и 11:00.
	half := bookedSlotStarts(t, srv, "half")
	for _, m := range []string{"10:00", "10:15", "10:30", "10:45"} {
		wantSlot(t, half, day1+"T"+m+":00+03:00", "30-минутный тип", false)
	}
	wantSlot(t, half, day1+"T09:30:00+03:00", "30-минутный тип", true)
	wantSlot(t, half, day1+"T11:00:00+03:00", "30-минутный тип", true)
}

// Записи переживают рестарт сервера (US13 спеки #6, как и Типы звонков
// в TestCallTypesSurviveServerRestart): Тип звонка и Запись создаются
// на первом «процессе», второй поднимается на том же файле базы —
// Запись по-прежнему видна в предстоящих и вычтена из Слотов.
func TestCallsSurviveServerRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "restart-calls.db")
	clock := func() time.Time { return testNow }

	first := newTestServerAtClock(t, dbPath, clock)
	seedCallType(t, first, "intro", 30)
	if rec := postCall(t, first, callBody("intro", day1+"T10:00:00+03:00", "Миша", "guest@example.com")); rec.Code != http.StatusCreated {
		t.Fatalf("seed POST /api/calls: status = %d, want %d; body: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	// Новый «процесс» сервера на том же файле базы.
	second := newTestServerAtClock(t, dbPath, clock)

	// Предстоящие: Запись на месте, со всеми деталями.
	rec := httptest.NewRecorder()
	second.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/calls?range=upcoming", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/calls?range=upcoming after restart: status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var list struct {
		Items []callDTO `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode upcoming calls: %v; body: %s", err, rec.Body.String())
	}
	if len(list.Items) != 1 {
		t.Fatalf("upcoming calls after restart = %d, want 1; body: %s", len(list.Items), rec.Body.String())
	}
	call := list.Items[0]
	if call.CallTypeId != "intro" || call.GuestName != "Миша" || call.StartsAt != day1+"T10:00:00+03:00" {
		t.Errorf("call after restart = %+v, want intro / Миша / %sT10:00:00+03:00", call, day1)
	}

	// Вычет занятости из Слотов тоже пережил рестарт: старт 10:00
	// (интервал Записи) исчез, примыкающие 09:30 и 10:30 — на месте.
	starts := bookedSlotStarts(t, second, "intro")
	wantSlot(t, starts, day1+"T10:00:00+03:00", "слоты после рестарта", false)
	wantSlot(t, starts, day1+"T09:30:00+03:00", "слоты после рестарта", true)
	wantSlot(t, starts, day1+"T10:30:00+03:00", "слоты после рестарта", true)
}
