package storage

import (
	"context"
	"path/filepath"
	"testing"
)

// newTestStore открывает throwaway-хранилище во временной папке.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open storage: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

// TestSeedDefaultCallTypesOnFreshDB: посев в пустую базу создаёт ровно
// два дефолтных Типа звонка с согласованными значениями (#26).
func TestSeedDefaultCallTypesOnFreshDB(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	if err := store.SeedDefaultCallTypes(ctx); err != nil {
		t.Fatalf("seed default call types: %v", err)
	}

	types, err := store.ListCallTypes(ctx)
	if err != nil {
		t.Fatalf("list call types: %v", err)
	}
	if len(types) != 2 {
		t.Fatalf("types count = %d, want 2; types: %+v", len(types), types)
	}

	byID := map[string]CallType{}
	for _, ct := range types {
		byID[ct.ID] = ct
	}
	want := map[string]CallType{
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
	for id, w := range want {
		if got := byID[id]; got != w {
			t.Errorf("call type %q = %+v, want %+v", id, got, w)
		}
	}
}

// TestSeedDefaultCallTypesSkipsNonEmptyDB: если у Владельца уже есть
// хоть один Тип звонка, посев ничего не добавляет (#26).
func TestSeedDefaultCallTypesSkipsNonEmptyDB(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	custom := CallType{ID: "custom", Name: "Свой тип", Description: "Создан Владельцем", DurationMinutes: 20}
	if err := store.CreateCallType(ctx, custom); err != nil {
		t.Fatalf("create custom call type: %v", err)
	}

	if err := store.SeedDefaultCallTypes(ctx); err != nil {
		t.Fatalf("seed default call types: %v", err)
	}

	types, err := store.ListCallTypes(ctx)
	if err != nil {
		t.Fatalf("list call types: %v", err)
	}
	if len(types) != 1 || types[0] != custom {
		t.Fatalf("types = %+v, want only %+v", types, custom)
	}
}

// TestSeedDefaultCallTypesIdempotent: повторный посев не плодит дубли (#26).
func TestSeedDefaultCallTypesIdempotent(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	for range 2 {
		if err := store.SeedDefaultCallTypes(ctx); err != nil {
			t.Fatalf("seed default call types: %v", err)
		}
	}

	types, err := store.ListCallTypes(ctx)
	if err != nil {
		t.Fatalf("list call types: %v", err)
	}
	if len(types) != 2 {
		t.Fatalf("types count after double seed = %d, want 2; types: %+v", len(types), types)
	}
}
