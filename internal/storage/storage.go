// Package storage — SQLite-хранилище доменных данных (ADR-0001):
// pure-Go драйвер modernc.org/sqlite, один файл базы, прагмы в DSN.
package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// ErrDuplicate — семантическая ошибка «запись с таким идентификатором уже есть».
// Хендлеры API маппят её в 409, не зная кодов SQLite.
var ErrDuplicate = errors.New("duplicate id")

// ErrNotFound — семантическая ошибка «объект не найден».
// Хендлеры API маппят её в 404.
var ErrNotFound = errors.New("not found")

// ErrConflict — семантическая ошибка «время пересекается с активной
// Записью». Хендлеры API маппят её в 409, не зная деталей проверки.
var ErrConflict = errors.New("time slot conflict")

// CallType — Тип звонка: параметры, которые задаёт Владелец страницы (GLOSSARY.md).
type CallType struct {
	ID              string
	Name            string
	Description     string
	DurationMinutes int32
}

// Call — Запись: забронированный Звонок Гостя (GLOSSARY.md).
// Времена в памяти — time.Time; на диске — TEXT в UTC (RFC 3339),
// нормализация — в formatUTC при записи.
type Call struct {
	ID           int64
	CallTypeID   string
	StartsAt     time.Time
	EndsAt       time.Time
	GuestName    string
	GuestContact string
}

// Store — хранилище поверх одного файла SQLite.
// DSN уже содержит _txlock=immediate: BeginTx берёт писательский лок сразу,
// поэтому будущие «прочитать-проверить-записать» (бронь Слота, #16)
// атомарны без изменения сетапа.
type Store struct {
	db *sql.DB
}

// schema — миграция при каждом Open: идемпотентная, без внешних либ.
const schema = `
CREATE TABLE IF NOT EXISTS call_types (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 5 AND duration_minutes <= 240)
);
CREATE TABLE IF NOT EXISTS calls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  call_type_id  TEXT NOT NULL REFERENCES call_types(id),
  starts_at     TEXT NOT NULL,
  ends_at       TEXT NOT NULL,
  guest_name    TEXT NOT NULL,
  guest_contact TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calls_starts ON calls(starts_at, ends_at);
`

// Open открывает (или создаёт) базу по пути и накатывает миграцию.
func Open(path string) (*Store, error) {
	// busy_timeout — ждать лок до 5с вместо мгновенного SQLITE_BUSY;
	// WAL — читатели не блокируют писателя; foreign_keys — целостность
	// будущих ссылок (Записи → Типы звонков); см. ADR-0001 и заметки к #14.
	dsn := fmt.Sprintf(
		"file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_txlock=immediate",
		path,
	)

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite %s: %w", path, err)
	}
	if err := db.PingContext(context.Background()); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite %s: %w", path, err)
	}
	if _, err := db.ExecContext(context.Background(), schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate sqlite %s: %w", path, err)
	}

	return &Store{db: db}, nil
}

// Close закрывает базу.
func (s *Store) Close() error {
	return s.db.Close()
}

// CreateCallType сохраняет новый Тип звонка.
// Дубликат идентификатора — ErrDuplicate; прочее — обёрнутая ошибка драйвера.
func (s *Store) CreateCallType(ctx context.Context, ct CallType) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO call_types (id, name, description, duration_minutes) VALUES (?, ?, ?, ?)`,
		ct.ID, ct.Name, ct.Description, ct.DurationMinutes,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrDuplicate
		}
		return fmt.Errorf("insert call type %q: %w", ct.ID, err)
	}
	return nil
}

// GetCallType возвращает Тип звонка по идентификатору.
// Отсутствие — ErrNotFound; прочее — обёрнутая ошибка драйвера.
func (s *Store) GetCallType(ctx context.Context, id string) (CallType, error) {
	var ct CallType
	err := s.db.QueryRowContext(ctx,
		`SELECT id, name, description, duration_minutes FROM call_types WHERE id = ?`, id,
	).Scan(&ct.ID, &ct.Name, &ct.Description, &ct.DurationMinutes)
	if errors.Is(err, sql.ErrNoRows) {
		return CallType{}, ErrNotFound
	}
	if err != nil {
		return CallType{}, fmt.Errorf("select call type %q: %w", id, err)
	}
	return ct, nil
}

// ListCallTypes возвращает все Типы звонков, отсортированные по идентификатору.
func (s *Store) ListCallTypes(ctx context.Context) ([]CallType, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, description, duration_minutes FROM call_types ORDER BY id`,
	)
	if err != nil {
		return nil, fmt.Errorf("select call types: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var types []CallType
	for rows.Next() {
		var ct CallType
		if err := rows.Scan(&ct.ID, &ct.Name, &ct.Description, &ct.DurationMinutes); err != nil {
			return nil, fmt.Errorf("scan call type: %w", err)
		}
		types = append(types, ct)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate call types: %w", err)
	}
	return types, nil
}

// defaultCallTypes — дефолтные Типы звонка демо-стенда: после вайпа
// эфемерной базы сервер восстанавливает их посевом (seed-if-empty, #26).
var defaultCallTypes = []CallType{
	{ID: "intro", Name: "Интро-звонок", Description: "Короткий созвон на 15 минут", DurationMinutes: 15},
	{ID: "consult", Name: "Консультация", Description: "Консультация на 30 минут", DurationMinutes: 30},
}

// SeedDefaultCallTypes создаёт дефолтные Типы звонка, только если таблица
// пуста: свежая база сразу получает рабочие типы, существующие данные
// Владельца не затрагиваются; повторный вызов — no-op (#26). Проверка
// пустоты и вставки — одна транзакция: сбой не оставляет частичный посев.
// Если Владелец когда-нибудь удалит все Типы, посев при следующем старте
// повторится (семантика «сеять в пустоту»).
func (s *Store) SeedDefaultCallTypes(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin seed tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }() // no-op после Commit

	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM call_types`).Scan(&count); err != nil {
		return fmt.Errorf("count call types: %w", err)
	}
	if count > 0 {
		return nil // откат пустой транзакции — в defer
	}

	for _, ct := range defaultCallTypes {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO call_types (id, name, description, duration_minutes) VALUES (?, ?, ?, ?)`,
			ct.ID, ct.Name, ct.Description, ct.DurationMinutes,
		); err != nil {
			return fmt.Errorf("seed call type %q: %w", ct.ID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit seed tx: %w", err)
	}
	return nil
}

// isUniqueViolation отличает нарушение уникальности PRIMARY KEY (1555)
// от обычного UNIQUE-индекса (2067); sentinel-ошибок в modernc.org/sqlite
// v1.61.x нет — только *sqlite.Error с кодом (заметки к #14).
func isUniqueViolation(err error) bool {
	var se *sqlite.Error
	if !errors.As(err, &se) {
		return false
	}
	return se.Code() == sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY ||
		se.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE
}

// formatUTC — канонический TEXT-вид времени в базе: RFC 3339 в UTC.
// Единый формат делает лексикографический порядок строк хронологическим,
// поэтому пересечения полуоткрытых интервалов ищутся сравнением строк.
func formatUTC(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

// CreateCall атомарно бронирует Запись: транзакция сразу берёт
// писательский лок (_txlock=immediate в DSN), внутри неё — COUNT
// пересечений с активными Записями и INSERT. Пересечение с Записью
// любого Типа звонка — ErrConflict: интервалы полуоткрытые
// [начало, конец), примыкание («конец в 11:00 / начало в 11:00»)
// пересечением не считается. При одновременных бронях одного времени
// проходит ровно одна — остальные ждут лока и видят её в COUNT.
func (s *Store) CreateCall(ctx context.Context, call Call) (Call, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Call{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Пересечение [aStart, aEnd) с [bStart, bEnd):
	// aStart < bEnd AND aEnd > bStart (заметки к #16, §5).
	var overlapping int
	err = tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM calls WHERE starts_at < ? AND ends_at > ?`,
		formatUTC(call.EndsAt), formatUTC(call.StartsAt),
	).Scan(&overlapping)
	if err != nil {
		return Call{}, fmt.Errorf("count overlapping calls: %w", err)
	}
	if overlapping > 0 {
		return Call{}, ErrConflict
	}

	res, err := tx.ExecContext(ctx,
		`INSERT INTO calls (call_type_id, starts_at, ends_at, guest_name, guest_contact)
		 VALUES (?, ?, ?, ?, ?)`,
		call.CallTypeID, formatUTC(call.StartsAt), formatUTC(call.EndsAt),
		call.GuestName, call.GuestContact,
	)
	if err != nil {
		return Call{}, fmt.Errorf("insert call: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Call{}, fmt.Errorf("insert call id: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Call{}, fmt.Errorf("commit call: %w", err)
	}

	call.ID = id
	return call, nil
}

// callsColumns — список колонок Записи в списочных SELECT;
// порядок обязан совпадать с порядком чтения в scanCalls.
const callsColumns = "id, call_type_id, starts_at, ends_at, guest_name, guest_contact"

// ListUpcomingCalls возвращает Записи, ещё не начавшиеся к моменту
// from: граница «предстоящего» — starts_at >= from (начавшаяся Запись,
// даже не закончившаяся, предстоящей уже не считается). Порядок —
// по возрастанию начала.
func (s *Store) ListUpcomingCalls(ctx context.Context, from time.Time) ([]Call, error) {
	rows, err := s.db.QueryContext(ctx,
		fmt.Sprintf(`SELECT %s FROM calls WHERE starts_at >= ? ORDER BY starts_at`, callsColumns),
		formatUTC(from),
	)
	if err != nil {
		return nil, fmt.Errorf("select upcoming calls: %w", err)
	}
	return scanCalls(rows)
}

// ListCallsInRange возвращает активные Записи, чей интервал
// [начало, конец) пересекается с [from, to). Порядок — по началу.
// Нужна для вычета занятости из computed-Слотов.
func (s *Store) ListCallsInRange(ctx context.Context, from, to time.Time) ([]Call, error) {
	rows, err := s.db.QueryContext(ctx,
		fmt.Sprintf(`SELECT %s FROM calls WHERE starts_at < ? AND ends_at > ? ORDER BY starts_at`, callsColumns),
		formatUTC(to), formatUTC(from),
	)
	if err != nil {
		return nil, fmt.Errorf("select calls in range: %w", err)
	}
	return scanCalls(rows)
}

// scanCalls читает результат списочного SELECT Записей: единое место
// порядка колонок (callsColumns), разбора RFC 3339 и rows.Err для
// всех списочных запросов Записей.
func scanCalls(rows *sql.Rows) ([]Call, error) {
	defer func() { _ = rows.Close() }()

	var calls []Call
	for rows.Next() {
		var call Call
		var startsAt, endsAt string
		if err := rows.Scan(&call.ID, &call.CallTypeID, &startsAt, &endsAt,
			&call.GuestName, &call.GuestContact); err != nil {
			return nil, fmt.Errorf("scan call: %w", err)
		}
		start, err := time.Parse(time.RFC3339, startsAt)
		if err != nil {
			return nil, fmt.Errorf("parse starts_at %q: %w", startsAt, err)
		}
		end, err := time.Parse(time.RFC3339, endsAt)
		if err != nil {
			return nil, fmt.Errorf("parse ends_at %q: %w", endsAt, err)
		}
		call.StartsAt, call.EndsAt = start, end
		calls = append(calls, call)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate calls: %w", err)
	}
	return calls, nil
}
