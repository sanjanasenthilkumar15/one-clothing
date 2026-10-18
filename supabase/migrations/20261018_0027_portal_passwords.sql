-- ====================================================================
-- Migration 0027: Admin / staff portal passwords stored in the database
-- so they can be changed from inside the app (no redeploy).
--
-- BEFORE RUNNING: replace the two passwords in the INSERT below.
-- Passwords are stored hashed (bcrypt); the browser never sees them.
-- ====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.portal_logins (
  role          TEXT PRIMARY KEY CHECK (role IN ('admin', 'staff')),
  login_id      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS on with no policies: only the SECURITY DEFINER functions below can touch it.
ALTER TABLE public.portal_logins ENABLE ROW LEVEL SECURITY;

INSERT INTO public.portal_logins (role, login_id, password_hash) VALUES
  ('admin', 'admin', extensions.crypt('CHANGE_ME_ADMIN_PASSWORD', extensions.gen_salt('bf'))),
  ('staff', 'staff', extensions.crypt('CHANGE_ME_STAFF_PASSWORD', extensions.gen_salt('bf')))
ON CONFLICT (role) DO NOTHING;

-- Login: returns 'admin' / 'staff', or NULL when the id/password is wrong.
CREATE OR REPLACE FUNCTION public.portal_login(p_id TEXT, p_password TEXT)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions
AS $$
  SELECT role FROM public.portal_logins
  WHERE login_id = p_id AND password_hash = extensions.crypt(p_password, password_hash)
$$;

-- Change your own password (needs the current one).
CREATE OR REPLACE FUNCTION public.portal_change_password(p_id TEXT, p_old TEXT, p_new TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF length(coalesce(p_new, '')) < 6 THEN RETURN FALSE; END IF;
  UPDATE public.portal_logins
     SET password_hash = extensions.crypt(p_new, extensions.gen_salt('bf')), updated_at = NOW()
   WHERE login_id = p_id AND password_hash = extensions.crypt(p_old, password_hash);
  RETURN FOUND;
END;
$$;

-- Admin resets the staff password (needs the admin's own password).
CREATE OR REPLACE FUNCTION public.portal_reset_staff_password(p_admin_id TEXT, p_admin_password TEXT, p_new TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF length(coalesce(p_new, '')) < 6 THEN RETURN FALSE; END IF;
  IF public.portal_login(p_admin_id, p_admin_password) IS DISTINCT FROM 'admin' THEN RETURN FALSE; END IF;
  UPDATE public.portal_logins
     SET password_hash = extensions.crypt(p_new, extensions.gen_salt('bf')), updated_at = NOW()
   WHERE role = 'staff';
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_login(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_change_password(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_reset_staff_password(TEXT, TEXT, TEXT) TO anon, authenticated;

COMMIT;

-- ROLLBACK (manual):
-- DROP FUNCTION IF EXISTS public.portal_reset_staff_password(TEXT, TEXT, TEXT);
-- DROP FUNCTION IF EXISTS public.portal_change_password(TEXT, TEXT, TEXT);
-- DROP FUNCTION IF EXISTS public.portal_login(TEXT, TEXT);
-- DROP TABLE IF EXISTS public.portal_logins;
