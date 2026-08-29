-- Restore the old app's curated extraction metadata on the Universal Field
-- Library: label-text variants to look for, confusable fields to avoid, and
-- an optional expected-format regex. This is what makes a "library" field
-- more reliable than a freshly AI-guessed one, and is what gets fed into the
-- extraction prompt (see prelabel.server.ts) and what the label-profile
-- screen uses to mark a field "Common" when AI independently proposes the
-- same key.

ALTER TABLE public.field_library
  ADD COLUMN IF NOT EXISTS label_hints TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS confusion_hints TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS validation_regex TEXT;

-- Document Details
UPDATE public.field_library SET label_hints = ARRAY['Title','Document Title','Subject'], confusion_hints = ARRAY['Document Type'] WHERE key = 'document_title';
UPDATE public.field_library SET label_hints = ARRAY['Type','Document Type','Category'], confusion_hints = ARRAY['Document Title'] WHERE key = 'document_type';
UPDATE public.field_library SET label_hints = ARRAY['Document No','Doc No','No.','Ref No'], confusion_hints = ARRAY['Reference Number','Registration / Tax ID'] WHERE key = 'document_number';
UPDATE public.field_library SET label_hints = ARRAY['Page','Page X of Y','Pages'] WHERE key = 'page_count';
UPDATE public.field_library SET label_hints = ARRAY['Language','Lang'] WHERE key = 'language';
UPDATE public.field_library SET label_hints = ARRAY['Rev','Revision','Version','Ver.'], confusion_hints = ARRAY['Document Number'] WHERE key = 'revision';

-- Parties & Entities
UPDATE public.field_library SET label_hints = ARRAY['From','Issued By','Seller','Vendor','Supplier'], confusion_hints = ARRAY['Recipient Name','Counterparty Name'] WHERE key = 'issuer_name';
UPDATE public.field_library SET label_hints = ARRAY['To','Bill To','Ship To','Customer','Buyer'], confusion_hints = ARRAY['Issuer Name','Counterparty Name'] WHERE key = 'recipient_name';
UPDATE public.field_library SET label_hints = ARRAY['Other Party','Second Party','Counterparty'], confusion_hints = ARRAY['Issuer Name','Recipient Name'] WHERE key = 'counterparty_name';
UPDATE public.field_library SET label_hints = ARRAY['From Address','Registered Address','Seller Address'], confusion_hints = ARRAY['Recipient Address'] WHERE key = 'issuer_address';
UPDATE public.field_library SET label_hints = ARRAY['To Address','Bill To Address','Ship To Address'], confusion_hints = ARRAY['Issuer Address'] WHERE key = 'recipient_address';
UPDATE public.field_library SET label_hints = ARRAY['Email','E-mail','Contact Email'], validation_regex = '^[^\s@]+@[^\s@]+\.[^\s@]+$' WHERE key = 'contact_email';
UPDATE public.field_library SET label_hints = ARRAY['Phone','Tel','Contact No','Mobile'] WHERE key = 'contact_phone';
UPDATE public.field_library SET label_hints = ARRAY['Tax ID','GSTIN','VAT No','Company Reg No','EIN','ABN'], confusion_hints = ARRAY['Document Number','Reference Number'] WHERE key = 'registration_id';

-- Financial Information
UPDATE public.field_library SET label_hints = ARRAY['Total','Grand Total','Amount Due','Total Amount'], confusion_hints = ARRAY['Subtotal','Balance Due'] WHERE key = 'total_amount';
UPDATE public.field_library SET label_hints = ARRAY['Subtotal','Sub-total','Net Amount'], confusion_hints = ARRAY['Total Amount'] WHERE key = 'subtotal_amount';
UPDATE public.field_library SET label_hints = ARRAY['Tax','VAT','GST','Sales Tax'], confusion_hints = ARRAY['Tax Rate','Total Amount'] WHERE key = 'tax_amount';
UPDATE public.field_library SET label_hints = ARRAY['Tax Rate','VAT %','GST %'], confusion_hints = ARRAY['Tax Amount'], validation_regex = '^\d{1,3}(\.\d+)?%?$' WHERE key = 'tax_rate';
UPDATE public.field_library SET label_hints = ARRAY['Discount','Less Discount'], confusion_hints = ARRAY['Tax Amount'] WHERE key = 'discount_amount';
UPDATE public.field_library SET label_hints = ARRAY['Currency','Ccy'], validation_regex = '^[A-Z]{3}$' WHERE key = 'currency_code';
UPDATE public.field_library SET label_hints = ARRAY['Balance Due','Amount Due','Outstanding Balance'], confusion_hints = ARRAY['Total Amount'] WHERE key = 'balance_due';
UPDATE public.field_library SET label_hints = ARRAY['Unit Price','Rate','Price Each'], confusion_hints = ARRAY['Total Amount','Subtotal'] WHERE key = 'unit_price';

-- Dates & Timeline
UPDATE public.field_library SET label_hints = ARRAY['Date','Issue Date','Invoice Date','Dated'], confusion_hints = ARRAY['Due Date','Effective Date'] WHERE key = 'issue_date';
UPDATE public.field_library SET label_hints = ARRAY['Due Date','Payment Due','Due By'], confusion_hints = ARRAY['Issue Date','Expiry Date'] WHERE key = 'due_date';
UPDATE public.field_library SET label_hints = ARRAY['Effective Date','Effective From','Start Date'], confusion_hints = ARRAY['Issue Date'] WHERE key = 'effective_date';
UPDATE public.field_library SET label_hints = ARRAY['Expiry Date','Expiration Date','Valid Until'], confusion_hints = ARRAY['Due Date'] WHERE key = 'expiry_date';
UPDATE public.field_library SET label_hints = ARRAY['Signed On','Date Signed'], confusion_hints = ARRAY['Issue Date'] WHERE key = 'signature_date';
UPDATE public.field_library SET label_hints = ARRAY['Received Date','Date Received'], confusion_hints = ARRAY['Issue Date'] WHERE key = 'received_date';

-- Transaction Details
UPDATE public.field_library SET label_hints = ARRAY['Items','Line Items','Description of Goods'] WHERE key = 'line_items';
UPDATE public.field_library SET label_hints = ARRAY['Qty','Quantity','No. of Units'] WHERE key = 'quantity';
UPDATE public.field_library SET label_hints = ARRAY['Description','Item','Particulars'], confusion_hints = ARRAY['Notes'] WHERE key = 'item_description';
UPDATE public.field_library SET label_hints = ARRAY['Reference','Ref No','PO Number','Order No'], confusion_hints = ARRAY['Document Number','Registration / Tax ID'] WHERE key = 'reference_number';
UPDATE public.field_library SET label_hints = ARRAY['Payment Terms','Terms','Net 30'], confusion_hints = ARRAY['Payment Method'] WHERE key = 'payment_terms';
UPDATE public.field_library SET label_hints = ARRAY['Payment Method','Paid By','Mode of Payment'], confusion_hints = ARRAY['Payment Terms'] WHERE key = 'payment_method';
UPDATE public.field_library SET label_hints = ARRAY['Status','Paid/Unpaid','Draft/Final'] WHERE key = 'status_flag';

-- Miscellaneous
UPDATE public.field_library SET label_hints = ARRAY['Notes','Remarks','Comments'], confusion_hints = ARRAY['Item Description'] WHERE key = 'notes';
UPDATE public.field_library SET label_hints = ARRAY['Signed By','Authorized Signatory','Signature'], confusion_hints = ARRAY['Issuer Name'] WHERE key = 'signatory_name';
UPDATE public.field_library SET label_hints = ARRAY['Signed','Signature Present'] WHERE key = 'is_signed';
UPDATE public.field_library SET label_hints = ARRAY['Attachments','Enclosures','Attached Documents'] WHERE key = 'attachments';
UPDATE public.field_library SET label_hints = ARRAY['Confidential','Classification','Restricted'] WHERE key = 'confidentiality';
