# Cue Framework — knowledge store & ingestion pipeline

The live cue engine's coaching knowledge, as **data**. Owner-supplied framework source
material is turned into a **de-branded, queryable knowledge base** that the engine (an AI
agent) retrieves from during a call. The same pipeline later powers the **bring-your-own-framework**
product feature (a rep uploads their own material → their own framework).

See also: `ARCHITECTURE.md` (where this sits in the layering), `product/realtime-plan.md`
(the cue engine it feeds), `product/research/realtime-nepq-cues.md` (internal taxonomy reference),
`product/agent-briefs/cue-framework-extraction-agent.md` (the extraction brief).

## The store (migration `0007_cue_framework.sql`)

Reference/config data — seeded at build time, read at call time. **Not** a `live_*` table
(those are per-call runtime rows).

- **`cue_frameworks`** — a versioned, de-branded framework. `tenant_id NULL` = the global
  default shipped for everyone; a non-null `tenant_id` = an org's bring-your-own-framework copy.
  Holds `stage_model` + `gating_config` (jsonb). Two partial unique indexes guard uniqueness
  (a plain composite unique can't, because `NULL <> NULL` in SQL).
- **`cue_knowledge`** — the retrievable entries. `kind` ∈ {principle, question_bank,
  objection_pattern, tonality}; classified by `stage` / `objection_type`; `content` (jsonb) holds
  the kind-specific payload (question lists, clarify/discuss/diffuse moves, principle points);
  `trigger_signal` ties each entry to a signal the engine can actually detect; `source_ref`
  (jsonb) is **internal provenance only, never surfaced to users**. Indexed by
  (framework_id, kind, stage), (framework_id, objection_type), and gin(tags).

Retrieval is **exact-category** (the classifier already knows the stage / objection type, so a
keyed lookup beats fuzzy search on this small, structured corpus). A `pgvector` embedding column
is the noted future option — it would require swapping `postgres:16-alpine` → `pgvector/pgvector`
plus an embeddings provider, so it's deferred until exact lookup proves insufficient.

## The pipeline

1. **Extract** (per-source adapter → raw text, an internal build artifact, **not committed**):
   text-layer PDFs via poppler `pdftotext`; image-based PDFs via **vision fan-out** — render pages
   (`pdftoppm`) then read them with parallel agents (this skips branding/QR/marketing furniture and
   de-brands + classifies in the same pass).
2. **Chunk** structure-aware (by section / question / objection pattern), not fixed-size.
3. **Classify (semantic analysis)** — map each chunk to a de-branded `cue_knowledge` entry in our
   taxonomy. At build time done by the agent; for user-uploaded frameworks it becomes a scripted
   model call producing the same JSON shape.
4. **Store** — curated JSON in `backend/data/cue-framework/{framework.default.json,
   knowledge.*.json}` → deterministic loader `backend/scripts/seed-cue-framework.ts`
   (`bun run seed:cues`) → the tables above.
5. **Retrieve** (runtime, a later slice) — a read-only service the cue engine calls, keyed by
   (framework_id, kind, stage | objection_type, tags).

## Absolute rules (from the extraction brief)

- **De-brand.** Never emit trademarked terms/brand names/URLs from source material. Ideas/methods
  are reused; **all wording is rewritten in our own words** (no verbatim examples). The loader's
  upstream merge step runs a regex leak-scan as a safety gate.
- **Detectable.** Every entry's `trigger_signal` must fire from signals we actually have (live
  dual-channel transcript + prosody), not things we can't measure.
- **No copyrighted source in the repo.** Only our de-branded derived JSON is committed; raw
  extracts and rendered pages stay out of version control. `source_ref` (doc + pages) is enough
  to trace provenance without storing the source text.

## Our stage model

`connect → discover → frame_problem → consequence → qualify → transition → present → commit`
(the de-branded mapping of the source's Connecting / Situation / Problem-Awareness /
Solution-Awareness / Consequence / Qualifying / Transition / Commitment).

## Verifying safely

Never run a bare `docker compose up` in the repo dir — dev and prod share the compose project
name `ai-sales-coach`, so it would recreate the live stack. Verify the migration + loader against
a **throwaway `docker run` Postgres** (its own container name, not a compose project), then
`bun run migrate && bun run seed:cues` + `psql` checks, and remove it.
