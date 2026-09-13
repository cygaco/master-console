-- FIXTURE (absent): the hard-block is NOT wired. The function exists and even
-- nulls encrypted_password, but it is NEVER bound to auth.users by a trigger, so
-- encrypted_password is never actually nulled and the pre-account-takeover surface
-- stays OPEN. A naive grep for "encrypted_password" + "BEFORE INSERT" would
-- false-green this migration. The static verifier MUST REJECT it (no CREATE
-- TRIGGER on auth.users).
CREATE OR REPLACE FUNCTION public.hardblock_password()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.encrypted_password := NULL;
  RETURN NEW;
END;
$$;

-- NOTE: intentionally NO `CREATE TRIGGER ... ON auth.users`. Only an unrelated
-- table is created, so nothing binds the function to auth.users.
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
