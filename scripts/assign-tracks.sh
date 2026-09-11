#!/usr/bin/env bash
#
# Reparte los 49 issues en dos tracks independientes.
#
#   Uso:  bash scripts/assign-tracks.sh owner/repo
#
# Idempotente: se puede volver a correr sin efectos secundarios.
#
# El criterio del reparto y el contrato entre tracks estan en
# docs/03-REPARTO.md. No cambies esta lista sin actualizar ese documento.

set -euo pipefail

REPO="${1:?Uso: bash scripts/assign-tracks.sh owner/repo}"

DEV_A="Rfusco22-supricom"   # Track A — Core y Vendedores
DEV_B="LinoGouveia"         # Track B — API publica y Kiosco

LABEL_A="track:A-core-vendedores"
LABEL_B="track:B-api-kiosco"

# Track A — 25 issues. Middleware core, identidad, modulo de vendedores.
ISSUES_A=(1 2 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 44 46 47 48 50 51 52 53 54)

# Track B — 24 issues. Descubrimiento de catalogo, API publica, kiosco.
ISSUES_B=(3 4 5 6 7 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 45 49)

echo "==> Repo: $REPO"
echo "    Track A -> $DEV_A  (${#ISSUES_A[@]} issues)"
echo "    Track B -> $DEV_B  (${#ISSUES_B[@]} issues)"

# ── Labels de track ──────────────────────────────────────────────────────────
echo ""
echo "==> Labels de track..."
gh label create "$LABEL_A" --repo "$REPO" --color "1D76DB" \
  --description "Core del middleware, identidad y modulo de vendedores" --force >/dev/null
gh label create "$LABEL_B" --repo "$REPO" --color "D93F0B" \
  --description "Descubrimiento de catalogo, API publica y kiosco movil" --force >/dev/null
echo "    · $LABEL_A"
echo "    · $LABEL_B"

# ── Puede asignarse? ─────────────────────────────────────────────────────────
# GitHub solo permite asignar a colaboradores que ya aceptaron la invitacion.
# Si esta pendiente, las labels igual dejan el reparto registrado.
can_assign() {
  gh api "repos/$REPO/collaborators/$1" --silent 2>/dev/null
}

ASSIGN_A=false
ASSIGN_B=false
can_assign "$DEV_A" && ASSIGN_A=true
can_assign "$DEV_B" && ASSIGN_B=true

echo ""
if [ "$ASSIGN_B" = false ]; then
  echo "    ! $DEV_B todavia no acepto la invitacion al repo."
  echo "      Se aplican las labels ahora; vuelve a correr este script cuando acepte"
  echo "      para que ademas queden asignados los issues."
  echo ""
fi

apply() {
  local number="$1" label="$2" dev="$3" assign="$4"
  local args=(--repo "$REPO" --add-label "$label")
  [ "$assign" = true ] && args+=(--add-assignee "$dev")
  gh issue edit "$number" "${args[@]}" >/dev/null
  printf '    #%-3s -> %s\n' "$number" "$dev"
}

echo "==> Track A ($DEV_A)..."
for n in "${ISSUES_A[@]}"; do apply "$n" "$LABEL_A" "$DEV_A" "$ASSIGN_A"; done

echo ""
echo "==> Track B ($DEV_B)..."
for n in "${ISSUES_B[@]}"; do apply "$n" "$LABEL_B" "$DEV_B" "$ASSIGN_B"; done

echo ""
echo "==> Listo. $((${#ISSUES_A[@]} + ${#ISSUES_B[@]})) issues repartidos."
[ "$ASSIGN_B" = false ] && echo "    Recuerda re-correrlo cuando $DEV_B acepte la invitacion."
exit 0
