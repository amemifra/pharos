# PROMPT — Swarm di riparazione PharOS (copiare tutto nel kickoff di ogni agente)

Sei un agente di riparazione su PharOS (repo `amemifra/pharos`, branch `main`).
Prima di TUTTO leggi **`docs/HANDOFF-REVIEW.md`** (task list prioritizzata P0→P3 con
file:line) e **`docs/HANDOFF.md`** (stato, decisioni ratificate, regole). Le prove
visive sono in `docs/review/` (screenshot + REVIEW-home-search-visual.md).

## Il tuo contratto
1. Lavora SOLO sui task assegnati dal tuo lane (P0, P1, P2, DESIGN — un lane per
   agente; mai due writer sulla stessa area di codice).
2. Ogni fix deve: (a) citare il difetto del report che risolve, (b) non introdurre
   regressioni, (c) rispettare le "Regole non negoziabili" in HANDOFF-REVIEW.md.
3. P0 è bloccante: **nessun merge di P1+ finché P0#1 (island basePath), P0#2 (P2P
   import, verificato SOLO con grep su `out/_next/static/chunks/*.js` dopo
   `npx next build`) e P0#3 (restauro audio) non sono verdi.**
4. Prova sempre: `npx next build` pulito, `npm test` (6+35+7 — soglie MAI
   abbassate), e per i fix basePath/P2P il grep sul bundle di `out/`. Mai
   `next build` con dev server attivo su :3000 (kill prima: `lsof -nP -iTCP:3000`).
5. Onestà sopra tutto: niente label "shared/community/P2P" finché il P2P non
   parte davvero in produzione; empty state che dicono PERCHÉ è vuoto.
6. Commit piccoli, messaggi che referenziano l'ID difetto (es. `fix(P0#1):
   island basePath`). Push solo dopo build+test verdi. Non toccare le decisioni
   ratificate in HANDOFF.md.
7. Se un fix richiede una decisione di design (palette, UX), implementa la
   specifica di HANDOFF-REVIEW §P0-DESIGN così com'è; deviazioni solo se
   documentate nel commit.

## Ordine dei lane
- **Lane A (P0)**: island basePath + asset paths, P2P import nel bundle,
  restauro audio. Grep su `out/` come prova.
- **Lane B (P1)**: crash decode, Lucene escaping centrale, pf.ready stale
  closure, audio error handling, restricted guards, gate hang, hydration,
  `<a>`→Link, tracklist gate.
- **Lane C (P2 stato/URL)**: search state su URL, genre tiles, paginazione,
  chips/empty-state onesti, recordPlay wiring, format policy default auto,
  seek compound via position, speed reset, podcast resume/dots, session
  resume clobber.
- **Lane D (DESIGN)**: palette ink caldo/ivory/brass (spec §P0-DESIGN), token Tailwind, PharosMark+icon update, contrasto AA, focus ring coerente; **intro splash** con manifesto (spec §P0-DESIGN-bis: fade-in logo→titolo→sottotitolo, skip su tap, prefers-reduced-motion) e **tooltip ⓘ su hover** nel NowPlayingBar con manifesto+link fonti.
- **Lane E (P2 P2P/robustezza)**: validazione/limiti orbitdb.open, retry
  startCollab, badge onesto, wiring morto (setCulture UI, versionStats shape).

Fine run: ogni agente riporta (1) difetti risolti con prove comandi, (2) difetti
NON risolti e perché, (3) rischi residui.
