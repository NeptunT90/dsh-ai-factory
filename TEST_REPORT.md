# TEST_REPORT

Дата: 2026-11-10  
Платформа: Windows 11 x64, Node 22.22.3 (dev), DSH Desktop 0.2.2-rc.1 (Electron 44.7.0, Node 24.21.0)

## 1. Статические проверки

| Проверка | Команда | Результат |
|---|---|---|
| TypeScript strict | `pnpm --filter dsh-ai-factory typecheck` | PASS |
| Сборка | `pnpm --filter dsh-ai-factory build` | PASS, `plugin/lib/index.js` создан |
| Формат manifest | ручная проверка `dsh.bundle.patch` | PASS |

## 2. Автотесты

Команда: `pnpm --filter dsh-ai-factory test`

```
Test Files  4 passed (4)
Tests       16 passed (16)
```

Покрыто:

- миграции идемпотентны, `user_version` сохраняется между открытиями;
- транзакция откатывается при ошибке;
- FTS5-таблица и триггеры создаются, кириллический поиск работает;
- remember → dedupe → search → update → history → forget;
- `expectedVersion` защищает от stale update;
- soft delete скрывает запись из поиска, история остаётся;
- global `user` память без project id;
- секрет отклоняется до записи;
- TTL рабочей памяти истекает;
- монтаж плагина в фейковом Cordis-контексте: 8 инструментов;
- `factory_status` возвращает `ready`/`node:sqlite`;
- tool contract remember/search/get реально пишет и читает SQLite;
- tool contract возвращает ошибку на секрет.

## 3. Интеграция с реальным DSH

### 3.1. Изолированный профиль `factory-test`

Профиль: изолированный `factory-test` (не основной `desktop`).

Установка:

```powershell
dsh plugin --profile factory-test add "link:C:/AI Factory/plugin"
```

Результат: dependency `dsh-ai-factory 0.1.0` и bundle добавлены в профиль.
`--dump-config` показывает строку:

```yaml
- id: ai-factory
  name: dsh-ai-factory
```

Boot headless-профиля (дошёл до проверки credential и завершился ожидаемой
ошибкой `MISSING_CREDENTIAL`; плагин к этому моменту уже смонтирован):

- создан `%USERPROFILE%\.dsh\ai-factory\factory.db` (102400 байт);
- `PRAGMA user_version = 1`;
- таблицы `projects`, `memory_entries`, `memory_versions`, `memory_fts`,
  `audit_log`, `settings`;
- audit-записи `factory.started` с `driver:"node:sqlite"` и
  `factory.stopped`.

Это подтверждает:

1. Cordis-загрузчик DSH импортирует пакет;
2. `apply(ctx, config)` вызывается;
3. встроенный `node:sqlite` доступен в Electron-процессе DSH;
4. жизненный цикл закрывает соединение.

Не подтверждено этим прогоном: вызов инструмента моделью (нужен
аутентифицированный LLM).

### 3.2. Основной профиль `desktop`

- Сделан backup профиля и данных:
  `backups/profile-desktop-20261110_143438` и
  `backups/factory-20261110_143438`.
- Установка `dsh plugin --profile desktop add link:...` завершилась успешно.
- `dsh plugin list` показывает 28 пакетов; все прежние 27 плагинов остались,
  версии не изменились. Добавлены только `dsh-ai-factory` и его bundle.
- В 14:34:57 плагин был **горячо смонтирован в работающий DSH** (без
  перезапуска). Durable audit:
  - `factory.started` — `driver:"node:sqlite"`, `schemaVersion:1`;
  - `factory.tools_registered` — `count:8`.
- В текущую Web GUI-сессию DSH пришли схемы всех 8 инструментов
  (`factory_status`, `factory_memory_remember/search/get/update/forget/history/stats`).
  Это подтверждает, что `ctx.tools.register` реально добавил их в реестр
  текущей сессии.
- `scripts/doctor.ps1 -Profile desktop` — без проблем: версия DSH, зависимость,
  bundle, `lib/index.js`, SQLite-схема v1.

Осталось для полной приёмки: вызвать инструмент из модели в Web GUI и
сохранить/прочитать запись (следующий шаг; требуется аутентифицированная
сессия, которая уже работает).

## 4. Ограничения и предупреждения

- `node:sqlite` выдаёт `ExperimentalWarning`; на целевом DSH это не ошибка.
- pnpm предупреждает о peerDependencies при `link:` — это ожидаемо для
  локальной разработки; DSH поставляет host-пакеты.
- Headless-профиль не имеет credential, поэтому интеграционный вызов
  инструмента был отложен до desktop-профиля.
- Нет теста на Windows ACL сверх наследуемых прав профиля.

## 5. Повтор проверки

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/doctor.ps1 -Profile desktop
```
