# Конфигурация

Плагин читает config из строки `ai-factory` в `cordis.patch.yml` профиля.
Пример: `config/examples/profile-patch.yml`.

Patch заменяет конфигурацию строки целиком. Если вы переопределяете одно поле,
перечислите остальные, чтобы не потерять значения.

| Поле | Тип | Default | Описание |
|---|---|---|---|
| `enabled` | boolean | true | Монтировать плагин и инструменты |
| `dataDir` | string | `""` | Каталог данных; пусто = `~/.dsh/ai-factory` |
| `dbFile` | string | `factory.db` | Имя SQLite-файла, без пути |
| `maxSearchResults` | number | 20 | Лимит поиска (1..100) |
| `workingMemoryTtlHours` | number | 72 | TTL `working` (0 = без TTL) |
| `maxContentChars` | number | 100000 | Максимум символов в записи |
| `defaultAutonomy` | enum | autonomous | safe / autonomous / trusted |
| `allowGlobalMemory` | boolean | true | Разрешить scope=global |
| `projectIdOverride` | string | `""` | Один project id для переносимого проекта |
| `redactLogs` | boolean | true | Редактировать секреты в audit |
| `logLevel` | enum | info | debug / info / warn / error |

## Пути

- Абсолютный `dataDir` используется как есть.
- `~` и `~/...` разворачиваются в домашний каталог.
- `%VAR%` и `$VAR` разворачиваются из окружения.
- Относительный путь разрешается от `~/.dsh`.

Абсолютных путей разработчика в коде нет.

## Перенос проекта

По умолчанию project id — стабильный hash canonical path. На другом ПК путь
может отличаться. Задайте одинаковый `projectIdOverride` на обеих машинах,
если нужна общая проектная память (или используйте серверную синхронизацию в
Phase 4).

## Секреты

Не помещайте ключи в `cordis.patch.yml`. DSH хранит их в своём credential
service; AI Factory не читает и не дублирует их.
