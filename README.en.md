# Psy-base

A public knowledge base on mental disorders: what is known, how strong the
evidence is, and what nobody knows yet. Built from research, not opinions.

**Status:** skeleton. No content yet — first the structure, the rules and the
checks.

The Russian version is the canonical one; English files are translations kept
next to them (`ru.md` / `en.md`). A change to one without the other fails
`npm run check`: it compares headings, numbers, PMIDs, DOIs and links between
the pair — everything that does not depend on language.

Rules in short: no claim without a source; every number carries its level of
evidence; disagreements are shown, not smoothed; a "not found" section is
mandatory.

Licences: text **CC BY 4.0**, source cards **CC0**, code **MIT** — see [LICENSES/README.md](LICENSES/README.md).

Details: [`docs/rules.md`](docs/rules.md) (Russian, canonical).
