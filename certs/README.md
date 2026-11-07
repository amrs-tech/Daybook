# Supabase database trust anchor

This is Supabase's public root CA, downloaded over HTTPS from the exact certificate URL used in its official dashboard. It contains no private key or application credential.

Source and SHA-256 fingerprint are recorded in supabase-root-2021.json. The certificate expires on 26 April 2031.

lib/database-config.ts uses it only for Supabase database/pooler hostnames, retaining certificate-chain and hostname verification. next.config.ts explicitly includes it in every API function's file trace.

Update the certificate from the official Supabase dashboard/download source when Supabase rotates its CA, verify its identity and validity, and rerun database TLS checks and the production bundle check.
