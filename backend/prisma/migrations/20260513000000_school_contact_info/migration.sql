-- Add optional contact fields used by printable artifacts (receipts,
-- marksheets, ledgers). Both nullable: schools that haven't filled them
-- in just don't render the line on the document.
ALTER TABLE "schools"
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "phone"   VARCHAR(40);
