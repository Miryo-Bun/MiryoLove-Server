#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir="${BACKUP_DIR:-$project_dir/backups}"
passphrase_file="${BACKUP_PASSPHRASE_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/miryolove/backup-passphrase}"
kind="${1:-daily}"

case "$kind" in
  daily) review_threshold=14 ;;
  weekly) review_threshold=8 ;;
  monthly) review_threshold=12 ;;
  *)
    printf 'Usage: %s {daily|weekly|monthly}\n' "$0" >&2
    exit 2
    ;;
esac

if [[ ! -f "$passphrase_file" ]]; then
  printf 'Backup passphrase file is missing; see docs/BACKUPS.md.\n' >&2
  exit 1
fi
if [[ "$(stat -c '%a' "$passphrase_file")" != "600" ]]; then
  printf 'Backup passphrase file must have mode 600.\n' >&2
  exit 1
fi
for command_name in docker gpg pg_restore tar gzip sha256sum realpath wc; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command is missing: %s\n' "$command_name" >&2
    exit 1
  fi
done

mkdir -p -- "$backup_dir"
chmod 700 -- "$backup_dir"
backup_dir_realpath="$(realpath -e -- "$backup_dir")"
passphrase_realpath="$(realpath -e -- "$passphrase_file")"
case "$passphrase_realpath" in
  "$backup_dir_realpath"/*)
    printf 'Backup passphrase must not be stored in the backup directory.\n' >&2
    exit 1
    ;;
esac
stage_dir="$(mktemp -d "$backup_dir/.backup-stage.XXXXXXXX")"
archive_name="${kind}-$(date -u +%Y%m%dT%H%M%SZ).tar.gz.gpg"
final_path="$backup_dir/$archive_name"
encrypted_tmp="$stage_dir/$archive_name"
plain_tmp="$stage_dir/backup.tar.gz"
verify_dir="$stage_dir/verify"
trap 'rm -rf -- "$stage_dir"' EXIT

if [[ -e "$final_path" ]]; then
  printf 'Refusing to overwrite an existing backup.\n' >&2
  exit 1
fi

docker compose -f "$project_dir/docker-compose.yml" -p miryoloveserver \
  exec -T postgres sh -ec \
  'exec pg_dump --format=custom --no-owner --no-acl --username="$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$stage_dir/database.dump"

tar -czf "$stage_dir/project.tar.gz" -C "$project_dir" \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=postgres-data \
  --exclude=src/generated \
  --exclude=backups \
  --exclude=coverage \
  --exclude=logs \
  --exclude='*.log' \
  app.py src prisma tests docs scripts \
  README.md README.ru.md .env.example docker-compose.yml package.json package-lock.json \
  tsconfig.json prisma.config.ts eslint.config.js prettier.config.js .gitignore

tar -czf "$plain_tmp" -C "$stage_dir" database.dump project.tar.gz
gpg --batch --yes --pinentry-mode loopback --passphrase-file "$passphrase_file" \
  --symmetric --cipher-algo AES256 --output "$encrypted_tmp" "$plain_tmp"

mkdir -p -- "$verify_dir"
gpg --batch --pinentry-mode loopback --passphrase-file "$passphrase_file" \
  --decrypt --output "$verify_dir/backup.tar.gz" "$encrypted_tmp"
tar -tzf "$verify_dir/backup.tar.gz" >/dev/null
tar -xzf "$verify_dir/backup.tar.gz" -C "$verify_dir"
pg_restore --list "$verify_dir/database.dump" >/dev/null
tar -tzf "$verify_dir/project.tar.gz" >/dev/null
printf '%s  %s\n' "$(sha256sum "$encrypted_tmp" | cut -d' ' -f1)" "$archive_name" \
  > "$stage_dir/$archive_name.sha256"
(cd "$stage_dir" && sha256sum -c "$archive_name.sha256")

mv -- "$encrypted_tmp" "$final_path"
mv -- "$stage_dir/$archive_name.sha256" "$final_path.sha256"
chmod 600 -- "$final_path" "$final_path.sha256"

backup_count="$(find "$backup_dir" -maxdepth 1 -type f -name "$kind-*.tar.gz.gpg" | wc -l)"
printf 'Verified encrypted %s backup: %s\n' "$kind" "$final_path"
if (( backup_count > review_threshold )); then
  printf 'Retention review required: %s %s backups exist; no backups were deleted.\n' \
    "$backup_count" "$kind" >&2
fi
