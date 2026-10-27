# Podgolf — odločitve

Kratek dnevnik odločitev za prototip (vprašanje → odločitev → zakaj).

## Pravila
- **Ena skupna žogica ali vsak svojo?** → Vsak svojo (Žiga, 2026-10-27). Zmaga tisti, čigar žogica prva pade v odtok. Tujo žogico lahko izbiješ; če jo po nesreči potopiš ti, zmaga nasprotnik.
- **Koliko lukenj?** → Ena luknja na enem večjem igrišču (Žiga). Več lukenj in igra na 2 od 3 lahko prideta kasneje.
- **Udarec** → Gumb držiš, merilec niha 0 → 1 → 0 (kot pri golfu), ob spustu se podgana zaleti in z gobcem odbije žogico. Med polnjenjem se lahko obračaš (počasneje), kar omogoča natančno merjenje.
- **Hoja v žogico** jo samo rahlo porine (največ 2,5 enote/s), da "driblanje" ne nadomesti udarcev.
- **Zalet v nasprotnika** ga za 1 s omami.
- **Podgane ne morejo stati na odtoku** (rahlo jih odrine), da ga nihče ne more zapreti.

## Fizika
- Lastna fizika (krogla proti škatli/valju/kapsuli + teren z lijakom), brez knjižnice — majhna, deterministična, testirana z vitestom.
- Odtok je v plitvem lijaku (polmer 2,4, globina 0,32): počasna žogica blizu luknje se sama skotali noter.
- Prehitra žogica (> 6,5 enote/s) čez zadnji rob odskoči naprej namesto da bi se ustavila — "lip-out".
- Gobice imajo koeficient odboja 1,25 (dodajo energijo), mleko na tleh žogico močno zavira.

## Videz in zvok
- Vsi asseti so proceduralni: modeli iz primitivov, teksture v shaderjih, zvoki in glasba v WebAudio. Ni zunanjih datotek ali plačljivih generatorjev.
- Split screen: levo/desno na širokih zaslonih (P1 levo = WASD na levi), zgoraj/spodaj na pokončnih.
- Render: senčna mapa → MSAA prehod za oba pogleda → bloom → kompozit s črnimi obrobami (globina + normale), ACES, vinjeta.

## Računalniški nasprotnik
- Bot preišče ~170 udarcev z isto fiziko, izbere najboljšega in mu doda človeško napako (privzeta spretnost 0,6). Bot proti botu tekmo konča v ~2–4 udarcih.
