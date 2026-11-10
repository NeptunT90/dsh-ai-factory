# Changelog

## [0.9.0] — 2026-11-10

### Added

- Model Router: `modelRouterEnabled`, `modelFallbacks` (`provider/model`),
  `modelMaxAttempts` (1–3).
- Route priority: profile model → parent model → configured fallbacks.
- Dispatch/review retry the next route after a child model error; audit
  `model.route` and `model.fallback`.
- `factory_model_route` (read-only) показывает primary/fallback/chain.
- 4 model-теста (всего 54), 35 инструментов, версия 0.9.0.
- Live: `factory_model_route` для DEVELOPER/REVIEWER показал
  `deepseek-official/deepseek-flash`.

## [0.8.0] — 2026-11-10