/** Index i upgrades a database from user_version i to i+1. Append only — never edit a shipped entry. */
export const MIGRATIONS: readonly string[] = [
  /* sql */ `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  CREATE TABLE imports (
    id              TEXT PRIMARY KEY,
    filename        TEXT NOT NULL,
    mime            TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL,
    sha256          TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('processing', 'done', 'error')),
    document_kind   TEXT,
    source_language TEXT,
    institution     TEXT,
    summary         TEXT,                        -- JSON LocalizedText
    warnings        TEXT NOT NULL DEFAULT '[]',  -- JSON LocalizedText[]
    tx_count        INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    provider        TEXT,
    model           TEXT,
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0,
    error           TEXT,
    created_at      TEXT NOT NULL
  ) STRICT;
  CREATE INDEX imports_sha256 ON imports (sha256);

  -- The original bytes, so an import can be re-run with another model.
  CREATE TABLE import_files (
    import_id TEXT PRIMARY KEY REFERENCES imports (id) ON DELETE CASCADE,
    content   BLOB NOT NULL
  ) STRICT;

  CREATE TABLE transactions (
    id                TEXT PRIMARY KEY,
    date              TEXT NOT NULL,
    raw_description   TEXT NOT NULL,
    title             TEXT NOT NULL,             -- JSON LocalizedText
    merchant          TEXT,
    merchant_key      TEXT,                      -- normalised merchant: rules, grouping, recurrence
    amount_minor      INTEGER NOT NULL,
    currency          TEXT NOT NULL,
    base_amount_minor INTEGER,
    category_id       TEXT NOT NULL,
    root_category_id  TEXT NOT NULL,
    kind              TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
    confidence        REAL NOT NULL DEFAULT 1,
    needs_review      INTEGER NOT NULL DEFAULT 0,
    recurring         INTEGER NOT NULL DEFAULT 0,
    account           TEXT,
    note              TEXT,                      -- JSON LocalizedText
    import_id         TEXT REFERENCES imports (id) ON DELETE CASCADE,
    source            TEXT NOT NULL CHECK (source IN ('import', 'manual', 'demo')),
    fingerprint       TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  ) STRICT;
  CREATE INDEX transactions_date ON transactions (date);
  CREATE INDEX transactions_kind_date ON transactions (kind, date);
  CREATE INDEX transactions_root_date ON transactions (root_category_id, date);
  CREATE INDEX transactions_merchant ON transactions (merchant_key);
  CREATE INDEX transactions_import ON transactions (import_id);
  CREATE UNIQUE INDEX transactions_fingerprint ON transactions (fingerprint);

  -- Full-text search over the original line, the merchant, and the title and note in every language.
  CREATE VIRTUAL TABLE transactions_fts USING fts5 (
    body,
    content = '',
    contentless_delete = 1,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER transactions_fts_insert AFTER INSERT ON transactions BEGIN
    INSERT INTO transactions_fts (rowid, body) VALUES (
      new.rowid,
      new.raw_description || ' ' || coalesce(new.merchant, '') || ' ' ||
      coalesce((SELECT group_concat(value, ' ') FROM json_each(new.title)), '') || ' ' ||
      coalesce((SELECT group_concat(value, ' ') FROM json_each(new.note)), '')
    );
  END;
  CREATE TRIGGER transactions_fts_delete AFTER DELETE ON transactions BEGIN
    DELETE FROM transactions_fts WHERE rowid = old.rowid;
  END;
  CREATE TRIGGER transactions_fts_update AFTER UPDATE OF raw_description, merchant, title, note ON transactions BEGIN
    DELETE FROM transactions_fts WHERE rowid = old.rowid;
    INSERT INTO transactions_fts (rowid, body) VALUES (
      new.rowid,
      new.raw_description || ' ' || coalesce(new.merchant, '') || ' ' ||
      coalesce((SELECT group_concat(value, ' ') FROM json_each(new.title)), '') || ' ' ||
      coalesce((SELECT group_concat(value, ' ') FROM json_each(new.note)), '')
    );
  END;

  -- "Always file this merchant under that category", learned from the user's corrections.
  CREATE TABLE rules (
    id          TEXT PRIMARY KEY,
    pattern     TEXT NOT NULL UNIQUE,
    category_id TEXT NOT NULL,
    hits        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  ) STRICT;

  -- Daily ECB reference rates: 1 base = rate quote.
  CREATE TABLE fx_rates (
    date  TEXT NOT NULL,
    base  TEXT NOT NULL,
    quote TEXT NOT NULL,
    rate  REAL NOT NULL,
    PRIMARY KEY (date, base, quote)
  ) STRICT;

  CREATE TABLE insights (
    month      TEXT PRIMARY KEY,
    data       TEXT NOT NULL,                    -- JSON Insight
    created_at TEXT NOT NULL
  ) STRICT;
  `,

  // v2 — itemised receipts: one row per receipt line, each with its own category.
  /* sql */ `
  CREATE TABLE transaction_items (
    id                TEXT PRIMARY KEY,
    transaction_id    TEXT NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    position          INTEGER NOT NULL,
    description       TEXT NOT NULL,
    title             TEXT NOT NULL,             -- JSON LocalizedText
    quantity          REAL,
    amount_minor      INTEGER NOT NULL,
    base_amount_minor INTEGER,
    category_id       TEXT NOT NULL,
    root_category_id  TEXT NOT NULL,
    adjustment        INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE INDEX transaction_items_tx ON transaction_items (transaction_id, position);
  CREATE INDEX transaction_items_root ON transaction_items (root_category_id);

  -- What category analytics add up: the items of an itemised transaction, the transaction itself otherwise.
  CREATE VIEW spend_lines AS
    SELECT t.id AS transaction_id, NULL AS item_id, t.date, t.kind, t.category_id, t.root_category_id,
           t.amount_minor, t.base_amount_minor
    FROM transactions t
    WHERE NOT EXISTS (SELECT 1 FROM transaction_items i WHERE i.transaction_id = t.id)
    UNION ALL
    SELECT t.id, i.id, t.date, t.kind, i.category_id, i.root_category_id, i.amount_minor, i.base_amount_minor
    FROM transaction_items i JOIN transactions t ON t.id = i.transaction_id;

  -- Search also finds a receipt by its items ("pannolini" → the supermarket receipt).
  DROP TRIGGER transactions_fts_insert;
  DROP TRIGGER transactions_fts_update;
  CREATE VIEW transactions_fts_source AS
    SELECT t.rowid AS rowid, t.id AS id,
      t.raw_description || ' ' || coalesce(t.merchant, '') || ' ' ||
      coalesce((SELECT group_concat(value, ' ') FROM json_each(t.title)), '') || ' ' ||
      coalesce((SELECT group_concat(value, ' ') FROM json_each(t.note)), '') || ' ' ||
      coalesce((SELECT group_concat(i.description || ' ' || (SELECT group_concat(value, ' ') FROM json_each(i.title)), ' ')
                FROM transaction_items i WHERE i.transaction_id = t.id), '') AS body
    FROM transactions t;
  CREATE TRIGGER transactions_fts_insert AFTER INSERT ON transactions BEGIN
    INSERT INTO transactions_fts (rowid, body) SELECT rowid, body FROM transactions_fts_source WHERE id = new.id;
  END;
  CREATE TRIGGER transactions_fts_update AFTER UPDATE OF raw_description, merchant, title, note ON transactions BEGIN
    DELETE FROM transactions_fts WHERE rowid = old.rowid;
    INSERT INTO transactions_fts (rowid, body) SELECT rowid, body FROM transactions_fts_source WHERE id = new.id;
  END;
  CREATE TRIGGER transaction_items_fts_insert AFTER INSERT ON transaction_items BEGIN
    DELETE FROM transactions_fts WHERE rowid = (SELECT rowid FROM transactions WHERE id = new.transaction_id);
    INSERT INTO transactions_fts (rowid, body) SELECT rowid, body FROM transactions_fts_source WHERE id = new.transaction_id;
  END;
  CREATE TRIGGER transaction_items_fts_delete AFTER DELETE ON transaction_items BEGIN
    DELETE FROM transactions_fts WHERE rowid = (SELECT rowid FROM transactions WHERE id = old.transaction_id);
    INSERT INTO transactions_fts (rowid, body) SELECT rowid, body FROM transactions_fts_source WHERE id = old.transaction_id;
  END;
  CREATE TRIGGER transaction_items_fts_update AFTER UPDATE OF description, title ON transaction_items BEGIN
    DELETE FROM transactions_fts WHERE rowid = (SELECT rowid FROM transactions WHERE id = new.transaction_id);
    INSERT INTO transactions_fts (rowid, body) SELECT rowid, body FROM transactions_fts_source WHERE id = new.transaction_id;
  END;
  `,

  // v3 — the identity a document prints for a payment: a receipt's or invoice's number and time, a
  // statement's transaction ID. The same receipt photographed twice, or scanned after being
  // photographed, is the same row: the database refuses the second copy.
  /* sql */ `
  ALTER TABLE transactions ADD COLUMN reference TEXT;
  ALTER TABLE transactions ADD COLUMN ref_time TEXT;
  CREATE UNIQUE INDEX transactions_reference ON transactions (date, amount_minor, currency, reference) WHERE reference IS NOT NULL;
  `,

  // v4 — fixed costs the user states or rules out, next to the ones detected from the history.
  // fixed: a charge declared by the user (rent from the first month, before three payments exist);
  // ignored: a detected pattern that is not a fixed cost. One rule per merchant.
  /* sql */ `
  CREATE TABLE recurring_rules (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('fixed', 'ignored')),
    merchant     TEXT NOT NULL,
    merchant_key TEXT NOT NULL UNIQUE,
    category_id  TEXT,
    amount_minor INTEGER,                        -- fixed: the expected charge, positive, base currency
    cadence_days INTEGER,                        -- fixed: 7, 14, 30, 61, 91 or 365
    anchor_date  TEXT,                           -- fixed: one charge date; the others follow from it
    created_at   TEXT NOT NULL
  ) STRICT;
  `,

  // v5 — a declared fixed cost keeps its own currency (a subscription billed in USD); the amount is
  // converted to the base when shown. Declarations made so far were in the base currency.
  /* sql */ `
  ALTER TABLE recurring_rules ADD COLUMN currency TEXT;
  UPDATE recurring_rules
     SET currency = coalesce((SELECT json_extract(value, '$') FROM settings WHERE key = 'baseCurrency'), 'EUR')
   WHERE kind = 'fixed';
  `,
];
