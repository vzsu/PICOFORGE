-- Migration 0003: settings rows written by the pre-P0 code (docs/13 §2).
-- settingsSet() stores every key, so one save in the old UI persisted its defaults: model
-- claude-sonnet-4-6 (not in the catalog), temperature (a 400 on current models) and
-- maxOutputTokens 4096 (the old default; the old cap was 8192, docs/13 asks for 64k).
-- Deleting the row lets SettingsSchema's current default apply. A model the user picked from the
-- current catalog, and any output-token value other than the old default, are kept.

DELETE FROM settings WHERE key = 'temperature';

DELETE FROM settings
WHERE key = 'model'
  AND value_json NOT IN (
    '"claude-opus-5-5"', '"claude-sonnet-5-5"', '"claude-haiku-5-5"', '"claude-fable-5-2"'
  );

DELETE FROM settings WHERE key = 'maxOutputTokens' AND value_json = '4096';
