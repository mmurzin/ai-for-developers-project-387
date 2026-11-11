package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mmurzin/ai-for-developers-project-387/internal/api"
	"github.com/mmurzin/ai-for-developers-project-387/internal/storage"
)

// newTestServer собирает сервер с throwaway SQLite-хранилищем во временной папке.
func newTestServer(t *testing.T) *http.Server {
	t.Helper()
	return newTestServerAtPath(t, filepath.Join(t.TempDir(), "test.db"))
}

// newTestServerAtPath собирает сервер с базой по конкретному пути
// (для проверки персистентности между «рестартами»).
func newTestServerAtPath(t *testing.T, dbPath string) *http.Server {
	t.Helper()
	return newTestServerAtClock(t, dbPath, time.Now)
}

// newTestServerAtClock собирает сервер с фиксированными часами:
// поведение, зависящее от времени (Слоты), становится детерминированным.
func newTestServerAtClock(t *testing.T, dbPath string, now func() time.Time) *http.Server {
	t.Helper()

	store, err := storage.Open(dbPath)
	if err != nil {
		t.Fatalf("open storage: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	return NewServer(":0", store, now)
}

func postJSON(t *testing.T, srv *http.Server, url, body string) *httptest.ResponseRecorder {
	t.Helper()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.Handler.ServeHTTP(rec, req)

	return rec
}

func TestListCallTypesReturnsCreatedTypes(t *testing.T) {
	srv := newTestServer(t)

	for _, body := range []string{
		`{"id":"intro","name":"Интро-звонок","description":"Знакомство","durationMinutes":15}`,
		`{"id":"deep-dive","name":"Разбор","description":"Глубокий разбор","durationMinutes":60}`,
	} {
		if rec := postJSON(t, srv, "/api/call-types", body); rec.Code != http.StatusCreated {
			t.Fatalf("seed POST /api/call-types: status = %d, want %d; body: %s", rec.Code, http.StatusCreated, rec.Body.String())
		}
	}

	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/call-types", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/call-types: status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var list struct {
		Items []api.CallType `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode response: %v; body: %s", err, rec.Body.String())
	}
	if len(list.Items) != 2 {
		t.Fatalf("items count = %d, want 2; body: %s", len(list.Items), rec.Body.String())
	}
	byID := map[string]api.CallType{}
	for _, ct := range list.Items {
		byID[ct.Id] = ct
	}
	if intro := byID["intro"]; intro.Name != "Интро-звонок" || intro.DurationMinutes != 15 {
		t.Errorf("intro = %+v, want name %q and duration 15", intro, "Интро-звонок")
	}
	if dive := byID["deep-dive"]; dive.Name != "Разбор" || dive.DurationMinutes != 60 {
		t.Errorf("deep-dive = %+v, want name %q and duration 60", dive, "Разбор")
	}
}

func TestListCallTypesIsEmptyInitially(t *testing.T) {
	srv := newTestServer(t)

	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/call-types", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/call-types: status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body := rec.Body.String(); !strings.Contains(body, `"items":[]`) && !strings.Contains(body, `"items":null`) {
		t.Fatalf("expected empty items, got: %s", body)
	}
}

func TestCallTypesSurviveServerRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "restart.db")

	first := newTestServerAtPath(t, dbPath)
	if rec := postJSON(t, first, "/api/call-types",
		`{"id":"intro","name":"Интро-звонок","description":"Знакомство","durationMinutes":15}`); rec.Code != http.StatusCreated {
		t.Fatalf("seed POST /api/call-types: status = %d, want %d", rec.Code, http.StatusCreated)
	}

	// Новый процесс сервера на том же файле базы — данные должны пережить рестарт.
	second := newTestServerAtPath(t, dbPath)
	rec := httptest.NewRecorder()
	second.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/call-types", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/call-types after restart: status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body := rec.Body.String(); !strings.Contains(body, `"id":"intro"`) {
		t.Fatalf("call type did not survive restart; body: %s", body)
	}
}

func TestCreateCallTypeDuplicateReturns409(t *testing.T) {
	srv := newTestServer(t)

	body := `{"id":"intro","name":"Интро-звонок","description":"Знакомство","durationMinutes":15}`
	if rec := postJSON(t, srv, "/api/call-types", body); rec.Code != http.StatusCreated {
		t.Fatalf("first POST: status = %d, want %d; body: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	rec := postJSON(t, srv, "/api/call-types", body)

	if rec.Code != http.StatusConflict {
		t.Fatalf("second POST: status = %d, want %d; body: %s", rec.Code, http.StatusConflict, rec.Body.String())
	}
	var errBody api.ErrorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &errBody); err != nil {
		t.Fatalf("decode error body: %v; body: %s", err, rec.Body.String())
	}
	if errBody.Code != "duplicate_id" {
		t.Errorf("error code = %q, want %q", errBody.Code, "duplicate_id")
	}
	if errBody.Message == "" {
		t.Errorf("error message is empty")
	}
}

func TestCreateCallTypeValidation(t *testing.T) {
	cases := []struct {
		name       string
		body       string
		wantStatus int
		wantCode   string
	}{
		{
			name:       "empty id",
			body:       `{"id":"","name":"Интро","description":"d","durationMinutes":15}`,
			wantStatus: http.StatusUnprocessableEntity,
			wantCode:   "empty_id",
		},
		{
			name:       "empty name",
			body:       `{"id":"intro","name":"","description":"d","durationMinutes":15}`,
			wantStatus: http.StatusUnprocessableEntity,
			wantCode:   "empty_name",
		},
		{
			name:       "duration below range",
			body:       `{"id":"intro","name":"Интро","description":"d","durationMinutes":4}`,
			wantStatus: http.StatusUnprocessableEntity,
			wantCode:   "duration_out_of_range",
		},
		{
			name:       "duration above range",
			body:       `{"id":"intro","name":"Интро","description":"d","durationMinutes":241}`,
			wantStatus: http.StatusUnprocessableEntity,
			wantCode:   "duration_out_of_range",
		},
		{
			name:       "non-integer duration",
			body:       `{"id":"intro","name":"Интро","description":"d","durationMinutes":12.5}`,
			wantStatus: http.StatusUnprocessableEntity,
			wantCode:   "invalid_field_type",
		},
		{
			name:       "malformed json",
			body:       `{"id":"intro", broken`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "malformed_json",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := newTestServer(t)

			rec := postJSON(t, srv, "/api/call-types", tc.body)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body: %s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "application/json") {
				t.Errorf("Content-Type = %q, want application/json", got)
			}
			var errBody api.ErrorBody
			if err := json.Unmarshal(rec.Body.Bytes(), &errBody); err != nil {
				t.Fatalf("decode error body: %v; body: %s", err, rec.Body.String())
			}
			if errBody.Code != tc.wantCode {
				t.Errorf("error code = %q, want %q", errBody.Code, tc.wantCode)
			}
			if errBody.Message == "" {
				t.Errorf("error message is empty")
			}
		})
	}
}

func TestCreateCallTypeReturns201WithCreatedType(t *testing.T) {
	srv := newTestServer(t)

	rec := postJSON(t, srv, "/api/call-types",
		`{"id":"intro","name":"Интро-звонок","description":"Знакомство и обсуждение задач","durationMinutes":15}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /api/call-types: status = %d, want %d; body: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var created api.CallType
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode response: %v; body: %s", err, rec.Body.String())
	}
	if created.Id != "intro" {
		t.Errorf("id = %q, want %q", created.Id, "intro")
	}
	if created.Name != "Интро-звонок" {
		t.Errorf("name = %q, want %q", created.Name, "Интро-звонок")
	}
	if created.Description != "Знакомство и обсуждение задач" {
		t.Errorf("description = %q, want %q", created.Description, "Знакомство и обсуждение задач")
	}
	if created.DurationMinutes != 15 {
		t.Errorf("durationMinutes = %d, want 15", created.DurationMinutes)
	}
}
