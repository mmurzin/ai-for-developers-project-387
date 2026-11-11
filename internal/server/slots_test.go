package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/mmurzin/ai-for-developers-project-387/internal/api"
)

// testNow — фиксированные часы для детерминированных тестов Слотов:
// среда 4 ноября 2026, 12:30 по Москве (09:30 UTC).
// Окно записи от этой даты: 5–18 ноября 2026; 7–8 ноября — выходные.
var testNow = time.Date(2026, time.November, 4, 9, 30, 0, 0, time.UTC)

// newSlotsTestServer собирает сервер с throwaway SQLite и фиксированными
// часами: Слоты вычисляются от testNow, а не от реального времени.
func newSlotsTestServer(t *testing.T) *http.Server {
	t.Helper()
	return newTestServerAtClock(t, filepath.Join(t.TempDir(), "slots.db"), func() time.Time { return testNow })
}

// slotDTO — Слот как он приходит с границы API: строки ISO 8601
// с явным смещением, без приведения к time.Time (смещение проверяем как есть).
type slotDTO struct {
	StartsAt string `json:"startsAt"`
	EndsAt   string `json:"endsAt"`
}

// getSlots запрашивает Слоты типа звонка и разбирает тело ответа.
func getSlots(t *testing.T, srv *http.Server, callTypeID string) (int, []slotDTO) {
	t.Helper()

	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/call-types/"+callTypeID+"/slots", nil))

	if rec.Code != http.StatusOK {
		return rec.Code, nil
	}
	var list struct {
		Items []slotDTO `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode slots: %v; body: %s", err, rec.Body.String())
	}
	return rec.Code, list.Items
}

// seedCallType создаёт Тип звонка через публичную ручку (fixture).
func seedCallType(t *testing.T, srv *http.Server, id string, durationMinutes int) {
	t.Helper()

	body := fmt.Sprintf(`{"id":%q,"name":"Звонок %s","description":"d","durationMinutes":%d}`, id, id, durationMinutes)
	if rec := postJSON(t, srv, "/api/call-types", body); rec.Code != http.StatusCreated {
		t.Fatalf("seed POST /api/call-types %s: status = %d, want %d; body: %s", id, rec.Code, http.StatusCreated, rec.Body.String())
	}
}

func TestListSlotsUnknownCallTypeReturns404(t *testing.T) {
	srv := newSlotsTestServer(t)

	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/call-types/ghost/slots", nil))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET /api/call-types/ghost/slots: status = %d, want %d; body: %s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
	var errBody api.ErrorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &errBody); err != nil {
		t.Fatalf("decode error body: %v; body: %s", err, rec.Body.String())
	}
	if errBody.Code != "call_type_not_found" {
		t.Errorf("error code = %q, want %q", errBody.Code, "call_type_not_found")
	}
	if errBody.Message == "" {
		t.Errorf("error message is empty")
	}
}

func TestListSlotsFullWindowGridFor15Minutes(t *testing.T) {
	srv := newSlotsTestServer(t)
	seedCallType(t, srv, "intro", 15)

	status, slots := getSlots(t, srv, "intro")
	if status != http.StatusOK {
		t.Fatalf("GET slots: status = %d, want %d", status, http.StatusOK)
	}

	// 36 стартов в день (9:00…17:45) × 14 дней Окна записи.
	if len(slots) != 36*14 {
		t.Fatalf("slots count = %d, want %d", len(slots), 36*14)
	}

	first, last := slots[0], slots[len(slots)-1]
	if first.StartsAt != "2026-11-05T09:00:00+03:00" {
		t.Errorf("first slot startsAt = %q, want %q", first.StartsAt, "2026-11-05T09:00:00+03:00")
	}
	if first.EndsAt != "2026-11-05T09:15:00+03:00" {
		t.Errorf("first slot endsAt = %q, want %q", first.EndsAt, "2026-11-05T09:15:00+03:00")
	}
	if last.StartsAt != "2026-11-18T17:45:00+03:00" {
		t.Errorf("last slot startsAt = %q, want %q", last.StartsAt, "2026-11-18T17:45:00+03:00")
	}
	if last.EndsAt != "2026-11-18T18:00:00+03:00" {
		t.Errorf("last slot endsAt = %q, want %q", last.EndsAt, "2026-11-18T18:00:00+03:00")
	}
}

func TestListSlotsGridEdgesByDuration(t *testing.T) {
	// Края из AC тикета #15: последний старт дня = конец Рабочих часов
	// минус Длительность звонка; сетка стартов — 15 минут от 9:00.
	cases := []struct {
		duration         int
		lastStart        string
		startsPerDay     int
		wantFirstDayLast string
	}{
		{duration: 45, lastStart: "17:15", startsPerDay: 34, wantFirstDayLast: "2026-11-05T17:15:00+03:00"},
		{duration: 30, lastStart: "17:30", startsPerDay: 35, wantFirstDayLast: "2026-11-05T17:30:00+03:00"},
		{duration: 15, lastStart: "17:45", startsPerDay: 36, wantFirstDayLast: "2026-11-05T17:45:00+03:00"},
	}

	for _, tc := range cases {
		t.Run(fmt.Sprintf("%d минут", tc.duration), func(t *testing.T) {
			srv := newSlotsTestServer(t)
			id := fmt.Sprintf("dur-%d", tc.duration)
			seedCallType(t, srv, id, tc.duration)

			status, slots := getSlots(t, srv, id)
			if status != http.StatusOK {
				t.Fatalf("GET slots: status = %d, want %d", status, http.StatusOK)
			}

			// Первый день Окна записи — 5 ноября 2026.
			var firstDay []slotDTO
			for _, s := range slots {
				if s.StartsAt[:10] == "2026-11-05" {
					firstDay = append(firstDay, s)
				}
			}
			if len(firstDay) != tc.startsPerDay {
				t.Fatalf("first day starts = %d, want %d", len(firstDay), tc.startsPerDay)
			}
			if got := firstDay[len(firstDay)-1].StartsAt; got != tc.wantFirstDayLast {
				t.Errorf("last start of day = %q, want %q (последний старт %s)", got, tc.wantFirstDayLast, tc.lastStart)
			}

			dayStart, _ := time.Parse(time.RFC3339, "2026-11-05T09:00:00+03:00")
			for _, s := range firstDay {
				start, err := time.Parse(time.RFC3339, s.StartsAt)
				if err != nil {
					t.Fatalf("parse startsAt %q: %v", s.StartsAt, err)
				}
				end, err := time.Parse(time.RFC3339, s.EndsAt)
				if err != nil {
					t.Fatalf("parse endsAt %q: %v", s.EndsAt, err)
				}

				// Слот длится ровно Длительность звонка.
				if got := end.Sub(start); got != time.Duration(tc.duration)*time.Minute {
					t.Errorf("slot %s length = %v, want %d minutes", s.StartsAt, got, tc.duration)
				}
				// Старт кратен 15 минутам от 9:00.
				if offset := start.Sub(dayStart); offset%(15*time.Minute) != 0 {
					t.Errorf("start %s is not on 15-minute grid from 09:00 (offset %v)", s.StartsAt, offset)
				}
			}
		})
	}
}

func TestListSlotsWindowBoundariesAndWeekends(t *testing.T) {
	srv := newSlotsTestServer(t)
	seedCallType(t, srv, "intro", 15)

	_, slots := getSlots(t, srv, "intro")

	days := map[string]int{}
	for _, s := range slots {
		days[s.StartsAt[:10]]++
	}

	// Окно записи: 5–18 ноября 2026 — 14 календарных дней со следующего дня.
	for day := 5; day <= 18; day++ {
		key := fmt.Sprintf("2026-11-%02d", day)
		if days[key] != 36 {
			t.Errorf("day %s: starts = %d, want 36", key, days[key])
		}
	}
	// Ни сегодня (4 ноября), ни через 15 дней (19 ноября) Слотов нет.
	for _, key := range []string{"2026-11-04", "2026-11-19"} {
		if days[key] != 0 {
			t.Errorf("day %s: starts = %d, want 0 (вне Окна записи)", key, days[key])
		}
	}
	// Выходные внутри Окна записи — 7 (суббота) и 8 (воскресенье) ноября —
	// с полной сеткой; уже покрыты проверкой «каждый день = 36», здесь —
	// явно, чтобы регрессия «выходные вырезаются» не прошла молча.
	if days["2026-11-07"] != 36 || days["2026-11-08"] != 36 {
		t.Errorf("weekend grids: 07=%d, 08=%d, want 36 и 36", days["2026-11-07"], days["2026-11-08"])
	}
}

// rfc3339WithOffset — ISO 8601 с обязательным явным смещением (не Z, не «голый» timestamp).
var rfc3339WithOffset = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$`)

func TestListSlotsExplicitOffsetInEveryTimestamp(t *testing.T) {
	srv := newSlotsTestServer(t)
	seedCallType(t, srv, "intro", 15)

	_, slots := getSlots(t, srv, "intro")
	if len(slots) == 0 {
		t.Fatal("no slots to check")
	}

	// Времена на границе API — ISO 8601 с явным смещением зоны
	// инстанса (Europe/Moscow; в ноябре — +03:00). Смещение берётся
	// из зоны, не хардкодом — здесь фиксируем ожидание для даты теста.
	for _, s := range slots {
		for name, v := range map[string]string{"startsAt": s.StartsAt, "endsAt": s.EndsAt} {
			if !rfc3339WithOffset.MatchString(v) {
				t.Errorf("%s %q: no explicit UTC offset", name, v)
			}
			if !strings.HasSuffix(v, "+03:00") {
				t.Errorf("%s %q: offset is not the Europe/Moscow one (+03:00)", name, v)
			}
		}
	}
}

func TestListSlotsGridsConsistentAcrossDurations(t *testing.T) {
	srv := newSlotsTestServer(t)
	seedCallType(t, srv, "short", 15)
	seedCallType(t, srv, "long", 45)

	_, shortSlots := getSlots(t, srv, "short")
	_, longSlots := getSlots(t, srv, "long")

	shortStarts := map[string]bool{}
	for _, s := range shortSlots {
		shortStarts[s.StartsAt] = true
	}
	for _, s := range longSlots {
		if !shortStarts[s.StartsAt] {
			t.Fatalf("start %q exists for 45-minute type but not for 15-minute: сетка 45 должна быть подмножеством сетки 15", s.StartsAt)
		}
	}
}
