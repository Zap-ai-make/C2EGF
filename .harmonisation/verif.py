#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Controle mecanique du pack de standards.

Usage :  python .harmonisation/verif.py [REF_GIT]

La reference de non-regression est lue depuis git (tag `origine` par
defaut), pas depuis un dossier temporaire : n'importe quel relecteur
peut donc rejouer ce script depuis le depot seul.

Sortie 0 = tout passe. Sortie 1 = au moins un controle en echec.
"""
import re, os, sys, glob, subprocess, unicodedata

PACK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = sys.argv[1] if len(sys.argv) > 1 else "origine"

# Documents SUR le pack (procedure, rapports) : ils citent des noms de
# fichiers et des §N d'autres fichiers, et ne suivent pas le gabarit des
# contrats. Ils ne sont pas membres du pack.
HORS_PACK = {"PROMPTS.md", "RAPPORT-HARMONISATION.md", "REVIEW-CODEX.md"}
# Fichiers produits par le workflow ou la boucle de revue, absents du pack.
LIVRABLES = {"ROADMAP.md", "RAPPORT-HARMONISATION.md", "REVIEW-CODEX.md"}
# Fichiers sans sections numerotees, par conception.
SANS_SECTIONS = {"AGENTS.md", "SPEC.template.md"}
# CLAUDE.md ne contient qu'une directive : aucun titre, c'est sa contrainte.
SANS_TITRE = {"CLAUDE.md"}

files = {os.path.basename(p): open(p, encoding="utf-8").read()
         for p in sorted(glob.glob(os.path.join(PACK, "*.md")))}


def au_depart(nom):
    """Contenu du fichier a la reference git, ou None s'il n'existait pas."""
    try:
        return subprocess.check_output(
            ["git", "-C", PACK, "show", "%s:%s" % (REF, nom)],
            stderr=subprocess.DEVNULL).decode("utf-8")
    except subprocess.CalledProcessError:
        return None


fail = []


def check(label, problems):
    if problems:
        fail.append(label)
        print("ECHEC  %s" % label)
        for p in problems[:20]:
            print("       - %s" % p)
    else:
        print("OK     %s" % label)


def headings(txt):
    return set(int(m) for m in re.findall(r"^## (\d+)\.", txt, re.M))


heads = {n: headings(t) for n, t in files.items()}
ref_re = re.compile(r"`?([A-Za-z][A-Za-z.\-]*\.md)`?\s*§\s*(\d+)")

# --- 1. renvois "<FICHIER>.md §N" ----------------------------------------
problems = []
for name, txt in files.items():
    for target, num in ref_re.findall(txt):
        if target not in files:
            problems.append("%s renvoie a %s (fichier absent)" % (name, target))
        elif int(num) not in heads[target]:
            problems.append("%s renvoie a %s §%s (section absente)"
                            % (name, target, num))
check("renvois inter-fichiers <FICHIER>.md §N", problems)

# --- 2. renvois internes "§N" --------------------------------------------
problems = []
for name, txt in files.items():
    if name in HORS_PACK or name in SANS_TITRE:
        continue
    for num in re.findall(r"§\s*(\d+)", ref_re.sub(" ", txt)):
        if int(num) not in heads[name]:
            problems.append("%s: §%s interne ne correspond a aucune section"
                            % (name, num))
check("renvois internes §N", problems)

# --- 3. aucun §N pendant dans les fichiers sans sections numerotees ------
problems = []
for name in SANS_SECTIONS:
    if name in files and re.search(r"§", ref_re.sub(" ", files[name])):
        problems.append("%s contient un §N non qualifie alors qu'il n'a "
                        "aucune section numerotee" % name)
check("aucun §N pendant (AGENTS.md, SPEC.template.md)", problems)

# --- 4. fichiers .md mentionnes existent ---------------------------------
problems = []
for name, txt in files.items():
    if name in HORS_PACK:
        continue
    for target in set(re.findall(r"`?([A-Z][A-Za-z.\-]*\.md)`?", txt)):
        if target not in files and target not in LIVRABLES:
            problems.append("%s mentionne %s (inexistant)" % (name, target))
check("fichiers .md mentionnes", problems)

# --- 5. aucun emoji -------------------------------------------------------
problems = []
for name, txt in files.items():
    bad = set(c for c in txt
              if ord(c) > 0x2000 and unicodedata.category(c) in ("So", "Sk"))
    if bad:
        problems.append("%s: %r" % (name, bad))
check("aucun emoji", problems)

# --- 6. cases a cocher bien formees --------------------------------------
problems = []
for name in ("DESIGN.md", "SECURITY.md", "SPEC.template.md"):
    for i, line in enumerate(files[name].splitlines(), 1):
        if re.match(r"^ [A-ZÀ-Ü<]", line):
            problems.append("%s:%d ligne a espace nue: %s"
                            % (name, i, line[:50]))
    if "- [ ]" not in files[name]:
        problems.append("%s: aucune case a cocher" % name)
check("cases a cocher restaurees", problems)

# --- 7. titres markdown ---------------------------------------------------
problems = []
for name, txt in files.items():
    if name in HORS_PACK or name in SANS_TITRE:
        continue
    if not txt.startswith("# "):
        problems.append("%s n'ouvre pas sur un titre H1" % name)
    if not heads[name] and name not in SANS_SECTIONS:
        problems.append("%s n'a aucune section ##" % name)
check("titres markdown (contrats, workflow, gabarit, annexe)", problems)

# --- 8. CLAUDE.md : directive unique -------------------------------------
problems = []
lignes = [l for l in files["CLAUDE.md"].splitlines() if l.strip()]
if lignes != ["Lis et applique AGENTS.md."]:
    problems.append("CLAUDE.md doit contenir cette seule ligne, sans titre : %r"
                    % lignes)
check("CLAUDE.md : directive unique", problems)


# --- 9. NON-REGRESSION du contenu protege --------------------------------
def norm(s):
    s = s.replace("**", "").replace("`", "").replace("*", "")
    s = re.sub(r"^\s*(?:[-•]|\d+\.)\s*", "", s, flags=re.M)
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", s)).strip().lower()


def section(txt, num, md):
    pat = r"^## %d\." % num if md else r"^%d\. " % num
    nxt = r"^## \d+\." if md else r"^\d+\. "
    m = re.search(pat, txt, re.M)
    if not m:
        return None
    rest = txt[m.end():]
    n = re.search(nxt, rest, re.M)
    return rest[:n.start()] if n else rest


# Sections dont le contenu ne doit jamais disparaitre ni s'affaiblir.
# (md=False : a la reference, ces fichiers n'avaient pas de titres markdown.)
PROTEGE = [
    ("WORKFLOW.md", [1], False),          # les trois points d'arret
    ("SECURITY.md", list(range(1, 12)), False),   # tous les non-negociables
    ("DESIGN.md", [5, 8, 10, 11], False),  # contraste, emoji, etats, a11y
    ("ARCHITECTURE.md", [1], True),        # echelle + garde-fous absolus
]

# Fragments de la reference deliberement remplaces, avec leur motif.
# Toute autre disparition est un echec. Ces derogations sont affichees a
# chaque execution : elles restent visibles, elles ne se taisent pas.
DEROGATIONS = [
    ("tout vit dans un .env local",
     "REVIEW-CODEX C2 : un .env n'est pas un mecanisme de production ; "
     "remplace par une regle par environnement (SECURITY.md §2)."),
    ("un scan de secrets tourne pendant le dev et bloque le commit",
     "REVIEW-CODEX C3 : exigence conservee, outil nomme rendu remplacable "
     "(SECURITY.md §2 et §0)."),
    ("un scan de composants (sca) tourne pendant le dev",
     "REVIEW-CODEX C3 : idem pour les dependances (SECURITY.md §9 et §0)."),
]

problems, derogations_vues = [], []
for name, nums, md_ref in PROTEGE:
    ref_txt = au_depart(name)
    if ref_txt is None:
        problems.append("%s absent de la reference git %s" % (name, REF))
        continue
    courant = norm(files[name])
    for num in nums:
        old = section(ref_txt, num, md_ref)
        if old is None:
            problems.append("%s §%d introuvable a la reference" % (name, num))
            continue
        for frag in old.splitlines():
            f = norm(frag)
            if len(f) < 25 or f in courant:
                continue
            motif = next((m for cle, m in DEROGATIONS if cle in f), None)
            if motif:
                derogations_vues.append("%s §%d — %s" % (name, num, motif))
            else:
                problems.append("%s §%d PERDU: %s" % (name, num, f[:75]))
check("non-regression du contenu protege (reference: %s)" % REF, problems)

if derogations_vues:
    print()
    print("DEROGATIONS AUTORISEES (%d) — modifications deliberees du contenu "
          "protege :" % len(derogations_vues))
    for d in sorted(set(derogations_vues)):
        print("       - %s" % d)

print()
print("=" * 62)
print("RESULTAT : %s"
      % ("TOUT PASSE" if not fail else "%d controle(s) en echec" % len(fail)))
sys.exit(1 if fail else 0)
