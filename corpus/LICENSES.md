# The corpus's papers: licences and attribution

Each paper of the corpus is the work of its authors, under the licence named here, which allows it to be
redistributed. reflowtex does not ship the papers' sources: tools/corpus/fetch.ts downloads each from the
address given, checked against its sha256. What the website shows of a paper (its page, typeset by reflowtex
from that source, and the comparison with TeX's own typesetting) is a rendering of it, and is credited as below.
Where a source was changed before it was built, the patch in patches/ records the change and why.

## arxiv-2309.06053

**Confounder selection via iterative graph expansion**

F. Richard Guo, Qingyuan Zhao

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2309.06053v3
- Source: https://arxiv.org/src/2309.06053v3 (sha256 `669e8034d8db61289e7636cb59e5fed060ce1221f4a22c8a6e3a4bb55c07cd74`)
- Credit: “Confounder selection via iterative graph expansion” by F. Richard Guo, Qingyuan Zhao, arXiv:2309.06053v3. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2310.06922

**Tracing the Snowball bifurcation of aquaplanets through time reveals a fundamental shift in critical-state dynamics**

Georg Feulner, Mona Bukenberger, Stefan Petri

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2310.06922v1
- Source: https://arxiv.org/src/2310.06922v1 (sha256 `ea5f0c164a91f5a8d14fce52aa5e64b7a8b501b764b763ba2f6347ea14fd55f6`)
- Changed: [patches/arxiv-2310.06922.patch](patches/arxiv-2310.06922.patch). Written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   ’ (U+2019) -> \textquoteright: 2 in the source (6 missing-character lines in the log before) After the change the plain LuaLaTeX build reports none of these characters missing, and its page count is unchanged. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “Tracing the Snowball bifurcation of aquaplanets through time reveals a fundamental shift in critical-state dynamics” by Georg Feulner, Mona Bukenberger, Stefan Petri, arXiv:2310.06922v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2506.19542

**From Worst-Case Hardness of NP to Quantum Cryptography via Quantum Indistinguishability Obfuscation**

Tomoyuki Morimae, Yuki Shirakawa, Takashi Yamakawa

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ICALP.2026.143 (53rd International Colloquium on Automata, Languages, and Programming (ICALP 2026), LIPIcs vol. 374, paper 143, doi:10.4230/LIPIcs.ICALP.2026.143)
- Source: https://arxiv.org/src/2506.19542v1 (sha256 `194e445d69d53c1ee3325e15892299d9df9dd26db98d447831b86d632348b266`)
- Changed: [patches/arxiv-2506.19542.patch](patches/arxiv-2506.19542.patch). Removes \usepackage{qcircuit}, which no file of the paper uses (no \Qcircuit, \qw or \gate): qcircuit loads xypdf, which stops under LuaTeX ("pdfTeX version 1.40.0 or higher is needed"). The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “From Worst-Case Hardness of NP to Quantum Cryptography via Quantum Indistinguishability Obfuscation” by Tomoyuki Morimae, Yuki Shirakawa, Takashi Yamakawa, arXiv:2506.19542v1 (published in ICALP 2026, LIPIcs vol. 374, 10.4230/LIPIcs.ICALP.2026.143). Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source, with a recorded patch.

## arxiv-2506.21223

**Strict hierarchy between n-wise measurement simulability, compatibility structures, and multi-copy compatibility**

Lucas Tendick, Costantino Budroni, Marco Túlio Quintino

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2506.21223v3
- Source: https://arxiv.org/src/2506.21223v3 (sha256 `207eb623ef6ba239221c523f5ea18b292d8368021b726a2fd25e9283457bc130`)
- Changed: [patches/arxiv-2506.21223.patch](patches/arxiv-2506.21223.patch). Written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   Ł (U+0141) -> \L: 3 in the source (4 missing-character lines in the log before)   Ż (U+017B) -> \.Z: 3 in the source (4 missing-character lines in the log before)   – (U+2013) -> \textendash: 12 in the source (15 missing-character lines in the log before)   “ (U+201C) -> \textquotedblleft: 1 in the source (3 missing-character lines in the log before)   ” (U+201D) -> \textquotedblright: 1 in the source (3 missing-character lines in the log before) After the change the plain LuaLaTeX build reports none of these characters missing, and its page count is unchanged. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “Strict hierarchy between n-wise measurement simulability, compatibility structures, and multi-copy compatibility” by Lucas Tendick, Costantino Budroni, Marco Túlio Quintino, arXiv:2506.21223v3. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2506.24128

**Beneath the Surface: >85% of z>5.9 QSOs in Massive Host Galaxies are UV-Faint**

R. J. Bouwens, E. Banados, R. Decarli, J. Hennawi, D. Yang, H. Algera, M. Aravena, E. Farina, A. Gloudemans, J. Hodge, H. Inami, J. Matthee, R. Meyer, R. P. Naidu, P. Oesch, H. J. A. Rottgering, S. Schouws, R. Smit, M. Stefanon, P. van der Werf, B. Venemans, F. Walter, Y. Fudamoto

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2506.24128v2
- Source: https://arxiv.org/src/2506.24128v2 (sha256 `41edfa412abf1976c684b623e41983d825a8e964feee8559548a38107f763ae8`)
- Changed: [patches/arxiv-2506.24128.patch](patches/arxiv-2506.24128.patch). Written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   – (U+2013) -> \textendash: 1 in the source (4 missing-character lines in the log before)   ’ (U+2019) -> \textquoteright: 2 in the source (6 missing-character lines in the log before)   ” (U+201D) -> \textquotedblright: 2 in the source (6 missing-character lines in the log before) After the change the plain LuaLaTeX build reports none of these characters missing, and its page count is unchanged. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “Beneath the Surface: >85% of z>5.9 QSOs in Massive Host Galaxies are UV-Faint” by R. J. Bouwens, E. Banados, R. Decarli, J. Hennawi, D. Yang, H. Algera, M. Aravena, E. Farina, A. Gloudemans, J. Hodge, H. Inami, J. Matthee, R. Meyer, R. P. Naidu, P. Oesch, H. J. A. Rottgering, S. Schouws, R. Smit, M. Stefanon, P. van der Werf, B. Venemans, F. Walter, Y. Fudamoto, arXiv:2506.24128v2. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2507.09324

**The Network Satisfaction Problem for Relation Algebras with at most 4 Atoms**

Manuel Bodirsky, Moritz Jahn, Simon Knäuer, Matěj Konečný, Paul Winkler

- Licence: [CC-BY-SA-4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- Published: https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ICALP.2026.168 (53rd International Colloquium on Automata, Languages, and Programming (ICALP 2026), LIPIcs vol. 374, paper 168, doi:10.4230/LIPIcs.ICALP.2026.168)
- Source: https://arxiv.org/src/2507.09324v2 (sha256 `8a195abaf200dcac2769a4e728bc4b70bb3e1327841030291b73472c3bdcb19b`)
- Credit: “The Network Satisfaction Problem for Relation Algebras with at most 4 Atoms” by Manuel Bodirsky, Moritz Jahn, Simon Knäuer, Matěj Konečný, Paul Winkler, arXiv:2507.09324v2 (published in ICALP 2026, LIPIcs vol. 374, 10.4230/LIPIcs.ICALP.2026.168). Licensed under CC BY-SA 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2511.10019

**Odd-Cycle-Packing-treewidth: On the Maximum Independent Set problem in odd-minor-free graph classes**

Mujin Choi, Maximilian Gorsky, Gunwoo Kim, Caleb McFarland, Sebastian Wiederrecht

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ICALP.2026.64 (53rd International Colloquium on Automata, Languages, and Programming (ICALP 2026), LIPIcs vol. 374, paper 64, doi:10.4230/LIPIcs.ICALP.2026.64)
- Source: https://arxiv.org/src/2511.10019v1 (sha256 `52192e02595961d4a7d0b600e2383608539088a30c1405480f84f6303a23915d`)
- Changed: [patches/arxiv-2511.10019.patch](patches/arxiv-2511.10019.patch). Written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   ł (U+0142) -> \l: 1 in the source (4 missing-character lines in the log before)   – (U+2013) -> \textendash: 5 in the source (7 missing-character lines in the log before)   — (U+2014) -> \textemdash: 1 in the source (5 missing-character lines in the log before) After the change the plain LuaLaTeX build reports none of these characters missing, and its page count is unchanged. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “Odd-Cycle-Packing-treewidth: On the Maximum Independent Set problem in odd-minor-free graph classes” by Mujin Choi, Maximilian Gorsky, Gunwoo Kim, Caleb McFarland, Sebastian Wiederrecht, arXiv:2511.10019v1 (published in ICALP 2026, LIPIcs vol. 374, 10.4230/LIPIcs.ICALP.2026.64). Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2512.04614

**On Tight FPT Time Approximation Algorithms for k-Clustering Problems**

Han Dai, Shi Li, Sijin Peng

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ICALP.2026.72 (53rd International Colloquium on Automata, Languages, and Programming (ICALP 2026), LIPIcs vol. 374, paper 72, doi:10.4230/LIPIcs.ICALP.2026.72)
- Source: https://arxiv.org/src/2512.04614v2 (sha256 `31a00242cbe662faf440739d4991e9fcc5dadc81eef3488cabbb3f11b982092d`)
- Credit: “On Tight FPT Time Approximation Algorithms for k-Clustering Problems” by Han Dai, Shi Li, Sijin Peng, arXiv:2512.04614v2 (published in ICALP 2026, LIPIcs vol. 374, 10.4230/LIPIcs.ICALP.2026.72). Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2602.08542

**Incremental (k, z)-Clustering on Graphs**

Emilio Cruciani, Sebastian Forster, Antonis Skarlatos

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ICALP.2026.70 (53rd International Colloquium on Automata, Languages, and Programming (ICALP 2026), LIPIcs vol. 374, paper 70, doi:10.4230/LIPIcs.ICALP.2026.70)
- Source: https://arxiv.org/src/2602.08542v3 (sha256 `078e649b0ba96ca3122301a7862d666a5a5d500316bf1f3956885368e8b46dc8`)
- Not built: Needs pdfTeX: \pdfoutput=1 on its first line, and ocgcolorlinks uses pdfTeX's \pdfpageheight.
- Credit: “Incremental (k, z)-Clustering on Graphs” by Emilio Cruciani, Sebastian Forster, Antonis Skarlatos, arXiv:2602.08542v3 (published in ICALP 2026, LIPIcs vol. 374, 10.4230/LIPIcs.ICALP.2026.70). Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2602.13120

**Scoped MSO, Register Automata, and Expressions: Equivalence over Data Words**

Radosław Piórkowski

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ICALP.2026.188 (53rd International Colloquium on Automata, Languages, and Programming (ICALP 2026), LIPIcs vol. 374, paper 188, doi:10.4230/LIPIcs.ICALP.2026.188)
- Source: https://arxiv.org/src/2602.13120v1 (sha256 `c12f49b0128f308291d05f2f660086d2662ef0c9c5d1fff5ccb5d21ca5357c52`)
- Changed: [patches/arxiv-2602.13120.patch](patches/arxiv-2602.13120.patch). The paper's own loop defines \fa .. \fz as \mathfrak letters with \cs_new and already skips \fi. lipics-v2021 loads fontawesome5, which defines \fa, so \cs_new stops with an error. The paper uses neither \fa nor any fontawesome icon, so the loop now skips 'a' as it skips 'i'; nothing in the paper changes. Also: the paper was written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   ł (U+0142) -> \l: 3 in the source (11 missing-character lines in the log before)   ń (U+0144) -> \'n: 1 in the source (4 missing-character lines in the log before)   – (U+2013) -> \textendash: 1 in the source (4 missing-character lines in the log before) After the change the plain LuaLaTeX build reports none of these characters missing, and its page count is unchanged. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “Scoped MSO, Register Automata, and Expressions: Equivalence over Data Words” by Radosław Piórkowski, arXiv:2602.13120v1 (published in ICALP 2026, LIPIcs vol. 374, 10.4230/LIPIcs.ICALP.2026.188). Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source, with a recorded patch.

## arxiv-2604.01211

**Making Every Bit Count for A-Optimal State Estimation**

Cameron Khanpour, Daniel Turizo, Samuel Talkington

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2604.01211v2
- Source: https://arxiv.org/src/2604.01211v2 (sha256 `53c03eb75b153aa83714487382259c0de8df64c95dae0b2878c54db610021779`)
- Credit: “Making Every Bit Count for A-Optimal State Estimation” by Cameron Khanpour, Daniel Turizo, Samuel Talkington, arXiv:2604.01211v2. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2604.07463

**Decoding multiway gravitational junctions in AdS in terms of holographic quantum maps**

Avik Chakraborty, Tanay Kibe, Martín Molina, Ayan Mukhopadhyay, Giuseppe Policastro

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2604.07463v2
- Source: https://arxiv.org/src/2604.07463v2 (sha256 `d7fe6649dc0bb1f030f6eb37f9d40b670bc0233620e684a025209069c7d1bc24`)
- Changed: [patches/arxiv-2604.07463.patch](patches/arxiv-2604.07463.patch). Written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   ’ (U+2019) -> \textquoteright: 1 in the source (4 missing-character lines in the log before) After the change the plain LuaLaTeX build reports none of these characters missing, and its page count is unchanged. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “Decoding multiway gravitational junctions in AdS in terms of holographic quantum maps” by Avik Chakraborty, Tanay Kibe, Martín Molina, Ayan Mukhopadhyay, Giuseppe Policastro, arXiv:2604.07463v2. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2604.08483

**Beyond the Static Approximation: Assessing the Impact of Conformational and Kinetic Broadening on the Description of TADF Emitters**

Daniel Beer, Jonas Weiser, Tom Gabler, Kirsten Zeitler, Carsten Deibel, Christian Wiebeler

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2604.08483v1
- Source: https://arxiv.org/src/2604.08483v1 (sha256 `9fabfc2ec72ba1f1f6d1ddca36b98f2c2e8c7fa1ef520e43f244de2dcc9ffe81`)
- Changed: [patches/arxiv-2604.08483.patch](patches/arxiv-2604.08483.patch). Written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   č (U+010D) -> \v c: 2 in the source (9 missing-character lines in the log before)   ė (U+0117) -> \.e: 3 in the source (9 missing-character lines in the log before)   š (U+0161) -> \v s: 1 in the source (3 missing-character lines in the log before)   ū (U+016B) -> \=u: 1 in the source (6 missing-character lines in the log before)   ‐ (U+2010) -> -: 2 in the source (6 missing-character lines in the log before)   – (U+2013) -> \textendash: 7 in the source (24 missing-character lines in the log before)   — (U+2014) -> \textemdash: 3 in the source (13 missing-character lines in the log before)   ‘ (U+2018) -> \textquoteleft: 1 in the source (4 missing-character lines in the log before)   ’ (U+2019) -> \textquoteright: 5 in the source (16 missing-character lines in the log before) After the change the plain LuaLaTeX build has the same page count, and 72 of these lines remain (č ė š ū – — ‘ ’): they come from the bibliography, which biber writes into the .bbl as UTF-8 again whatever form the .bib gives them. The ‐ in the .bib, now a plain -, no longer goes missing. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “Beyond the Static Approximation: Assessing the Impact of Conformational and Kinetic Broadening on the Description of TADF Emitters” by Daniel Beer, Jonas Weiser, Tom Gabler, Kirsten Zeitler, Carsten Deibel, Christian Wiebeler, arXiv:2604.08483v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2604.27268

**A Diagrammatic Axiomatisation of Behavioural Distance of Nondeterministic Processes**

Wojciech Różowski, Robin Piedeleu, Alexandra Silva, Fabio Zanasi

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ICALP.2026.190 (53rd International Colloquium on Automata, Languages, and Programming (ICALP 2026), LIPIcs vol. 374, paper 190, doi:10.4230/LIPIcs.ICALP.2026.190)
- Source: https://arxiv.org/src/2604.27268v1 (sha256 `b8c869b928c4186f650fdb72d0476eb61ab9df150815fb1b3a19c9fe6d89a081`)
- Changed: [patches/arxiv-2604.27268.patch](patches/arxiv-2604.27268.patch). Removes \usepackage[all,cmtip,2cell]{xy}, which no file of the paper uses (no \xymatrix, \xy or \ar[...]): with these options xy loads xypdf, which stops under LuaTeX. Also: the paper was written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   ż (U+017C) -> \.z: 4 in the source (55 missing-character lines in the log before)   – (U+2013) -> \textendash: 4 in the source (15 missing-character lines in the log before)   ’ (U+2019) -> \textquoteright: 1 in the source (3 missing-character lines in the log before) After the change the plain LuaLaTeX build reports none of these characters missing, and its page count is unchanged. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “A Diagrammatic Axiomatisation of Behavioural Distance of Nondeterministic Processes” by Wojciech Różowski, Robin Piedeleu, Alexandra Silva, Fabio Zanasi, arXiv:2604.27268v1 (published in ICALP 2026, LIPIcs vol. 374, 10.4230/LIPIcs.ICALP.2026.190). Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source, with a recorded patch.

## arxiv-2604.27474

**Computing the (k+2)-Edge-Connected Components in k-Edge-Connected Digraphs in Subquadratic Time**

Loukas Georgiadis, Evangelos Kipouridis, Evangelos Kosinas, Charis Papadopoulos, Nikos Parotsidis

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ICALP.2026.95 (53rd International Colloquium on Automata, Languages, and Programming (ICALP 2026), LIPIcs vol. 374, paper 95, doi:10.4230/LIPIcs.ICALP.2026.95)
- Source: https://arxiv.org/src/2604.27474v1 (sha256 `404e3465177e4a7f59e9345e30011734cd72ca25eb6126ae2bd331dacd1e252a`)
- Credit: “Computing the (k+2)-Edge-Connected Components in k-Edge-Connected Digraphs in Subquadratic Time” by Loukas Georgiadis, Evangelos Kipouridis, Evangelos Kosinas, Charis Papadopoulos, Nikos Parotsidis, arXiv:2604.27474v1 (published in ICALP 2026, LIPIcs vol. 374, 10.4230/LIPIcs.ICALP.2026.95). Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2604.27966

**Simpler and Improved Replacement Path Coverings**

Davide Bilò, Shiri Chechik, Keerti Choudhary, Sarel Cohen, Martin Schirneck

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ICALP.2026.35 (53rd International Colloquium on Automata, Languages, and Programming (ICALP 2026), LIPIcs vol. 374, paper 35, doi:10.4230/LIPIcs.ICALP.2026.35)
- Source: https://arxiv.org/src/2604.27966v1 (sha256 `dc848e7d8f3ff1d282bc2c09ce86d216f117c00a18ebd3edb71ede95f0730677`)
- Changed: [patches/arxiv-2604.27966.patch](patches/arxiv-2604.27966.patch). Written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   – (U+2013) -> \textendash: 1 in the source (3 missing-character lines in the log before)   ﬀ (U+FB00) -> ff: 1 in the source (4 missing-character lines in the log before) After the change the plain LuaLaTeX build reports none of these characters missing, and its page count is unchanged. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “Simpler and Improved Replacement Path Coverings” by Davide Bilò, Shiri Chechik, Keerti Choudhary, Sarel Cohen, Martin Schirneck, arXiv:2604.27966v1 (published in ICALP 2026, LIPIcs vol. 374, 10.4230/LIPIcs.ICALP.2026.35). Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2605.07289

**On the Complexity of the Matching Problem of Regular Expressions with Backreferences**

Soh Kumabe, Yuya Uezato

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ICALP.2026.135 (53rd International Colloquium on Automata, Languages, and Programming (ICALP 2026), LIPIcs vol. 374, paper 135, doi:10.4230/LIPIcs.ICALP.2026.135)
- Source: https://arxiv.org/src/2605.07289v1 (sha256 `d7f6a2fcdcf37dcbc565216b6a30f205e39af703231e445ff5d38fd49c1b0b38`)
- Credit: “On the Complexity of the Matching Problem of Regular Expressions with Backreferences” by Soh Kumabe, Yuya Uezato, arXiv:2605.07289v1 (published in ICALP 2026, LIPIcs vol. 374, 10.4230/LIPIcs.ICALP.2026.135). Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2605.07774

**Beyond Brooks: (Δ-1)-Coloring in Semi-Streaming**

Maxime Flin, Magnús M. Halldórsson

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ICALP.2026.92 (53rd International Colloquium on Automata, Languages, and Programming (ICALP 2026), LIPIcs vol. 374, paper 92, doi:10.4230/LIPIcs.ICALP.2026.92)
- Source: https://arxiv.org/src/2605.07774v1 (sha256 `96965090f66aa58a530fb0640915d235dddf2f1c8d5c22544b7c82f4d48ae62a`)
- Credit: “Beyond Brooks: (Δ-1)-Coloring in Semi-Streaming” by Maxime Flin, Magnús M. Halldórsson, arXiv:2605.07774v1 (published in ICALP 2026, LIPIcs vol. 374, 10.4230/LIPIcs.ICALP.2026.92). Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2605.09077

**Set Automata and Limits of Decidability of Two-Variable Logic on Data Words**

Shibashis Guha, Amaldev Manuel, S P Rishal

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ICALP.2026.181 (53rd International Colloquium on Automata, Languages, and Programming (ICALP 2026), LIPIcs vol. 374, paper 181, doi:10.4230/LIPIcs.ICALP.2026.181)
- Source: https://arxiv.org/src/2605.09077v1 (sha256 `3fc95fd932fd4d93f89550abe7448733832206a26a2e78bd4a546dd0843f7f7d`)
- Changed: [patches/arxiv-2605.09077.patch](patches/arxiv-2605.09077.patch). Written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   č (U+010D) -> \v c: 1 in the source (4 missing-character lines in the log before)   ń (U+0144) -> \'n: 2 in the source (4 missing-character lines in the log before)   ř (U+0159) -> \v r: 1 in the source (4 missing-character lines in the log before)   – (U+2013) -> \textendash: 5 in the source (6 missing-character lines in the log before) After the change the plain LuaLaTeX build reports none of these characters missing, and its page count is unchanged. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “Set Automata and Limits of Decidability of Two-Variable Logic on Data Words” by Shibashis Guha, Amaldev Manuel, S P Rishal, arXiv:2605.09077v1 (published in ICALP 2026, LIPIcs vol. 374, 10.4230/LIPIcs.ICALP.2026.181). Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2605.14987

**A Monte Carlo positronium decay source model with multiple annihilation channels in GATE**

Wojciech Krzemien, Mateusz Bala, Kamil Dulski, Wojciech Zdeb, Aurélien Coussat, Beatrix C. Hiesmayr, Konrad Klimaszewski, Michał Obara, Lech Raczyński, Roman Y. Shopa

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2605.14987v3
- Source: https://arxiv.org/src/2605.14987v3 (sha256 `95abee1349f6f632027a093532930c23732afd14905c58c899071c39de04583b`)
- Changed: [patches/arxiv-2605.14987.patch](patches/arxiv-2605.14987.patch). Written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   ł (U+0142) -> \l: 3 in the source (7 missing-character lines in the log before)   ń (U+0144) -> \'n: 3 in the source (17 missing-character lines in the log before)   Ś (U+015A) -> \'S: 1 in the source (3 missing-character lines in the log before)   – (U+2013) -> \textendash: 2 in the source (7 missing-character lines in the log before)   — (U+2014) -> \textemdash: 3 in the source (7 missing-character lines in the log before)   ’ (U+2019) -> \textquoteright: 1 in the source (3 missing-character lines in the log before)   “ (U+201C) -> \textquotedblleft: 1 in the source (3 missing-character lines in the log before)   ” (U+201D) -> \textquotedblright: 1 in the source (3 missing-character lines in the log before) After the change the plain LuaLaTeX build reports none of these characters missing, and its page count is unchanged. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “A Monte Carlo positronium decay source model with multiple annihilation channels in GATE” by Wojciech Krzemien, Mateusz Bala, Kamil Dulski, Wojciech Zdeb, Aurélien Coussat, Beatrix C. Hiesmayr, Konrad Klimaszewski, Michał Obara, Lech Raczyński, Roman Y. Shopa, arXiv:2605.14987v3. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2608.02046

**CompanionBench: A Theory-Anchored, Real-World-Grounded Benchmark for AI Emotional Companionship**

Yao Liu, Guangjia Chai, Yuming Huang, Jihao Huang, Lei Wang, Junchen Wan

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2608.02046v2
- Source: https://arxiv.org/src/2608.02046v2 (sha256 `9ec79a6fff16335f4fea29b6a57f369e7ca6f6f447af8cc1b66d3af57cabd5df`)
- Not built: Needs pdfTeX: the AAAI 2027 style stops under any other engine (\RequirePDFTeX).
- Credit: “CompanionBench: A Theory-Anchored, Real-World-Grounded Benchmark for AI Emotional Companionship” by Yao Liu, Guangjia Chai, Yuming Huang, Jihao Huang, Lei Wang, Junchen Wan, arXiv:2608.02046v2. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2608.05232

**Analysis of Numerical Localisation in LLM Translations**

Patrizia Kaye

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2608.05232v1
- Source: https://arxiv.org/src/2608.05232v1 (sha256 `739ee394615c2c3c6f8575f8f86576b72f94f879f8465c6d8e3726fc2411d1cf`)
- Not built: Needs pdfTeX: the MDPI class's pdftex option loads pdftex.def, which stops under LuaTeX.
- Credit: “Analysis of Numerical Localisation in LLM Translations” by Patrizia Kaye, arXiv:2608.05232v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2608.05234

**PPDL: LLM-Based Flows as Probabilistic Programs**

Louis Mandel, Guillaume Baudart, Mandana Vaziri, Martin Hirzel

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2608.05234v1
- Source: https://arxiv.org/src/2608.05234v1 (sha256 `23a3593f61cf0a6505d6d4c49fdbefd78219437f65726890cf976faa3c2af798`)
- Credit: “PPDL: LLM-Based Flows as Probabilistic Programs” by Louis Mandel, Guillaume Baudart, Mandana Vaziri, Martin Hirzel, arXiv:2608.05234v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2608.10916

**FaithformBench: Benchmarking Faithfulness of Mathematical Chain-of-Thought Autoformalisation**

Rob Cornish, Iacopo Ghinassi, Po-Hung Yeh, Shuqi Liu, Qiyuan Xu, Haoxuan Yin, Dominik Wagner, Wenda Li, Yee Whye Teh, Luke Ong

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2608.10916v1
- Source: https://arxiv.org/src/2608.10916v1 (sha256 `c83434671761abd8357f7ece327081f3e0df7c387e3027bf600d6250bc709240`)
- Not built: Needs pdfTeX: the AAAI 2027 style stops under any other engine (\RequirePDFTeX).
- Credit: “FaithformBench: Benchmarking Faithfulness of Mathematical Chain-of-Thought Autoformalisation” by Rob Cornish, Iacopo Ghinassi, Po-Hung Yeh, Shuqi Liu, Qiyuan Xu, Haoxuan Yin, Dominik Wagner, Wenda Li, Yee Whye Teh, Luke Ong, arXiv:2608.10916v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2608.10970

**ReLTEx: Reliable LLM-based Taxonomy Expansion**

Zeinab Ghamlouch, Mehwish Alam

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2608.10970v1
- Source: https://arxiv.org/src/2608.10970v1 (sha256 `842ff7f6a3a2a37591675187e59e1c1a45c162e458ad64c7723b042790757b8d`)
- Credit: “ReLTEx: Reliable LLM-based Taxonomy Expansion” by Zeinab Ghamlouch, Mehwish Alam, arXiv:2608.10970v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2608.10996

**ConRub-Med: Reinforcement Learning with Consensus Rubrics for Open-Ended Medical Question Answering**

Taojie Zhu, Yuan Xia, Tao Sun, Yizhi Wang, Yan Chen, Qunshan He, Tian Guan, Jian Wang, Jinjie Gu, Junwei Liu, Yonghong He

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2608.10996v1
- Source: https://arxiv.org/src/2608.10996v1 (sha256 `ac89d22e81d8b93d7957b3133b313576ab6d0f9254a057cac05fee4838ae257a`)
- Not built: Needs pdfTeX: the AAAI 2027 style stops under any other engine (\RequirePDFTeX).
- Credit: “ConRub-Med: Reinforcement Learning with Consensus Rubrics for Open-Ended Medical Question Answering” by Taojie Zhu, Yuan Xia, Tao Sun, Yizhi Wang, Yan Chen, Qunshan He, Tian Guan, Jian Wang, Jinjie Gu, Junwei Liu, Yonghong He, arXiv:2608.10996v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2608.25508

**Rare Exclusive Top Decays t → bM and Vector-Meson Helicity**

M.Ahmadi, M.Monemzadeh, N. Tazimi

- Licence: [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Published: https://arxiv.org/abs/2608.25508v1
- Source: https://arxiv.org/src/2608.25508v1 (sha256 `6eabb0cccc3d092af7df8b263de25d7fefb8d1804f299551bffc7120c7404d4b`)
- Credit: “Rare Exclusive Top Decays t → bM and Vector-Meson Helicity” by M.Ahmadi, M.Monemzadeh, N. Tazimi, arXiv:2608.25508v1. Licensed under CC0 1.0. Typeset here by reflowtex from the authors' source.

## arxiv-2608.25722

**Reconstructing f(R) gravity from generalized entropies: exact Lagrangians**

Ankit Anand, Sahil Devdutt, Kimet Jusufi, Ayan Chatterjee, Emmanuel N. Saridakis

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2608.25722v1
- Source: https://arxiv.org/src/2608.25722v1 (sha256 `5bfeccba49a1cf0c5dab95a14e67f4e13fe5437e84264e4ad998a24bd66217c0`)
- Credit: “Reconstructing f(R) gravity from generalized entropies: exact Lagrangians” by Ankit Anand, Sahil Devdutt, Kimet Jusufi, Ayan Chatterjee, Emmanuel N. Saridakis, arXiv:2608.25722v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.04638

**Can we further improve the central limit theorem for stationary ρ-mixing sequences?**

Muneya Matsui

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.04638v1
- Source: https://arxiv.org/src/2609.04638v1 (sha256 `cbc56fc8ff2358fadb852125241b28dc536091ee77a20ece4c6a5cbc807a9087`)
- Credit: “Can we further improve the central limit theorem for stationary ρ-mixing sequences?” by Muneya Matsui, arXiv:2609.04638v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.05048

**Kolmogorov's 0-1 law as false-truth law**

A.Deshpande

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.05048v1
- Source: https://arxiv.org/src/2609.05048v1 (sha256 `dcd703a3a99dfe83941f23323dd5628af5aba6a3416a00adcfd54c4fac4f998e`)
- Credit: “Kolmogorov's 0-1 law as false-truth law” by A.Deshpande, arXiv:2609.05048v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.10000

**Convergence of a single-ensemble multilevel scheme for McKean-Vlasov SDEs**

Arne Bouillon, Giovanni Samaey

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.10000v1
- Source: https://arxiv.org/src/2609.10000v1 (sha256 `ad02c08dd760deb06d2fe7c3205b14b05cf1968e2d8e153029a6752df64487c2`)
- Credit: “Convergence of a single-ensemble multilevel scheme for McKean-Vlasov SDEs” by Arne Bouillon, Giovanni Samaey, arXiv:2609.10000v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.11336

**Universal sampling of spin systems across quenched disorder**

Jing Liu, Yeyuan Wu, Ying Tang, Pan Zhang

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.11336v1
- Source: https://arxiv.org/src/2609.11336v1 (sha256 `c764eb8319a868b841d1238cf474be6fcf9dc38544cc69c0a85f43c18632173f`)
- Credit: “Universal sampling of spin systems across quenched disorder” by Jing Liu, Yeyuan Wu, Ying Tang, Pan Zhang, arXiv:2609.11336v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.11415

**Rare-History Transitions in Temporally Random Integrable Quantum Circuits**

Tingfei Li, Jie Gu

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.11415v1
- Source: https://arxiv.org/src/2609.11415v1 (sha256 `065746498017b6f6143e6e3b784cb62421831fb52087dd165e1c93e305d8de5a`)
- Credit: “Rare-History Transitions in Temporally Random Integrable Quantum Circuits” by Tingfei Li, Jie Gu, arXiv:2609.11415v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.11473

**Work as a function of protocol duration for the efficient erasure of an underdamped memory: isothermal to adiabatic transition**

Nicolas Barros, Stephen Whitelam, Sergio Ciliberto, Ludovic Bellon

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.11473v1
- Source: https://arxiv.org/src/2609.11473v1 (sha256 `e77e56cbcbdcb978086b2f5604791cbf5d7756e078e7047409e1add0d2d5f61e`)
- Credit: “Work as a function of protocol duration for the efficient erasure of an underdamped memory: isothermal to adiabatic transition” by Nicolas Barros, Stephen Whitelam, Sergio Ciliberto, Ludovic Bellon, arXiv:2609.11473v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.12672

**Two Recursions for the Seiberg-Witten Prepotential: Zamolodchikov's Recursion, the AGT Correspondence and Topological Recursion on the Seiberg-Witten Curve**

Bastam Tajik

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.12672v2
- Source: https://arxiv.org/src/2609.12672v2 (sha256 `c54ad4207abeb68fff4761f48e18a7a80a2dc1688458eafe859c8c7d42f48a29`)
- Changed: [patches/arxiv-2609.12672.patch](patches/arxiv-2609.12672.patch). Written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   – (U+2013) -> \textendash: 3 in the source (9 missing-character lines in the log before)   ’ (U+2019) -> \textquoteright: 2 in the source (8 missing-character lines in the log before) After the change the plain LuaLaTeX build reports none of these characters missing, and its page count is unchanged. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “Two Recursions for the Seiberg-Witten Prepotential: Zamolodchikov's Recursion, the AGT Correspondence and Topological Recursion on the Seiberg-Witten Curve” by Bastam Tajik, arXiv:2609.12672v2. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.13599

**Degrees of Fano Quiver Moduli**

Pengcheng Zhang

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.13599v1
- Source: https://arxiv.org/src/2609.13599v1 (sha256 `291714c394e1201c1f6e363221bf17fca4378e1cc6a41a369ebe1290c07270d4`)
- Credit: “Degrees of Fano Quiver Moduli” by Pengcheng Zhang, arXiv:2609.13599v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.14135

**Theta-duality and Prym-Torelli for cyclic covers of hyperelliptic curves**

Anatoli Shatsila

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.14135v1
- Source: https://arxiv.org/src/2609.14135v1 (sha256 `e9a70d84122758ca6de9cd7ea9339bdad9cd9200fa1766e109c1ed021d47e4e5`)
- Changed: [patches/arxiv-2609.14135.patch](patches/arxiv-2609.14135.patch). Written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   Ł (U+0141) -> \L: 1 in the source (3 missing-character lines in the log before)   ł (U+0142) -> \l: 2 in the source (8 missing-character lines in the log before) After the change the plain LuaLaTeX build reports none of these characters missing, and its page count is unchanged. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “Theta-duality and Prym-Torelli for cyclic covers of hyperelliptic curves” by Anatoli Shatsila, arXiv:2609.14135v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.14169

**Discriminants of Hermitian forms, maximal degenerations and Kontsevich's tropical approach to the Hodge conjecture**

Patrick Brosnan

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.14169v1
- Source: https://arxiv.org/src/2609.14169v1 (sha256 `d1ac2c3b70a067e7bb6330f3d603b4314b286049e6683e64cbfaf75d0aa67f60`)
- Credit: “Discriminants of Hermitian forms, maximal degenerations and Kontsevich's tropical approach to the Hodge conjecture” by Patrick Brosnan, arXiv:2609.14169v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.15409

**The effect of pressure confinement on the maximum mass of rapidly accreting supermassive stars**

Lorenz Zwick, Christopher Tiede, Zoltán Haiman

- Licence: [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Published: https://arxiv.org/abs/2609.15409v1
- Source: https://arxiv.org/src/2609.15409v1 (sha256 `ae9b652cf7326f03569acf1dfca57103b0e585128e75226eaef6ec4c8c398209`)
- Credit: “The effect of pressure confinement on the maximum mass of rapidly accreting supermassive stars” by Lorenz Zwick, Christopher Tiede, Zoltán Haiman, arXiv:2609.15409v1. Licensed under CC0 1.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.17460

**Toward Ku-Band Surface Acoustic Wave Delay Lines on AlScN-on-Diamond with Decoupled Phase and Group Velocities**

Tzu-Hsuan Hsu, Kapil Saha, Yuchen Ma, Vakhtang Chulukhadze, Pietro Simeoni, Matteo Rinaldi, Ruochen Lu

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.17460v1
- Source: https://arxiv.org/src/2609.17460v1 (sha256 `cfd53d63ce8badb67343d7d0bd2340cc070794320b0e26a95c486968831001b5`)
- Credit: “Toward Ku-Band Surface Acoustic Wave Delay Lines on AlScN-on-Diamond with Decoupled Phase and Group Velocities” by Tzu-Hsuan Hsu, Kapil Saha, Yuchen Ma, Vakhtang Chulukhadze, Pietro Simeoni, Matteo Rinaldi, Ruochen Lu, arXiv:2609.17460v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.18467

**Massive MIMO ISAC Under Target-Angle Uncertainty: CRLB Outage Analysis and Robust Resource Allocation**

Smriti Uniyal, Tianyu Fang, Van-Dinh Nguyen, Hien Quoc Ngo, Markku Juntti, Nhan Thanh Nguyen

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.18467v1
- Source: https://arxiv.org/src/2609.18467v1 (sha256 `1d018aea5de02cb5f5547c0353276adb94bceb1a364ebf2de71eb85eba8c67e7`)
- Credit: “Massive MIMO ISAC Under Target-Angle Uncertainty: CRLB Outage Analysis and Robust Resource Allocation” by Smriti Uniyal, Tianyu Fang, Van-Dinh Nguyen, Hien Quoc Ngo, Markku Juntti, Nhan Thanh Nguyen, arXiv:2609.18467v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.20044

**Noise-adjusted turnover in estimated networks**

Sultan Amed, Sayantan Banerjee

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.20044v2
- Source: https://arxiv.org/src/2609.20044v2 (sha256 `3331b833125e887cd7d181f0e8a21426010bd12599fcc16284168ed9e3af15cb`)
- Credit: “Noise-adjusted turnover in estimated networks” by Sultan Amed, Sayantan Banerjee, arXiv:2609.20044v2. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.20297

**Intact-to-Amputee Transfer in Surface-EMG Gesture Decoding: Training Source and Calibration Budget**

Jethro Odeyemi, W. J. Zhang

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.20297v1
- Source: https://arxiv.org/src/2609.20297v1 (sha256 `f62385e7a8332aa94da1b554233df7468e4b998662fc4afb76cccfa3bba47aef`)
- Credit: “Intact-to-Amputee Transfer in Surface-EMG Gesture Decoding: Training Source and Calibration Budget” by Jethro Odeyemi, W. J. Zhang, arXiv:2609.20297v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.21590

**Periodic Neural Mapping for Unsteady Rotor-Blade Pressure and Aeroelastic Load Prediction**

Lionel Salesses, Joachim Dominique, Tariq Benamara, Théo Flament, Franck Mastrippolito

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.21590v1
- Source: https://arxiv.org/src/2609.21590v1 (sha256 `616507c011acc92031878b52e32c30ea5f75281a7c3d2821316d20a7f47281a8`)
- Changed: [patches/arxiv-2609.21590.patch](patches/arxiv-2609.21590.patch). Written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   – (U+2013) -> \textendash: 2 in the source (8 missing-character lines in the log before)   — (U+2014) -> \textemdash: 5 in the source (12 missing-character lines in the log before)   ’ (U+2019) -> \textquoteright: 4 in the source (16 missing-character lines in the log before)   “ (U+201C) -> \textquotedblleft: 1 in the source (4 missing-character lines in the log before)   ” (U+201D) -> \textquotedblright: 1 in the source (4 missing-character lines in the log before) After the change the plain LuaLaTeX build reports none of these characters missing, and its page count is unchanged. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “Periodic Neural Mapping for Unsteady Rotor-Blade Pressure and Aeroelastic Load Prediction” by Lionel Salesses, Joachim Dominique, Tariq Benamara, Théo Flament, Franck Mastrippolito, arXiv:2609.21590v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.22006

**All-Optical Control over Nonlocality for Ultrafast Image Processing with an Excitonic Metasurface**

Bernardo S. Dias, Romain Tirole, Michele Guizzardi, Andrea Cordaro, Albert Polman, Andrea Alù, Jorik van de Groep

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.22006v1
- Source: https://arxiv.org/src/2609.22006v1 (sha256 `84db75e7175a18940daa620bd922ddb684c91e26202c3eb94dff6443c8004759`)
- Credit: “All-Optical Control over Nonlocality for Ultrafast Image Processing with an Excitonic Metasurface” by Bernardo S. Dias, Romain Tirole, Michele Guizzardi, Andrea Cordaro, Albert Polman, Andrea Alù, Jorik van de Groep, arXiv:2609.22006v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.22225

**Do LLMs Choose Like Humans? Using Cognitive Theory to Evaluate LLM Decision-Making**

Johnathan Sun, Andrei Shleifer, Yonatan Belinkov

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.22225v1
- Source: https://arxiv.org/src/2609.22225v1 (sha256 `30f0722dff60e096703df662accf70a46d5579da7f80fbb20faf4a448257edec`)
- Changed: [patches/arxiv-2609.22225.patch](patches/arxiv-2609.22225.patch). Written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   ć (U+0107) -> \'c: 1 in the source (8 missing-character lines in the log before)   ě (U+011B) -> \v e: 1 in the source (4 missing-character lines in the log before)   ő (U+0151) -> \H o: 1 in the source (5 missing-character lines in the log before)   ’ (U+2019) -> \textquoteright: 12 in the source (5 missing-character lines in the log before) After the change the plain LuaLaTeX build reports none of these characters missing, and its page count is unchanged. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “Do LLMs Choose Like Humans? Using Cognitive Theory to Evaluate LLM Decision-Making” by Johnathan Sun, Andrei Shleifer, Yonatan Belinkov, arXiv:2609.22225v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.22988

**Rethinking Pivot Programming Languages in Code Language Models**

Andor Diera, Lukas Galke Poech, Matthias Tichy

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.22988v1
- Source: https://arxiv.org/src/2609.22988v1 (sha256 `150d2f6c0d672c595ce47f66565c0e567cf113f386ca80aff396456cf6de847c`)
- Changed: [patches/arxiv-2609.22988.patch](patches/arxiv-2609.22988.patch). Written for pdfLaTeX: UTF-8 text in an 8-bit font encoding; characters replaced by LaTeX's own definitions (t1enc.dfu, what pdfLaTeX's inputenc gives them), braced where the definition is a command. Under LuaLaTeX these characters reached the 8-bit font unchanged and were lost ("Missing character" in the log). Replaced outside comments, verbatim, listings and URLs:   – (U+2013) -> \textendash: 8 in the source (33 missing-character lines in the log before)   ’ (U+2019) -> \textquoteright: 1 in the source (4 missing-character lines in the log before) After the change the plain LuaLaTeX build reports none of these characters missing, and its page count is unchanged. The source is CC BY 4.0, which allows modified copies with the change indicated: this file is that indication.
- Credit: “Rethinking Pivot Programming Languages in Code Language Models” by Andor Diera, Lukas Galke Poech, Matthias Tichy, arXiv:2609.22988v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-2609.23125

**Perplexity Cost Understates What Activation Quantisation Breaks**

Anish Sathyanarayanan

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/2609.23125v1
- Source: https://arxiv.org/src/2609.23125v1 (sha256 `93ce4f544ec40914f8e60cf0d2f6a2d0e43e3223642685958c9b906730a3dfc8`)
- Credit: “Perplexity Cost Understates What Activation Quantisation Breaks” by Anish Sathyanarayanan, arXiv:2609.23125v1. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## arxiv-cond-mat_0604591

**Generalized Bell inequalities and frustrated spin systems**

Heinz-Jürgen Schmidt

- Licence: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
- Published: https://arxiv.org/abs/cond-mat/0604591v2
- Source: https://arxiv.org/src/cond-mat/0604591v2 (sha256 `dd8485b31ac5f4acc94c01b7b1418e0a2efdc6e4ceacf0a0eaaaf5a740f6a565`)
- Credit: “Generalized Bell inequalities and frustrated spin systems” by Heinz-Jürgen Schmidt, arXiv:cond-mat/0604591v2. Licensed under CC BY 4.0. Typeset here by reflowtex from the authors' source.

## ctan-lshort-english

**The Not So Short Introduction to LaTeX**

Tobias Oetiker, Hubert Partl, Irene Hyna, Elisabeth Schlegl

- Licence: [GPL-2.0-or-later](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html)
- Published: https://ctan.org/pkg/lshort-english
- Source: https://mirrors.ctan.org/info/lshort/english/lshort-6.4.src.tar.gz (sha256 `19aec8a80a10d0e5a32ae628cfc0e2f49e6edf17a7102edb211ae4401addbc7f`)
- Changed: [patches/ctan-lshort-english.patch](patches/ctan-lshort-english.patch). lshort.sty, its LuaTeX branch: \setsansfont, \setmonofont and \setmainfont came before luatextra, which loads fontspec, so they were undefined, Latin Modern stayed the main font and polyglossia found no Greek or Cyrillic; luatextra now comes first. \RequirePackage[all]{xy} is commented out: the book has no xy diagrams, and xy's xypdf refuses LuaTeX; xy's \Xy logo, which the bibliography uses, is defined as xy.tex defines it. lshort is GPL-2.0-or-later, which allows modified copies: this file records the change.
- Credit: “The Not So Short Introduction to LaTeX” by Tobias Oetiker, Hubert Partl, Irene Hyna, Elisabeth Schlegl, CTAN, lshort 6.4. Licensed under the GNU GPL, version 2 or later. Typeset here by reflowtex from the authors' source, with a recorded patch.
