package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func assertServesIndex(t *testing.T, urlPath string) {
	t.Helper()

	rec := httptest.NewRecorder()
	Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, urlPath, nil))

	if rec.Code != http.StatusOK {
		t.Errorf("GET %s: status = %d, want %d", urlPath, rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "text/html") {
		t.Errorf("GET %s: Content-Type = %q, want text/html", urlPath, got)
	}
	if body := rec.Body.String(); !strings.Contains(body, `id="root"`) {
		t.Errorf("GET %s: body does not contain root div: %s", urlPath, body)
	}
}

func TestHandlerServesIndexAtRoot(t *testing.T) {
	assertServesIndex(t, "/")
}

func TestHandlerFallsBackToIndexForClientRoutes(t *testing.T) {
	assertServesIndex(t, "/booking/15")
}

func TestHandlerReturns404ForMissingAssets(t *testing.T) {
	rec := httptest.NewRecorder()
	Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/missing.js", nil))

	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /assets/missing.js: status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestHandlerReturns404ForDirectoryListings(t *testing.T) {
	rec := httptest.NewRecorder()
	Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/", nil))

	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /assets/: status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}
