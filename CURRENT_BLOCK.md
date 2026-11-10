# Текущий блок

**Phase 2c — scoped tool allowlist.**

Сделано:

1. Schema v4: `agent_profiles.allowed_tools`, явный allowlist у 7 built-in
   профилей; custom без списка не запускается.
2. `ScopedChildRunner` через `ctx.agents.create` + `setup(restrict)`;
   dispatch/review используют его вместо неограниченного spawn.
3. Глобальный `ctx.tools.guard` → `TOOL_NOT_ALLOWED`; allowlist привязан до
   первого хода и снимается после dispose.
4. Live: RESEARCHER вызвал `factory_memory_forget` → отказ, память не удалена;
   scoped REVIEWER прошёл PASS.
5. 50 plugin-тестов, 34 инструмента, версия 0.8.0; docs/ARCHITECTURE/SECURITY.

Осталось: Model Router, standalone PostgreSQL/TLS, GitHub Release, второй ПК.
