# Эксплуатация и обслуживание

## Перед изменениями

1. Проверить ветку, diff, `DATABASE_URL` target и доступность последнего зашифрованного backup.
2. Для миграций — отдельная staging БД, `npx prisma validate`, `npm run db:deploy` только после DBA review.
3. Не копировать `.env` в тикеты/логи и не запускать destructive операции над рабочей БД.

## Обычные проверки

```sh
npm test
npm run build
npm run lint
npm run format:check
npm audit
npm audit --omit=dev
npx prisma validate
docker compose ps
```

`docker compose config` требует явного `POSTGRES_PASSWORD`; для синтаксической проверки можно передать только непроизводственное временное значение в команду, не применяя Compose. В production сначала безопасно согласовать credential с DBA. Не менять password в `.env` как способ восстановить существующую DB: environment переменная не меняет пароль на уже инициализированном volume. Не применять конфигурацию/перезапуск к production без согласованного плана.

## Запуск и отказ

Compose управляет PostgreSQL, не API и не AI runtime. Приложение запускается `npm start`; проверять `/health` и `/health/db`. Перед остановкой соблюдать текущий lifecycle сервера. Не удалять Compose volume для «починки».

## Backup и инциденты

См. [BACKUPS.md](BACKUPS.md) и [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md). Настроить мониторинг успешности, период тестового восстановления и доступность ключа отдельно; текущий скрипт запускается вручную. Не считать локальный backup защитой от потери всего хоста.

## Периодическое обслуживание

- Проверять Node/Prisma/PostgreSQL/security advisories и тестировать совместимые обновления.
- Проверять истёкшие сессии, доступы роли, объём БД/диска и retention logs/backups.
- Пересматривать CORS origins, OAuth callback URLs и внешние endpoints.
- Проверять восстановление backup на изолированной среде до обновления схемы.
- Утвердить срок хранения и порядок обращений с владельцем/юристом.
- Старые резервные копии не удаляются скриптом автоматически; пороги в `scripts/backup.sh` только выдают предупреждение и не являются retention-политикой.
- План least-privilege ролей и PostgreSQL TLS описан в [DATABASE_SECURITY.md](DATABASE_SECURITY.md), но не применён. Не менять production роли, пароль, HBA, сертификаты или `DATABASE_URL` без отдельного разрешения, проверенного backup и rollback.
