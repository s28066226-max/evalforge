# Developer API

## Authentication

The Northwind REST API authenticates with personal access tokens, which are created under Profile > Developer settings. Tokens expire after 90 days by default; admins can shorten this to as little as 7 days. Tokens are shown only once at creation.

## Rate limits

API requests are limited to 100 requests per minute per token on Starter, 1,000 per minute on Team, and 5,000 per minute on Enterprise. Requests over the limit receive HTTP 429 with a Retry-After header.

## Webhooks

Webhooks deliver events such as file.created and member.added to an HTTPS endpoint. Each delivery is signed with an HMAC-SHA256 signature in the X-Northwind-Signature header. Failed deliveries are retried up to 5 times with exponential backoff over 24 hours.

## Versioning

The current API version is v3. Version v2 is deprecated and will stop working on 2027-03-31.
