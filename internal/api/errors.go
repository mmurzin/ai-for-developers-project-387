package api

import (
	"encoding/json"
	"net/http"
)

// WriteError пишет тело ошибки контракта ErrorBody {code, message}
// с указанным статусом. Используется и хендлерами, и монтажом сервера
// для ошибок вне strict-типов (например, декодинг тела запроса).
func WriteError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(ErrorBody{Code: code, Message: message})
}
