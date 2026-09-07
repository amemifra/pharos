# REVIEW — Home & Search (visual + UX, Playwright evidence)

Ambito: Home `/` e Search `/search`, desktop 1440×900 + mobile 375×812, dev server locale.
Metodo: screenshot Playwright (elencati per ogni punto) + console/pageerror/requestfailed log (`console.log`).
Verdetto: **NON pubblicabile così.** Le due pagine hanno difetti di flusso, stato, accessibilità e coerenza visiva su quasi ogni interazione fondamentale.

---

## CRITICAL

1. **CRITICAL — La ricerca non vive nell'URL: refresh = stato perso, niente back valido, niente link condivisibili.**
   `search-desktop-results.png` (query "Mozart" con risultati) → `search-desktop-reload.png` (stesso URL, input vuoto, zero risultati, solo un chip "Recent searches"). Il reload butta via query E risultati; il back button (`search-desktop-back.png`) torna a una pagina generica, non ai risultati. Impatto: l'utente perde la ricerca con un refresh accidentale; impossibile condividere/inviare un link ai risultati; il back del browser è un Lotto.
2. **CRITICAL — Click su genere tile dalla Search ti scarica fuori dalla Search.**
   `search-desktop-genre.png` + `search-desktop-focus.png`: dopo il click su "Jazz" ci si ritrova in una vista diversa (shelf Home/browse) con la sidebar che evidenzia "Jazz" — il contesto di ricerca ("Mozart" digitato) è evaporato. Impatto: il percorso più ovvio ("cerco → affino per genere") distrugge la ricerca invece di filtrarla.
3. **CRITICAL — ~40 errori console 404 su chunk `_next` (collab.js e decine di asset).**
   `console.log`: `[requestfailed] .../chunks/app/(shell)/collab.js net::ERR_ABORTED` + decine di `Failed to load resource: 404`. In dev sono chunk orfani, ma il pattern è lo stesso del deploy statico: ogni 404 qui è un potenziale bianco UI in produzione (già visto: l'intera pagina podcast appesa). Impatto: instabilità strutturale, non cosmetica.
4. **CRITICAL — Le card album non sono link navigabili.**
   `home-desktop-album-click.png` NON ESISTE: lo script non ha trovato **nemmeno un** `a[href*="/album"]` nella Home. Le card sono cliccabili solo via mouse su elementi non-focusable. Impatto: apertura album = impossibile da tastiera, invisibile a screen reader come destinazione, non clic-collegabile. Su una "libreria di cultura pubblica" è un fallimento di accessibilità secco.

## HIGH

5. **HIGH — Branding doppio: la mobile header dice "PublicFlac", il desktop "Pharos".**
   `home-mobile-initial.png` (header "Public**Flac**" + footer "Public music from archive.org") vs `home-desktop-initial.png` ("Pharos"). Due nomi di prodotto nella stessa sessione. Impatto: l'utente non sa dove si trova; il vecchio nome trasmette "progetto abbandonato a metà rename".
6. **HIGH — Popular artists per un utente nuovo = rumore archive.org (Edison, Caruso, Bert Williams), zero canone culturale visibile.**
   `home-desktop-initial.png`, `home-mobile-initial.png`: primo avvio (cache vuota) mostra 7 card placeholder-temple identiche e nomi d'epoca senza alcuna spiegazione né affinità con la lingua dell'utente. La "cultural canon" dichiarata nel codice non è percepibile: nessun'etichetta "perché te lo mostro". Impatto: la prima impressione è "questo catalogo è un cimitero di 78 giri".
7. **HIGH — Zarre card "authoritative" senza fonte: "Mozart vs. DjDott", "kzzhguy", "luis antero".**
   `search-desktop-results.png`, `search-mobile-results-quote.png`: risultati con uploader casuale come artista accanto a Mozart/Verdi, tutti allo stesso livello gerarchico, nessunabadge qualità/canone/PD. Impatto: l'utente non può distinguere un genuino "Kind of Blue" da un remix 2018 di "Frank Halbach" senza fare l'archeologo.
8. **HIGH — Bug di rendering: titolo con parentesi vuota "Miles Davis - Kind of Blue ()".**
   `search-mobile-results-quote.png`, riga 1. L'anno mancante viene stampato come `()`. Impatto: l'errorone da principio "mai mostrare formatteri vuoti" in Bella vista above-the-fold.
9. **HIGH — Results grid desktop: la prima card ("Piano Concerto No. 21") è il DOPPIO grande e rompe la griglia.**
   `search-desktop-results.png`: layout 1 hero + griglia che allinea male (buchi sotto le card waveform, righe non combacianti). Impatto: sembra rotto, non "hero": gerarchia non dichiarata, occhio che salta.
10. **HIGH — Mobile: le cover non-quadrate (JPEG rettangolari, waveform) sbattono fuori dalla card e il testo trunca a caso.**
    `search-mobile-results-quote.png`: cover rettangolare che esce dal riquadro scuro; titoli truncati a metà parola su due colonne strette. Impatto: sloppy su telefono, che è IL target dichiarato del progetto (low-end phones first-class).
11. **HIGH — Durante la digitazione NON c'è suggerimento/autocomplete né debounce visibile.**
    `search-desktop-typing.png` = identico all'idle con "Mozart" dentro. Nessun dropdown, nessun "premi invio", nessun risultato parziale. Impatto: zero feedback in una delle interazioni più attese; l'utente non sa se il tasto Search è obbligatorio.
12. **HIGH — Empty state fuorviante: "search an album to start" restà stampato ANCHE CON risultati pieni.**
    `search-mobile-results-quote.png` footer + `search-desktop-results.png` footer. Impatto: messaggio che contraddice lo stato reale della pagina; segno di uno stato UI non derivato dai dati.

## MEDIUM

13. **MEDIUM — Search idle desktop: metà pagina vuota.** `search-desktop-idle.png`: 8 tile di genere poi nulla fino al footer. Impatto: la pagina "pensi" sia finita; mancato sfruttamento (recenti, suggerimenti culturali, novità del catalogo).
14. **MEDIUM — Doppione di navigazione: sidebar GENRES e tile BROWSE ALL sono la stessa lista ripetuta sulla stessa schermata.** `search-desktop-idle.png`: 6 voci sidebar + 8 tile = ridondanza senza differenza di comportamento. Impatto: rumore; l'utente non capisce quale sia la via "giusta".
15. **MEDIUM — Tab bar mobile copre il footer/contenuto; manca padding-bottom di sicurezza.** `home-mobile-initial.png` (fullPage): la barra Home/Search/Library/Podcast si stampa a metà pagina sopra le card Blues. Impatto: overlap reale su viewport bassi; i contenuti finali non raggiungibili senza scroll cieco.
16. **MEDIUM — Focus ring: presente e verde, MA il focus non viene mai PORTATO sui risultati dopo la ricerca.** `search-desktop-focus.png`: il ring su "Electronic" in sidebar è ok, ma dopo Enter il focus resta nell'input: screen reader non annuncia "N risultati". Impatto: flusso tastiera/SR interrotto proprio nel momento chiave.
17. **MEDIUM — Skeleton assenti in Search: tra Enter e risultati (10s+) la pagina resta congelata sull'input.** `search-desktop-typing.png` vs `search-desktop-results.png`: nessuno skeleton di card, nessun progress. Impatto: 10 secondi di silenzio = "è rotto?" — su rete lenta (target: low-end) è fatale.
18. **MEDIUM — Contrast: testo placeholder e footer `text-zinc-600/700` su nero ~2.1:1.** `search-desktop-idle.png` ("Artist, album, concert...", footer). Impatto: sotto WCAG AA; illeggibile al sole, target mobile all'aperto.
19. **MEDIUM — "78 rpm · early 1900s" tile: label criptica per un utente normale** (`search-desktop-idle.png`). Impatto: gergo da collezionista senza spiegazione (è PD? è georgeblood? nessuno lo sa).
20. **MEDIUM — Console warning ricorrente "Module not found: onnxruntime-web" ad ogni load** (`console.log`, ×3 solo in Home). Dichiarato "noto" nel handoff, ma è rumore in ogni sessione dev e un warning di build che un reviewer esterno legge come "progetto rotto".
21. **MEDIUM — Player bar desktop: "Public music from archive.org — search an album to start" quando NON c'è playback, ma nessun CTA cliccabile** (`search-desktop-idle.png`). Impatto: dead text: o è un link che precompila la ricerca o non serve.

## LOW

22. **LOW — Le card Popular artists hanno TUTTE lo stesso placeholder temple** (`home-desktop-initial.png`): 7 musei identici di fila. Impatto: aspetto "dati mancanti" non "design".
23. **LOW — Home mobile: prima card Popular tagliata a metà sul bordo destro senza affioramento/margin** (`home-mobile-initial.png` in alto). Lo scroll orizzontale c'è ma non si intuisce.
24. **LOW — Nessun tiebreaker visivo tra "search era per 'Mozart'" e il resto: results non hanno header "Results for «Mozart» (N)"** (`search-desktop-results.png`). Impatto: dopo vari click l'utente non ricorda più cosa stava vedendo né quanti risultati esistano.
25. **LOW — Reset compleanni: le tile genere hanno colori arbitrali (viola/ambra/rossastro) non riferiti a un sistema** (`search-desktop-idle.png`). Impatto: palette sembrata casual; contrasti diseguali tra tile (bianco su ambra vs bianco su verde scuro).
26. **LOW — iframe warning sandbox `allow-scripts + allow-same-origin` ad ogni load** (`console.log`). Nota di sicurezza reale del player island: documentato come tradeoff, ma resta un finding che ogni audit segnalerà.
27. **LOW — "Recent searches" esiste (chip Mozart) MA non è cliccabile?** `search-desktop-reload.png`: il chip appare dopo il reload ma lo stato qui documentato non ne mostra l'uso; se è un bottone, non comunica affinità col flusso di ricerca (nessun hover ring visibile negli screenshot).
28. **LOW — Dev overlay "1 Issue" visibile negli screenshot** — solo dev, ma dimostra che le warning di build non sono silenziate nemmeno quando "volute" (onnxruntime).

---

## Matrice sintetica

| # | Gravità | Area | Evidenza |
|---|---------|------|----------|
| 1 | CRITICAL | stato/URL | search-desktop-reload.png |
| 2 | CRITICAL | flusso nav | search-desktop-genre.png |
| 3 | CRITICAL | build/console | console.log |
| 4 | CRITICAL | a11y | (assenza di home-desktop-album-click.png) |
| 5 | HIGH | branding | home-mobile-initial.png vs home-desktop-initial.png |
| 6 | HIGH | contenuto | home-desktop-initial.png |
| 7 | HIGH | qualità dati | search-desktop-results.png |
| 8 | HIGH | bug UI | search-mobile-results-quote.png |
| 9 | HIGH | layout | search-desktop-results.png |
| 10 | HIGH | mobile | search-mobile-results-quote.png |
| 11 | HIGH | feedback | search-desktop-typing.png |
| 12 | HIGH | stati UI | search-mobile-results-quote.png |
| 13–21 | MEDIUM | vari | vedi sopra |
| 22–28 | LOW | vari | vedi sopra |
