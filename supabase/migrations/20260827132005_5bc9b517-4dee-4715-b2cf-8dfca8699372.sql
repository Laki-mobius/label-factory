-- ENUMS
CREATE TYPE public.app_role AS ENUM ('admin','member');
CREATE TYPE public.workspace_type AS ENUM ('finance','healthcare','legal','manufacturing','insurance','logistics','general');
CREATE TYPE public.project_status AS ENUM ('active','paused','completed','archived');
CREATE TYPE public.member_access AS ENUM ('owner','editor','viewer');
CREATE TYPE public.field_data_type AS ENUM ('text','identifier','date','currency','number','boolean','multi_value');
CREATE TYPE public.profile_status AS ENUM ('draft','published','archived');
CREATE TYPE public.batch_status AS ENUM ('uploaded','processing','prelabeled','in_review','complete');
CREATE TYPE public.document_status AS ENUM ('uploaded','processing','prelabeled','in_review','approved','rejected');
CREATE TYPE public.extraction_review_state AS ENUM ('pending','accepted','corrected','rejected','locked');
CREATE TYPE public.connector_kind AS ENUM ('hosted','self_hosted');

-- UPDATED_AT HELPER
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- USER ROLES
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin');
$$;

-- NEW USER TRIGGER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'member') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- PROJECTS
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_type public.workspace_type NOT NULL DEFAULT 'general',
  status public.project_status NOT NULL DEFAULT 'active',
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PROJECT MEMBERS
CREATE TABLE public.project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access public.member_access NOT NULL DEFAULT 'editor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated;
GRANT ALL ON public.project_members TO service_role;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_project(_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin')
      OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = _project_id AND m.user_id = auth.uid());
$$;

-- FIELD LIBRARY
CREATE TABLE public.field_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  data_type public.field_data_type NOT NULL DEFAULT 'text',
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.field_library TO authenticated;
GRANT ALL ON public.field_library TO service_role;
ALTER TABLE public.field_library ENABLE ROW LEVEL SECURITY;

-- LABEL PROFILES
CREATE TABLE public.label_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  document_type TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status public.profile_status NOT NULL DEFAULT 'draft',
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_profiles TO authenticated;
GRANT ALL ON public.label_profiles TO service_role;
ALTER TABLE public.label_profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_label_profiles_updated BEFORE UPDATE ON public.label_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Published profiles are immutable: changes must create a new version
CREATE OR REPLACE FUNCTION public.guard_published_label_profile()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'published'
     AND (NEW.fields IS DISTINCT FROM OLD.fields
          OR NEW.model_config IS DISTINCT FROM OLD.model_config
          OR NEW.document_type IS DISTINCT FROM OLD.document_type)
     AND NEW.version = OLD.version THEN
    RAISE EXCEPTION 'Published label profiles are immutable. Create a new version instead.';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_label_profiles_guard BEFORE UPDATE ON public.label_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_published_label_profile();

-- BATCHES
CREATE TABLE public.batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label_profile_id UUID REFERENCES public.label_profiles(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status public.batch_status NOT NULL DEFAULT 'uploaded',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batches TO authenticated;
GRANT ALL ON public.batches TO service_role;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_batches_updated BEFORE UPDATE ON public.batches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.can_access_batch(_batch_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.batches b WHERE b.id = _batch_id AND public.can_access_project(b.project_id));
$$;

-- DOCUMENTS
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'pdf',
  storage_path TEXT,
  page_count INTEGER NOT NULL DEFAULT 0,
  status public.document_status NOT NULL DEFAULT 'uploaded',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_documents_updated BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.can_access_document(_document_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = _document_id AND public.can_access_batch(d.batch_id));
$$;

-- EXTRACTIONS
CREATE TABLE public.extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  field_label TEXT,
  data_type public.field_data_type NOT NULL DEFAULT 'text',
  suggested_value TEXT,
  confidence NUMERIC(5,4),
  evidence_snippet TEXT,
  evidence_page INTEGER,
  final_value TEXT,
  review_state public.extraction_review_state NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, field_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.extractions TO authenticated;
GRANT ALL ON public.extractions TO service_role;
ALTER TABLE public.extractions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_extractions_updated BEFORE UPDATE ON public.extractions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- MODEL CONNECTORS
CREATE TABLE public.model_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind public.connector_kind NOT NULL DEFAULT 'hosted',
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  base_url TEXT,
  auth_type TEXT NOT NULL DEFAULT 'bearer',
  api_key TEXT,
  custom_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.model_connectors TO authenticated;
GRANT ALL ON public.model_connectors TO service_role;
ALTER TABLE public.model_connectors ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_model_connectors_updated BEFORE UPDATE ON public.model_connectors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- POLICIES
CREATE POLICY "profiles_select_self_or_admin" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_admin());
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_self_or_admin" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid() OR public.is_admin()) WITH CHECK (id = auth.uid() OR public.is_admin());

CREATE POLICY "roles_select_self_or_admin" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "field_library_read" ON public.field_library FOR SELECT TO authenticated USING (true);
CREATE POLICY "field_library_admin_write" ON public.field_library FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "projects_select" ON public.projects FOR SELECT TO authenticated USING (public.can_access_project(id));
CREATE POLICY "projects_insert" ON public.projects FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid() OR public.is_admin());
CREATE POLICY "projects_update" ON public.projects FOR UPDATE TO authenticated USING (owner_id = auth.uid() OR public.is_admin()) WITH CHECK (owner_id = auth.uid() OR public.is_admin());
CREATE POLICY "projects_delete" ON public.projects FOR DELETE TO authenticated USING (owner_id = auth.uid() OR public.is_admin());

CREATE POLICY "members_select" ON public.project_members FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.can_access_project(project_id));
CREATE POLICY "members_write" ON public.project_members FOR ALL TO authenticated
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()))
  WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()));

CREATE POLICY "label_profiles_all" ON public.label_profiles FOR ALL TO authenticated USING (public.can_access_project(project_id)) WITH CHECK (public.can_access_project(project_id));
CREATE POLICY "batches_all" ON public.batches FOR ALL TO authenticated USING (public.can_access_project(project_id)) WITH CHECK (public.can_access_project(project_id));
CREATE POLICY "documents_all" ON public.documents FOR ALL TO authenticated USING (public.can_access_batch(batch_id)) WITH CHECK (public.can_access_batch(batch_id));
CREATE POLICY "extractions_all" ON public.extractions FOR ALL TO authenticated USING (public.can_access_document(document_id)) WITH CHECK (public.can_access_document(document_id));
CREATE POLICY "connectors_all" ON public.model_connectors FOR ALL TO authenticated USING (public.can_access_project(project_id)) WITH CHECK (public.can_access_project(project_id));

-- SEED FIELD LIBRARY
INSERT INTO public.field_library (bucket, key, display_name, data_type, description, sort_order) VALUES
('Document Details','document_title','Document Title','text','Title or heading of the document',1),
('Document Details','document_type','Document Type','text','Type or category of the document',2),
('Document Details','document_number','Document Number','identifier','Primary reference number printed on the document',3),
('Document Details','page_count','Page Count','number','Total number of pages',4),
('Document Details','language','Language','text','Primary language of the document',5),
('Document Details','revision','Revision / Version','text','Revision or version marker',6),
('Parties & Entities','issuer_name','Issuer Name','text','Organisation or person issuing the document',1),
('Parties & Entities','recipient_name','Recipient Name','text','Organisation or person receiving the document',2),
('Parties & Entities','counterparty_name','Counterparty Name','text','Other party involved in the transaction or agreement',3),
('Parties & Entities','issuer_address','Issuer Address','text','Full address of the issuer',4),
('Parties & Entities','recipient_address','Recipient Address','text','Full address of the recipient',5),
('Parties & Entities','contact_email','Contact Email','text','Contact email address listed on the document',6),
('Parties & Entities','contact_phone','Contact Phone','text','Contact phone number listed on the document',7),
('Parties & Entities','registration_id','Registration / Tax ID','identifier','Company registration, tax or licence identifier',8),
('Financial Information','total_amount','Total Amount','currency','Total monetary amount',1),
('Financial Information','subtotal_amount','Subtotal','currency','Amount before tax and adjustments',2),
('Financial Information','tax_amount','Tax Amount','currency','Total tax charged',3),
('Financial Information','tax_rate','Tax Rate','number','Applied tax rate as a percentage',4),
('Financial Information','discount_amount','Discount','currency','Total discount applied',5),
('Financial Information','currency_code','Currency','text','Currency code such as USD or EUR',6),
('Financial Information','balance_due','Balance Due','currency','Outstanding amount still payable',7),
('Financial Information','unit_price','Unit Price','currency','Price per unit',8),
('Dates & Timeline','issue_date','Issue Date','date','Date the document was issued',1),
('Dates & Timeline','due_date','Due Date','date','Date payment or action is due',2),
('Dates & Timeline','effective_date','Effective Date','date','Date the document takes effect',3),
('Dates & Timeline','expiry_date','Expiry Date','date','Date the document or agreement expires',4),
('Dates & Timeline','signature_date','Signature Date','date','Date the document was signed',5),
('Dates & Timeline','received_date','Received Date','date','Date the document was received',6),
('Transaction Details','line_items','Line Items','multi_value','Itemised list of goods, services or entries',1),
('Transaction Details','quantity','Quantity','number','Quantity of units',2),
('Transaction Details','item_description','Item Description','text','Description of an individual line item',3),
('Transaction Details','reference_number','Reference Number','identifier','Related order, claim or case reference',4),
('Transaction Details','payment_terms','Payment Terms','text','Agreed payment terms',5),
('Transaction Details','payment_method','Payment Method','text','Method used or requested for payment',6),
('Transaction Details','status_flag','Status','text','Status printed on the document',7),
('Miscellaneous','notes','Notes','text','Free-form notes or remarks',1),
('Miscellaneous','signatory_name','Signatory Name','text','Name of the person who signed',2),
('Miscellaneous','is_signed','Signed','boolean','Whether the document carries a signature',3),
('Miscellaneous','attachments','Attachments','multi_value','References to attached or related documents',4),
('Miscellaneous','confidentiality','Confidentiality Marking','text','Confidentiality or classification marking',5);