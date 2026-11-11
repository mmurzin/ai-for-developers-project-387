package web

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

func Handler() http.Handler {
	files, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic("web: embedded dist is missing: " + err.Error())
	}

	fileServer := http.FileServerFS(files)
	index, err := fs.ReadFile(files, "index.html")
	if err != nil {
		panic("web: embedded dist has no index.html: " + err.Error())
	}

	serveIndex := func(w http.ResponseWriter) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(index)
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			serveIndex(w)
			return
		}

		if info, err := fs.Stat(files, path.Clean(name)); err == nil {
			if info.IsDir() {
				http.NotFound(w, r)
				return
			}
			fileServer.ServeHTTP(w, r)
			return
		}

		if path.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}

		serveIndex(w)
	})
}
