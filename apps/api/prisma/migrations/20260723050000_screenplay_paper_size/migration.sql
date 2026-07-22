ALTER TABLE "screenplays"
ADD COLUMN "paper_size" VARCHAR(16) NOT NULL DEFAULT 'letter';

ALTER TABLE "screenplays"
ADD CONSTRAINT "screenplays_paper_size_check"
CHECK ("paper_size" IN ('letter', 'a4'));
