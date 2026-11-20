# Исполняемые спецификации платформы

Поведение платформы agent-core (жизненный цикл проектов, запуски агентов, отчёты, адаптеры), записанное примерами. Спеки идут на игрушечном домене `spec-domain/` (не входит в пакет): две команды `ScheduleCheck` и `AddNote`, события `CheckScheduled`, `CheckCancelled`, `NoteAdded`, read-модель `Today`; для очереди решений — идея (`IdeaProposed`, `AcceptIdea`, `RejectIdea`) и объявление установки (`NoticePosted`, `AckNotice`). Проект-потребитель (MarkPilot и другие) гоняет тот же раннер на своём домене, а платформенные спеки живут только здесь.

Спека описывает поведение, а не устройство кода: путей к файлам `src/` в ней нет. Одобренную спеку правят только через повторное одобрение.

## Формат

Файл — `specs/<область>/<тема>.md`. Сценарий — заголовок `##`, 1–2 фразы «зачем» и блок:

```spec
given:                # прошлые события (по порядку)
  - ProjectCreated: { project: pots, name: Горшки }
when:                 # одна команда; actor — кто её подаёт
  ScheduleCheck: { actor: human, project: pots, id: C1, due: 2026-02-01 }
then:                 # новые события по порядку, или отказ
  - CheckScheduled: { project: pots, id: C1, due: 2026-02-01 }
# then: { rejected: <причина> }
```

- `now:` (необязательно) — текущее время сценария, ISO.
- Список событий в `then` сравнивается целиком: те же события в том же порядке, ни одного лишнего. Поля внутри события — частично: перечисленные должны совпасть, остальные игнорируются.
- Актор: `human` (владелец), `curator` (главный агент), `agent:<роль>` (агент-исполнитель), `system` (планировщик, интеграции).

## Контрактные спецификации адаптеров

Как сырой ответ внешнего API превращается в значение. Файл — `specs/adapters/<адаптер>.md`, ответы — фикстуры в `specs/fixtures/<адаптер>/` (`.json` и `.yaml` разбираются, остальное передаётся адаптеру текстом). Блок ```spec с ключом `adapter:`:

```spec
adapter: reports                          # имя адаптера (платформенные: browser, metrics, reports, support, telegram-inbound)
given_response: specs/fixtures/reports/x.json   # путь к фикстуре или ответ прямо в блоке
when:                                     # один запрос к адаптеру
  Decide: { now: 2026-01-01T00:00:00Z, what: a, need: b }
then:                                     # значение, или отказ
  _tag: Send
# then: { rejected: empty }
```

- Раннер передаёт сценарий в `runAdapterSpec(adapter, response, when)`, сеть не используется. Платформа даёт обработчики (`platformAdapterSpecs`, `src/adapters/spec-registry.ts`), проект добавляет свои через `composeAdapterSpecs`.
- Мост Telegram — обработчик `telegram-bridge` (`specs/telegram/`): настоящий мост платформы над поддельным Telegram. Он общий (`makeBridgeSpec` и мир-заглушки в `src/adapters/telegram/BridgeSpec.ts`, `BridgeWorld.ts`), а ядро, расширение `TelegramExt` и конфиг ему даёт домен (`bridgeSpecs(binding)`; игрушечный — `spec-domain/bridge.ts`, `telegram.ts`). Формат шагов — в комментарии `BridgeSpec.ts`.
- `then` сравнивается частично, как поля события; числа — с точностью 1e-9.
- Фикстуры — часть спецификации: хэш одобрения в `specs/approved` считается по тексту файла и всем фикстурам, на которые он ссылается.

## Запросы (read-модели)

Блок ```spec с ключом `query:` вместо `when:`; раннер вызывает `runQuery(given, query, now)` проекта, события `given` попадают в журнал с временем `now` и актором `system`.

```spec
now: 2026-12-02T06:00:00Z
given:
  - ProjectCreated: { project: pots, name: Горшки }
query:
  Today: { project: pots }
then:
  today: 2026-12-02
# then: { rejected: unknown_project }
```

В игрушечном домене запросы: `Today: { project }` (`project`, `name`, `today`, `notes`), `Decide: { project }` (очередь решений: `project`, `items`) и `Resolve: { project, verb, kind, id, reason? }` (команда глагола или `refused`). Неизвестный запрос — не реализовано (бэклог).

## Статусы

Каждый файл начинается со строки `Status: draft` или `Status: approved`.
- **draft** — черновик агента, ждёт ревью человека, может падать.
- **approved** — согласован человеком; его хэш (с фикстурами) в `specs/approved`; менять только с новым одобрением. Красный сценарий, ни разу не бывший зелёным, — бэклог: показывается как todo и не валит проверку.

## Храповик

`specs/passing` — по строке `<путь>#<заголовок сценария>` на каждый одобренный сценарий, который хоть раз был зелёным (отсортировано). `pnpm check` падает, если:
- сценарий из `specs/passing` стал красным — регрессия, чинить код;
- одобренный сценарий зелёный, но его нет в `specs/passing` — запустить `pnpm spec:ratchet` и закоммитить файл;
- строка `specs/passing` не соответствует ни одному одобренному сценарию.

Правила для агентов: тестов не писать; не править файлы со `Status: approved` и их фикстуры, не трогать `specs/approved`, не удалять строки из `specs/passing`; добавлять в `specs/passing` только через `pnpm spec:ratchet`; строки B-сценариев (`specs/flex/`) агент добавляет сам через `pnpm spec:ratchet-flex` (только B: строк A не добавляет и не трогает).

Итоговая строка проверки: `exec specs: approved N green, N red (backlog), N regressions; draft N green, N red`.

## Классы спецификаций

Все спеки — требования: храповик и проверка регрессий действуют на каждую. Классы различаются тем, кто вправе менять спеку (`specs/tooling/spec-classes.md`).

- **A** — всё вне `specs/flex/`: деньги, права и роли, данные и удаление, безопасность, внешние действия, одобрения и подтверждения. Одобряет человек (хэш в `specs/approved`).
- **B** — всё остальное (UI, пороги и параметры, эвристики и ранжирование, служебные форматы и расписания), файлы под `specs/flex/` (подпапки допустимы). Агент правит, добавляет и удаляет сценарии в том же PR, что и код; хэша в `specs/approved` нет, `pnpm spec:approve` такой путь отказывает. Строки `specs/passing` удалённых B-сценариев убирает `pnpm spec:ratchet`. Путь из `specs/flex/` в `specs/approved` — ошибка (`class_mismatch`): класс файла меняет только владелец.
- Файл целиком одного класса. Сомнение — класс A.

## Раннер в проектах

Раннер и вся оснастка спеков (`scripts/specs/*`, `scripts/tool.ts`) — одна копия, в пакете ядра. Агент держит у себя только привязку к своему домену `scripts/specs/bindings.ts` (`export const check = makeCheck({ runSpec, runQuery, runAdapterSpec })` из `agent-core/scripts/specs/run`), тест `test/specs.test.ts` (`specSuite(check, { describe, it, fail: assert.fail })` из `agent-core/scripts/specs/suite`) и `vitest.config.ts`; все три охраняются. Команды агента вызывают ядро: `tsx node_modules/agent-core/scripts/tool.ts guard | allow <путь>… | approve <спека>… | ratchet` — это `pnpm guard`, `pnpm tests:allow`, `pnpm spec:approve`, `pnpm spec:ratchet`. `guard` заодно сверяет оснастку установленного ядра с его `guarded.sha256` охраняет запись `package.json#scripts` (чем репо запускает проверки) и в репо агента проверяет происхождение ядра: зависимость `agent-core` в package.json должна быть полным SHA коммита из `main` репозитория ядра (`merge-base --is-ancestor` в кэшированном bare-зеркале), иначе (другой репо, ветка вне main, нет сети) guard красный «cannot verify core commit is on main». Старая запись `agent-core/scripts` в `guarded.sha256` игнорируется (можно удалить). Обобщённая часть ядра спеков — `makeSpecHarness(domain)` в `src/core/spec-harness.ts`.
