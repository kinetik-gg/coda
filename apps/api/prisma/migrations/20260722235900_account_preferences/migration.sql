ALTER TABLE "users"
ADD COLUMN "theme" VARCHAR(40) NOT NULL DEFAULT 'coda-dark',
ADD COLUMN "font_size" VARCHAR(16) NOT NULL DEFAULT 'default',
ADD COLUMN "motion_preference" VARCHAR(16) NOT NULL DEFAULT 'system',
ADD COLUMN "pdf_appearance" VARCHAR(16) NOT NULL DEFAULT 'theme';
