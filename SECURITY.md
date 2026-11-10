# Безопасность DSH AI Factory

## Модель угроз

| Угроза | Мера Phase 1 |
|---|---|
| Секреты попадут в память | Регулярные выражения + отказ `SECRET_DETECTED`; плейсхолдеры разрешены |
| Секреты попадут в логи/аудит | Редактирование `[REDACTED]`; аудит не хранит текст памяти |
| Prompt injection из внешнего документа | Маркеры сохраняются как `trustWarning`; внешние данные считаются `unverified` |
| Чтение чужой памяти | Память разделена по project id; глобальная — только явно |
| Потеря данных при обновлении | Миграции только добавляют; данные в отдельном `~/.dsh/ai-factory` |
| Удаление данных | `factory_memory_forget` — soft delete; скрипт удаления требует `-PurgeData` |
| Кража БД | Каталог `0700` на POSIX; на Windows — ACL профиля пользователя |
| Опасные команды | В Phase 1 нет shell/SSH/сетевых инструментов |
| Подмена DSH-компонентов | Плагин только использует официальный API; исходники DSH не меняются |

## Секреты

Плагин **не хранит** API-ключи. Ключи DSH остаются в его credential service.
Если пользователь пытается сохранить ключ в память, инструмент возвращает
ошибку и не пишет запись.

Известные шаблоны: private keys, OpenAI/DeepSeek-подобные `sk-...`, GitHub
`ghp_...`, AWS `AKIA...`, Slack `xox...`, JWT, присваивания
`password=...`. Это эвристика, а не гарантия; не сохраняйте секреты в память
намеренно.

## Внешние данные

Результаты web/PDF/MCP в будущих фазах будут помечаться `sourceType=import` и
`trust=unverified`. Они никогда не становятся системными инструкциями.
Автоматическое повышение доверия запрещено; пользователь/REVIEWER должны явно
подтвердить факт.

## Права DSH

Плагин работает в host-процессе и технически имеет доступ к файловой системе.
Phase 1 использует только:

- чтение/запись собственного каталога данных;
- чтение рабочего каталога агента для вычисления project id;
- SQLite.

В Phase 1 сетевых серверов, shell-команд и SSH не было. В 0.8.0 shell/SSH
доступны только профилям SYSADMIN/EXECUTOR и только через их allowlist; DSH
approvals/sandbox продолжают действовать.

## Дочерние агенты и scoped allowlist (v0.8.0)

`factory_dispatch` создаёт ребёнка через `ctx.agents.create()`, а не через
неограниченный spawn. Модель защиты:

1. В `agent_profiles` хранится **явный `allowed_tools`**; пустой список для
   custom-профиля означает deny-all.
2. В `setup(agentCtx)` до публикации агента вызывается
   `agentCtx.tools.restrict({deny: known - allowed})`; незаявленные
   host-инструменты скрываются из схемы.
3. `ctx.tools.guard` получает `runtime.toolDenial(childId, name)` до выполнения
   любого tool call. Вызов вне allowlist возвращает
   `TOOL_NOT_ALLOWED: <name> не входит в allowlist профиля ребёнка`; тело
   инструмента не выполняется.
4. Allowlist привязывается к child session id **до** первого хода и снимается в
   `finally` после `dispose()`.

Дочерние профили не содержат `factory_dispatch`, `factory_review` и
`factory_workflow_run` — внуки и рекурсивная оркестрация невозможны.
REVIEWER не имеет `factory_sync`, `factory_dashboard`,
`factory_memory_forget`, `factory_task_cancel`; RESEARCHER — тех же
destructive-инструментов; SYSADMIN получает только admin/ssh/file-tools.

Live-проверка: RESEARCHER вызвал `factory_memory_forget` и получил
`TOOL_NOT_ALLOWED`; память осталась нетронутой. Scoped REVIEWER прошёл PASS.

Граница: guard стоит на исполнении инструментов через `ctx.tools`. Любая
host-возможность, которая обходит этот реестр, вне данной модели и требует
отдельного аудита; DSH approvals/sandbox продолжают действовать независимо.

## Model Router

- Маршруты и fallback-и задаются оператором (`modelFallbacks`), не моделью.
- Audit `model.route`/`model.fallback` хранит только provider/model и причину
  (`child_error`); без prompt, system prompt, event data и секретов.
- Fallback повторяет child только после `stopReason:error`, не после
  содержательного FAIL от REVIEWER.
- `factory_model_route` read-only; не переключает модель и не запускает child.

## Dashboard (v0.4.0)

`factory_dashboard` — локальный read-only HTTP-сервер:

- bind только `127.0.0.1`; параметра host нет;
- случайный токен 24 байта; сравнение через `timingSafeEqual`;
- токен в URL используется один раз, затем 302 + HttpOnly/SameSite=Strict
  cookie, токен исчезает из адресной строки;
- только GET; POST → 405; CSP, `no-store`, `nosniff`, `X-Frame-Options: DENY`;
- нет внешних CDN/шрифтов и нет мутаций;
- состояние включает локальный путь БД и конфигурацию без секретов;
- токен отдаётся инструментом и может попасть в session log — не публикуйте
  URL в чатах/скриншотах; перезапустите dashboard, чтобы заменить токен.

Сервер живёт, пока жив host-процесс DSH; после выгрузки плагина закрывается.

## Sync (v0.5.0)

- Bearer-токен только из env-переменной (`syncTokenEnv`); не хранится в
  конфиге/SQLite/логах.
- Внешний URL только HTTPS; HTTP разрешён только для loopback.
- Sync payload содержит текст памяти: сервер должен не логировать его и
  использовать TLS. Outbox лежит в локальной SQLite.
- Pull применяет данные с LWW; удалённый сервер не должен иметь возможность
  внедрять системные инструкции — payload остаётся данными.
- Sync-сервер (`server/`) использует PGlite или standalone PostgreSQL через
  `DATABASE_URL` (pgvector), Bearer token, idempotency и не логирует payload.
  Пароль PostgreSQL задаётся только через env/секреты, не в репозитории.
- Standalone adapter проверен через PostgreSQL wire protocol; реальный
  Ubuntu/Docker deploy ещё не выполнен.
- Multi-writer: два PostgreSQL-процесса принимают один `opId` ровно один раз
  (reservation через `ON CONFLICT`); PGlite остаётся single-writer.
- Сервер по умолчанию слушает `127.0.0.1`; для внешнего доступа используйте
  HTTPS reverse proxy или direct TLS (`SYNC_TLS_CERT_FILE`/`KEY_FILE`).
  Docker Compose публикует порт только на loopback.
- `SYNC_TOKEN` сервера и `DSH_AI_FACTORY_SYNC_TOKEN` клиента не хранятся в
  репозитории.
- Auto-sync (`syncAuto`) отправляет outbox по таймеру; ошибки остаются в
  outbox и повторяются с backoff.
- `GET /v1/admin/backup` отдаёт consistent `.tar.gz` PGlite data-dir;
  `scripts/server-backup.ps1` сохраняет файл и SHA256.
- Restore CLI принимает только **пустой** каталог, использует PGlite
  `loadDataDir` и проверяет health. Scheduled backups пишут tar.gz+SHA256 и
  ротируют архивы; каталог backup должен быть защищён. Backup содержит память
  пользователя; не публиковать.
- Standalone PostgreSQL/Ubuntu и TLS-терминация ещё не развёрнуты.

## Reviewer / child-агенты

- REVIEWER запускается через scoped runner с allowlist; в нём нет
  `factory_dispatch`, `factory_review`, `factory_workflow_run`, `factory_sync`,
  `factory_dashboard`, `factory_memory_forget`, `factory_task_cancel`.
- Ответ ребёнка парсится по строке `VERDICT:`; неизвестный/отсутствующий verdict
  → FAIL, а не автоматический PASS.
- `factory_review` не принимает задачу вне REVIEW; FAIL создаёт fix-задачу,
  но не переисполняет её автоматически.
- Child получает project root и инструкцию, но не секреты конфигурации.
- `factory_workflow_run` ограничен 1–5 циклами.
- `autoWorkflowEnabled` (default false) — явный opt-in на фоновый bounded
  workflow. Coordinator Agent не получает prompt; он только parent для child.
  Расход модели ограничен `autoWorkflowMaxCycles`/`MaxTasks` и интервалом;
  каждый tick покрыт audit. Отключение конфигом останавливает таймер.

## Сообщение об уязвимости

Не публикуйте секреты и персональные данные в issue. Для приватного отчёта
используйте контакт мейнтейнера репозитория или GitHub Security Advisories.
