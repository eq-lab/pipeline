Status: approved

# Классы спецификаций

Все спеки — требования: код обязан им удовлетворять, храповик (`specs/passing`) и проверка регрессий действуют на каждую. Классы различаются одним: кто вправе менять спеку.

- **Класс A** (по умолчанию, всё вне `specs/flex/`): деньги, права и роли, данные и удаление, безопасность, внешние действия (отправка, публикация), одобрения и подтверждения. Правит только человек: хэш в `specs/approved`, `pnpm spec:approve`. Агент не правит одобренную A-спеку, не трогает `specs/approved`, не удаляет строки `specs/passing` этих спек.
- **Класс B** (гибкие: агент вправе менять, владелец получает уведомление) — всё, что НЕ деньги, права и роли, данные и удаление, безопасность, внешние действия (отправка, публикация), одобрения и подтверждения. Класс определяется смыслом, а не интерфейсом: UI (формулировки, содержимое карточек, служебные строки в чате, порядок), пороги и параметры (сроки хранения, лимиты, таймауты, повторы, «просрочено через N дней»), эвристики и ранжирование (что показывать первым), служебное (формат логов и метрик, имена файлов, фоновые расписания), неинтерфейсные шаблоны и подсказки. Файлы лежат под `specs/flex/` (подпапки допустимы: `specs/flex/ux/views/decide.md`, `specs/flex/tuning/`). Агент вправе править, добавлять и удалять B-сценарии в том же PR, что и код; одобрение человека не нужно, хэша в `specs/approved` у B-спеки нет. Изменение видно в PR по пути `specs/flex/`; владельцу уходит уведомление с диффом, без кнопок (механизм — отдельная задача devops). Сомнение — класс A.
- Файл целиком одного класса: смешанный файл делится на A-файл и B-файл.
- Перенос спеки между классами — изменение класса A, делает владелец. Удаление одобренного A-файла и так валит проверку хэша (файл в `specs/approved` не существует), поэтому перенос из A в B сам по себе закрыт; B-спека, противоречащая A-спеке, просто делает проверку красной.

Ниже — контракт проверки (`Verify`: файлы со статусом и состоянием хэша, строки `specs/approved`, `specs/passing`, сценарии) и команды (`Approve`).

## A-спека с совпавшим хэшем в порядке

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/system/agent-runs.md, status: approved, hash: match }
  approved: [specs/system/agent-runs.md]
when:
  Verify: {}
then:
  problems: []
```

## Правка одобренной A-спеки — ошибка

Агент не может поправить A-спеку: хэш не совпадёт, пока владелец не одобрит заново.

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/system/agent-runs.md, status: approved, hash: differs }
  approved: [specs/system/agent-runs.md]
when:
  Verify: {}
then:
  problems:
    - { path: specs/system/agent-runs.md, code: changed }
```

## Одобренная A-спека без хэша — ошибка

Агент не может объявить A-спеку одобренной сам.

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/system/new.md, status: approved, hash: none }
  approved: []
when:
  Verify: {}
then:
  problems:
    - { path: specs/system/new.md, code: unapproved }
```

## B-спека одобрена без хэша — агент правит её свободно

Под `specs/flex/` статус `approved` не требует хэша: файл, который агент создал или изменил, остаётся требованием без участия человека.

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/flex/views/decide.md, status: approved, hash: none }
  approved: []
when:
  Verify: {}
then:
  problems: []
```

## B-спека в specs/approved — ошибка

Класс файла меняет только владелец: строка B-файла в `specs/approved` — полусделанный перенос, а не одобрение.

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/flex/views/decide.md, status: approved, hash: match }
  approved: [specs/flex/views/decide.md]
when:
  Verify: {}
then:
  problems:
    - { path: specs/flex/views/decide.md, code: class_mismatch }
```

## Удалённый одобренный A-файл — ошибка

Так закрыт перенос A-спеки в B и тихое удаление: строка в `specs/approved` осталась, файла нет.

```spec
adapter: spec-classes
given_response:
  files: []
  approved: [specs/confirmations/external-actions.md]
when:
  Verify: {}
then:
  problems:
    - { path: specs/confirmations/external-actions.md, code: listed_missing }
```

## Удалённый A-сценарий оставляет строку в passing — ошибка

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/tasks/tasks.md, status: approved, hash: match }
  approved: [specs/tasks/tasks.md]
  scenarios: []
  passing: ["specs/tasks/tasks.md#Человек создаёт задачу без срока"]
when:
  Verify: {}
then:
  problems:
    - { path: specs/tasks/tasks.md, code: stale_passing }
```

## Удалённый B-сценарий строку в passing не оставляет

Агент, удаляя B-сценарий, убирает и его строку в `specs/passing` (или это делает `pnpm spec:ratchet`); для B-спек такая строка без сценария не ошибка.

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/flex/views/decide.md, status: approved, hash: none }
  approved: []
  scenarios: []
  passing: ["specs/flex/views/decide.md#Контент-план и смена приоритета"]
when:
  Verify: {}
then:
  problems: []
```

## Регрессия B-сценария — ошибка, как у A

B-спека остаётся требованием: однажды зелёный и покрасневший сценарий валит проверку.

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/flex/views/decide.md, status: approved, hash: none }
  approved: []
  scenarios:
    - { path: specs/flex/views/decide.md, name: Карточка, red: true }
  passing: ["specs/flex/views/decide.md#Карточка"]
when:
  Verify: {}
then:
  problems:
    - { path: specs/flex/views/decide.md, code: regression }
```

## Одобрение B-спеки не нужно

`pnpm spec:approve` отказывает для пути под `specs/flex/`: одобрять нечего, спеку правит агент.

```spec
adapter: spec-classes
given_response: {}
when:
  Approve: { path: specs/flex/views/decide.md }
then:
  rejected: class_b_not_approved
```

## Одобрение A-спеки — как раньше

```spec
adapter: spec-classes
given_response: {}
when:
  Approve: { path: specs/tasks/tasks.md }
then:
  approved: true
```
