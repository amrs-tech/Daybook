# DayBook v2.1 baseline

Only the two attachments in this chat are requirements. Both were read in full before source changes.

Audit on 2026-11-05: the supplied workspace contained no source repository, package manifest, lockfile, Git history, migrations, application, tests, transaction forms, or deployment configuration. Therefore there is no existing financial implementation to preserve, and no existing test command to run. No original v1 plan was requested or used.

Resolution: create a new, self-contained Next.js/TypeScript implementation in `daybook/`. This is a new foundation, not a verified upgrade of an unseen repository. Any later integration with an existing application requires reviewing its actual schema and tested behavior first. Appendix B v2.1 supersedes the earlier illustrative v2 schema. Appendix C and D prompts are stored verbatim.

No Supabase, Gemini, ElevenLabs, Langfuse, Vercel or GitHub credentials were provided. Live integration and deployment gates cannot be certified without them. Local deterministic replay is labeled as such and never represented as a live model response.

The financial trust boundary is a server-only PostgreSQL role, verified authentication, owner-scoped database functions, immutable journals, versioned previews, and transactional commit. Public browser roles have read access only through RLS and no posting privileges.
