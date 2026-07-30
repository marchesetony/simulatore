# Foundation V1 real bill ingestion — local slice

Set `FOUNDATION_LOCAL_DEV=true` and optionally `FOUNDATION_MAX_PDF_BYTES` for local testing. Uploads are accepted only through the server route with a tenant header, stored under `var/foundation-documents` (outside public directories), and indexed in a local JSON repository. The embedded-text adapter extracts only labelled values actually present in digital PDFs; image-only PDFs return `OCR_PROVIDER_REQUIRED` until a configured OCR provider is supplied.

Open `/?foundation=1` to use the local review screen. Each field displays value, confidence, source, and confirmation state. Corrections are tenant-bound and audited by the ingestion service. Comparison, savings, ranking, report generation, Production, and real customer-data migration are excluded.
