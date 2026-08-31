-- Add "Real Estate" as a selectable workspace/industry type.
-- ALTER TYPE ... ADD VALUE must run as its own statement (not combined with
-- other DDL in the same transaction block) on Postgres, which is why this
-- lives in its own migration file.
ALTER TYPE public.workspace_type ADD VALUE IF NOT EXISTS 'real_estate';
