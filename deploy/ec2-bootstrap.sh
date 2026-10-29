#!/usr/bin/env bash
# Prepara una instancia Amazon Linux 2023 para el contenedor de Notificaciones.
# Ejecutar como ec2-user con sudo disponible.
set -euo pipefail

APP_DIR="/opt/fleetops"
SECRETS_DIR="${APP_DIR}/secrets"

if ! command -v docker >/dev/null 2>&1; then
  echo "Instalando Docker..."
  sudo dnf install -y docker
  sudo systemctl enable --now docker
  sudo usermod -aG docker ec2-user
else
  sudo systemctl enable --now docker
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin no encontrado. Instálelo antes de continuar." >&2
  exit 1
fi

sudo mkdir -p "${SECRETS_DIR}"
sudo chown -R ec2-user:ec2-user "${APP_DIR}"

if compgen -G "${SECRETS_DIR}/*.json" >/dev/null; then
  sudo chown 1000:1000 "${SECRETS_DIR}"/*.json
  sudo chmod 600 "${SECRETS_DIR}"/*.json
fi

echo "Listo. Siguientes pasos:"
echo "1. Copie .env.production.example a ${APP_DIR}/.env y complete los valores."
echo "2. Verifique el JSON de Firestore en ${SECRETS_DIR}."
echo "3. Agregue los secretos EC2_* y DOCKERHUB_* en GitHub."
