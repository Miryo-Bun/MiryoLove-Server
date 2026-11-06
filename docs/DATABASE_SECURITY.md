# PostgreSQL и Prisma

## Наблюдаемое состояние

- PostgreSQL `17.11`, образ Compose `postgres:17-alpine`, named volume `miryoloveserver_miryolove-postgres-data`.
- Проверенное соединение приходило из Compose bridge; PostgreSQL сообщил `ssl=false`.
- База `miryolove`, роль приложения `miryo_user` имела SUPERUSER, CREATEDB и CREATEROLE. Другая обнаруженная login-role не была superuser. Значения credential не выводились.
- Подключение ORM — Prisma 7 + `@prisma/adapter-pg`; миграции init и nullable `messages.sources` отмечены применёнными.
- Таблицы `users`, `oauth_accounts`, `sessions`, `chats`, `messages`, `_prisma_migrations`; индексы/unique/FK определены в Prisma schema и миграциях.
- В Compose порт БД публикуется на loopback хоста; наружная firewall-конфигурация отдельно не проверена.

## Разделение ролей

Исходная проблема: ранее проверенная runtime login-role `miryo_user` имела `SUPERUSER`, `CREATEDB` и `CREATEROLE`; у неё также были избыточные права на объекты. Эти права не менялись в базе данных.

### HIGH: существующая БД требует отдельного перехода

Статус: **не исправлено в текущей БД; требуется DBA/оператор**. Привилегии, указанные выше, были зафиксированы предыдущей проверкой, но в этой работе состояние работающей БД повторно не проверялось и подключения к ней не выполнялись. Новые Compose init-скрипты не запускаются на существующем volume и не меняют существующие роли. Если production-сервис всё ещё использует `miryo_user`, его runtime-доступ остаётся чрезмерным до отдельного одобренного перехода.

Перед переключением DBA должен проверить effective privileges уже настроенной runtime-роли на изолированной копии, выполнить миграционный и прикладной тесты, а после переключения подтвердить ограничения на целевой базе:

```sql
SELECT current_user,
       NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
         AND NOT rolreplication AND NOT rolbypassrls AS has_no_admin_attributes
FROM pg_roles
WHERE rolname = current_user;

SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public,
       has_table_privilege(current_user, 'public._prisma_migrations', 'SELECT')
         AS can_read_migration_history;
```

Для runtime-роли ожидаются `has_no_admin_attributes = true`, `can_create_in_public = false` и `can_read_migration_history = false`. Проверки выполнять подключившись именно тем runtime URL, который будет передан HTTP-сервису; не выводить URL/пароль в журнал. Это проверка конфигурации, а не разрешение менять текущую БД.

Для **нового пустого PostgreSQL volume** Compose монтирует `scripts/postgres/10-create-roles.sql` в `docker-entrypoint-initdb.d`. Скрипт создаёт разные роли:

- `POSTGRES_USER` — bootstrap/admin роль образа PostgreSQL. Не задавать её в URL HTTP-сервиса.
- `POSTGRES_APP_USER` — runtime login-role. Получает `CONNECT`, `USAGE` на `public` и DML только на пяти прикладных таблицах. Не получает DDL, доступ к `_prisma_migrations`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, `CREATEDB`, `CREATEROLE` или `SUPERUSER`.
- `POSTGRES_MIGRATOR_USER` — отдельная migration-role без `SUPERUSER`, `CREATEDB` и `CREATEROLE`. Получает `CREATE` только в этой базе (для Prisma `CREATE SCHEMA IF NOT EXISTS`) и в `public`; создание и изменение схемы не входит в полномочия runtime. DML runtime выдаётся отдельным allowlist-скриптом после миграций.

Compose требует отдельные непустые секреты `POSTGRES_APP_PASSWORD` и `POSTGRES_MIGRATOR_PASSWORD`; задайте уникальные значения через локальную конфигурацию/secret manager и не добавляйте их в Git. Серверный процесс должен получать runtime URL в `DATABASE_URL`; только команды миграции получают `MIGRATION_DATABASE_URL`. `npm run db:migrate` и `npm run db:deploy` завершаются ошибкой, если миграционный URL не задан. Не передавайте migration URL HTTP-сервису.

Bootstrap SQL безопасно формирует имена ролей и литералы паролей через psql, блокирует совпадения имён трёх ролей, ограничивает атрибуты login-ролей и отзывает `CONNECT` у `PUBLIC` для этой базы. После `npm run db:deploy` администратор должен применить runtime allowlist:

```sh
docker compose exec postgres sh -c 'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --file /opt/miryolove/postgres/20-grant-runtime.sql'
```

Скрипт выдаёт runtime DML только на текущие прикладные таблицы и `USAGE` на используемые enum-типы, исключая `_prisma_migrations`. Повторно проверить и дополнить этот allowlist при миграции, меняющей таблицы, enum-типы или sequences. Это не включает row-level security: изоляция строк пользователей по-прежнему обеспечивается приложением.

**Существующий volume не изменяется автоматически.** Скрипты `docker-entrypoint-initdb.d` запускаются только при первоначальной инициализации пустого каталога данных. Не удалять volume и не пересоздавать базу для применения настройки. Для существующей БД надо проверить роли/grants/владельцев на изолированной восстановленной копии, подготовить backup и согласовать переключение с DBA. Применение bootstrap SQL к существующей БД создаёт/обновляет роли, grants и ACL; это требует отдельного одобрения. Существующие таблицы/типы останутся во владении старого владельца, поэтому migration-role может не иметь возможности изменять их. Перенос ownership должен быть отдельно проверен для таблиц, enum/types, sequences и `_prisma_migrations` до миграционного deployment.

### План безопасного перехода и отката

1. Создать изолированную копию существующей базы из проверенного зашифрованного backup; проверить владельцев таблиц/types, grants, миграционную историю и доступность всех приложенческих CRUD-операций, не выгружая строки пользователей в отчёт.
2. На копии отдельно применить role bootstrap и согласованный ownership transition; выполнить `npm run db:deploy` с `MIGRATION_DATABASE_URL`, применить `20-grant-runtime.sql`, затем негативные проверки: runtime не может создавать/изменять объекты, базы, роли или читать `_prisma_migrations`.
3. Прогнать регистрацию, OAuth, login/logout, профиль, chat CRUD, сообщения и удаление с runtime `DATABASE_URL`. Убедиться, что migration URL отсутствует в окружении HTTP-сервиса.
4. Лишь после одобрения DBA и владельца сервиса выполнить переключение в согласованное окно. Не менять production роли, пароли, grants, ownership или миграции автоматически; откат выполнять сменой URL через штатное хранилище секретов, не удаляя роли/данные.

Текущий рабочий процесс не подключался к базе и не менял роли, пароли, grants, ownership, schema или данные.

## TLS для PostgreSQL (план, не включён)

Наблюдаемое состояние: PostgreSQL сообщал `ssl=false`, внутри контейнера слушает `*`; опубликованный host port привязан к `127.0.0.1:5432`, host connections в проверенном `pg_hba.conf` требуют SCRAM, local socket/loopback правила используют `trust`. Это снижает внешнюю доступность, но не шифрует трафик на Docker/loopback границах и не подтверждает защиту от доступа с хоста/соседних контейнеров.

Перед включением подготовить CA и отдельный серверный сертификат с SAN для имени, реально используемого каждым клиентом (например, `postgres` внутри Compose и `localhost`/`127.0.0.1` только если именно так подключается локальный клиент). Закрытый ключ хранить вне Git и image, read-only mount, доступ только PostgreSQL OS user, mode `0600`; сертификат/CA — read-only. Проверить цепочку, hostname, срок и процедуру перекрывающего обновления сертификатов. Не использовать `rejectUnauthorized: false`, `sslmode=require` без проверки hostname/CA или отключение проверки peer.

На disposable clone настроить PostgreSQL `ssl=on`, TLS-only HBA для нужных host clients и `verify-full` с правильной CA/SAN в `pg`/Prisma 7 adapter. Проверить совместимость точной версии `pg`, формат SSL parameters и hostname validation отдельными успешными и отрицательными тестами (неверный CA, hostname, expired cert). Проверить локальный socket отдельно. Только после одобрения подготовить maintenance/rollback план; production Compose, сертификаты, HBA и сервер не менялись.

## Важно

Не понижать права работающей роли напрямую: сервисы могут зависеть от ownership при миграциях, а работа приложения требует тестируемого переключения. Следовать приведённым выше role matrix и rollback plan. Не менять существующую роль/пароль без письменного разрешения.

Compose не подставляет известный пароль администратора. Установите уникальные значения для всех трёх паролей и согласуйте их с фактическим существующим кластером до перезапуска: изменение Compose env не меняет пароль уже созданного PG volume. Не публикуйте порт в Internet. Для удалённых соединений настройте TLS и сеть отдельно.

## Операции

`npm run db:generate` генерирует клиент. `npm run db:deploy` применяет миграции к `MIGRATION_DATABASE_URL`; `npm run db:migrate` предназначен только для разработки и может требовать отдельную shadow database/дополнительные права. Перед запуском проверять целевую БД. Миграции тестировать на отдельной восстановленной БД. Не запускать `migrate dev` на production.

Выполненный аудит не менял БД и не читал строки пользователей. Нужны отдельная проверка `pg_hba.conf`, параметров TLS/listen, grants на объектах, размера/заполнения таблиц и ревью заявленных миграций владельцем DBA.
