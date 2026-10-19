-- FIXTURE (present): a CORRECT hard-block. The static verifier MUST accept this
-- definition as valid. Kept structurally identical to the shipped migration.
CREATE OR REPLACE FUNCTION public.hardblock_password()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.encrypted_password := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hardblock_password_trigger ON auth.users;

CREATE TRIGGER hardblock_password_trigger
  BEFORE INSERT OR UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.hardblock_password();
