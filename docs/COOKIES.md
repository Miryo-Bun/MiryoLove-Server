# Cookies и сессии

Cookie устанавливаются в `src/utils/cookies.ts`; значения не доступны JavaScript. Фактическую runtime-политику также возвращает `/api/auth/cookie-policy`.

| Имя                      | Назначение                      | Срок                                                                | HttpOnly | Secure            | SameSite | Path               | Domain               |
| ------------------------ | ------------------------------- | ------------------------------------------------------------------- | -------- | ----------------- | -------- | ------------------ | -------------------- |
| `miryolove_session`      | Непрозрачный токен входа        | До `SESSION_TTL_DAYS` (30 по умолчанию), совпадает с expires сессии | Да       | Только production | Lax      | `/api`             | Не задан (host-only) |
| `miryolove_oauth_google` | OAuth state для Google callback | 600 секунд                                                          | Да       | Только production | Lax      | `/api/auth/google` | Не задан             |
| `miryolove_oauth_yandex` | OAuth state для Yandex callback | 600 секунд                                                          | Да       | Только production | Lax      | `/api/auth/yandex` | Не задан             |

Сессия генерируется случайным токеном; в БД лежит HMAC-SHA256 hash с ключом `SESSION_SECRET`. Logout удаляет серверную запись и очищает cookie. Успешный `DELETE /api/users/me` также удаляет сессии каскадно и возвращает clear-cookie с `Max-Age=0`. Срок проверяется при аутентификации. Глобального фонового удаления протухших строк нет. Проверено API-тестом; production deployment не подтверждён.

OAuth state сравнивается constant-time при совпадающей длине. Callback очищает state-cookie до обработки ответа провайдера. Аналитические и рекламные cookies в этом API не создаются.

`Secure` зависит от `NODE_ENV=production`: production должен работать через HTTPS. Для браузерных state-changing запросов сохраняйте точный Origin allowlist; отдельный CSRF token в проекте отсутствует. Изменение домена/поддоменов требует повторной проверки cookie и CSRF-модели.
