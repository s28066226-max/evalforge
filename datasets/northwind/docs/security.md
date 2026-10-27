# Security and Compliance

## Data protection

All customer data is encrypted at rest with AES-256 and in transit with TLS 1.3. Encryption keys are rotated every 90 days. Enterprise customers can bring their own encryption keys (BYOK) through AWS KMS.

Customer data is stored in the region chosen when the workspace is created. Available regions are US-East, EU-Frankfurt, and AP-Sydney. A workspace's region cannot be changed after creation.

## Certifications

Northwind Cloud holds SOC 2 Type II and ISO 27001 certifications. Audit reports are available to Enterprise customers under NDA. Northwind is not currently HIPAA compliant and must not be used to store protected health information.

## Authentication

Single sign-on (SSO) via SAML 2.0 is available on Team and Enterprise plans. SCIM user provisioning is available on Enterprise only. Two-factor authentication can be enforced for all members by any workspace admin.

## Backups

Backups are taken every 6 hours and retained for 35 days. Point-in-time restore is available on Enterprise plans.
