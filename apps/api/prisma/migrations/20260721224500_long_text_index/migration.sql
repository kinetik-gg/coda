DROP INDEX IF EXISTS "field_values_field_id_text_value_idx";

CREATE INDEX IF NOT EXISTS "field_values_field_id_idx" ON "field_values"("field_id");
