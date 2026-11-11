package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServerServesEmbeddedFrontend(t *testing.T) {
	srv := newTestServer(t)

	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusOK {
		t.Errorf("GET /: status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body := rec.Body.String(); !strings.Contains(body, `id="root"`) {
		t.Errorf("GET /: body does not contain root div: %s", body)
	}
}

func TestServerHealthStaysJSON(t *testing.T) {
	srv := newTestServer(t)

	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if rec.Code != http.StatusOK {
		t.Errorf("GET /health: status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "application/json") {
		t.Errorf("GET /health: Content-Type = %q, want application/json", got)
	}
	if body := rec.Body.String(); !strings.Contains(body, `"status":"ok"`) {
		t.Errorf("GET /health: unexpected body: %s", body)
	}
}

func TestServerReturns404ForUnknownAPIRoutes(t *testing.T) {
	srv := newTestServer(t)

	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/nonexistent", nil))

	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /api/nonexistent: status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

// Сгенерированный роутинг паттернами Go 1.22 должен отличать методы,
// а не проваливать не-GET в SPA-фолбэк.
func TestServerRejectsNonGetHealth(t *testing.T) {
	srv := newTestServer(t)

	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/health", nil))

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST /health: status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}
