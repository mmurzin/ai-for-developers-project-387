package smoke_test

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestAppStartup(t *testing.T) {
	base := startTestServer(t)

	resp, err := http.Get(base + "/health")
	if err != nil {
		t.Fatalf("get health: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}

	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Status != "ok" {
		t.Fatalf("expected status ok, got %q", body.Status)
	}

	rootResp, err := http.Get(base + "/")
	if err != nil {
		t.Fatalf("get root: %v", err)
	}
	defer func() { _ = rootResp.Body.Close() }()

	if rootResp.StatusCode != http.StatusOK {
		t.Fatalf("expected root status 200, got %d", rootResp.StatusCode)
	}
	if got := rootResp.Header.Get("Content-Type"); !strings.Contains(got, "text/html") {
		t.Fatalf("expected root Content-Type text/html, got %q", got)
	}
	html, err := io.ReadAll(rootResp.Body)
	if err != nil {
		t.Fatalf("read root body: %v", err)
	}
	if !strings.Contains(string(html), `id="root"`) {
		t.Fatalf("root body does not contain root div: %s", html)
	}
}

// callType — поля Типа звонка из ответа API (подмножество контракта).
type callType struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	DurationMinutes int32  `json:"durationMinutes"`
}

// TestDefaultCallTypesSeededOnStartup: на чистой базе настоящий бинарь
// стартует с двумя дефолтными Типами звонка — демо-стенд после вайпа
// не требует ручного создания типов (#26).
func TestDefaultCallTypesSeededOnStartup(t *testing.T) {
	base := startTestServer(t)

	resp, err := http.Get(base + "/api/call-types")
	if err != nil {
		t.Fatalf("get call types: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}

	var body struct {
		Items []callType `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	byID := map[string]callType{}
	for _, ct := range body.Items {
		byID[ct.ID] = ct
	}
	want := map[string]callType{
		"intro": {
			ID:              "intro",
			Name:            "Интро-звонок",
			Description:     "Короткий созвон на 15 минут",
			DurationMinutes: 15,
		},
		"consult": {
			ID:              "consult",
			Name:            "Консультация",
			Description:     "Консультация на 30 минут",
			DurationMinutes: 30,
		},
	}
	if len(body.Items) != len(want) {
		t.Fatalf("items count = %d, want %d; items: %+v", len(body.Items), len(want), body.Items)
	}
	for id, w := range want {
		if got := byID[id]; got != w {
			t.Errorf("call type %q = %+v, want %+v", id, got, w)
		}
	}
}

// startTestServer собирает бинарь, поднимает его на случайном свободном
// порту со throwaway-базой во временной папке, ждёт healthcheck и
// возвращает базовый URL.
func startTestServer(t *testing.T) string {
	t.Helper()

	_, thisFile, _, _ := runtime.Caller(0)
	root := filepath.Dir(filepath.Dir(filepath.Dir(thisFile)))

	bin := filepath.Join(t.TempDir(), "server")

	build := exec.Command("go", "build", "-o", bin, "./cmd/server")
	build.Dir = root
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build server: %v\n%s", err, out)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()

	app := exec.Command(bin)
	app.Env = append(app.Env,
		"PORT="+strconv.Itoa(port),
		"DB_PATH="+filepath.Join(t.TempDir(), "smoke.db"),
	)
	if err := app.Start(); err != nil {
		t.Fatalf("start server: %v", err)
	}
	t.Cleanup(func() {
		_ = app.Process.Kill()
		_ = app.Wait()
	})

	base := "http://127.0.0.1:" + strconv.Itoa(port)
	resp, err := pollHealth(base+"/health", 3*time.Second)
	if err != nil {
		t.Fatalf("server did not become healthy: %v", err)
	}
	_ = resp.Body.Close()
	return base
}

func pollHealth(url string, timeout time.Duration) (*http.Response, error) {
	deadline := time.Now().Add(timeout)
	for {
		resp, err := http.Get(url)
		if err == nil {
			if resp.StatusCode == http.StatusOK {
				return resp, nil
			}
			_ = resp.Body.Close()
		}
		if time.Now().After(deadline) {
			return nil, errors.New("deadline exceeded")
		}
		time.Sleep(100 * time.Millisecond)
	}
}
