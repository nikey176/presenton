# Незакоммиченные изменения

> Дата: 2026-06-18  
> База сравнения: `git diff HEAD`

---

## Исправления ошибок сборки

| Файл | Изменение | Описание | Трудозатраты (чел.-ч.) |
|------|-----------|----------|------------------------|
| `servers/nextjs/lib/server-template-layouts.ts` | Добавлены экспорты | Добавлены `buildCustomTemplateLayoutPayload`, `buildCustomTemplateLayoutPayloadFromApi`, тип `CustomLayoutCompileInput` — отсутствовали, что приводило к ошибке Turbopack при сборке (`Export ... doesn't exist in target module`) | 2.0 |
| `servers/nextjs/utils/providerUtils.ts` | Добавлена функция | Добавлена `checkIfSelectedOllamaModelIsPulled` — обёртка над `isOllamaModelAvailable` без обязательного URL; отсутствовала при импорте в `ConfigurationInitializer.tsx` | 0.5 |
| `servers/nextjs/app/ConfigurationInitializer.tsx` | Исправлен импорт | Заменён импорт `isOllamaModelAvailable` на `checkIfSelectedOllamaModelIsPulled`; убрана проверка недоступной функции `checkIfSelectedDeepSeekModelIsAvailable` | 0.5 |
| | | **Итого по разделу** | **3.0** |

---

## Исправления ComfyUI

| Файл | Изменение | Описание | Трудозатраты (чел.-ч.) |
|------|-----------|----------|------------------------|
| `servers/fastapi/services/image_generation_service.py` | Автодобавление схемы URL | Если `COMFYUI_URL` сохранён без `http://` (например, `192.168.1.12:8000`), URL дополняется автоматически; раньше aiohttp бросал `InvalidURL`, что давало ошибку `Image generation failed: 192.168.1.12:8000/prompt` | 0.5 |
| `servers/fastapi/services/image_generation_service.py` | Исправлен `_download_comfyui_image` | Добавлен явный `raise` в конце функции — раньше при отсутствии `"images"` в outputs функция возвращала `None` без ошибки, что приводило к `Image not found at None` | 1.0 |
| `servers/fastapi/services/image_generation_service.py` | Обновлён docstring | Исправлено устаревшее требование «CLIPTextEncode с заголовком Positive»; актуальное требование — нода «Input Prompt» | 0.25 |
| `servers/nextjs/app/(presentation-generator)/(dashboard)/settings/ImageProvider.tsx` | Подсказка в UI | Добавлена подсказка под полем Workflow JSON: необходимость переименовать ноду в «Input Prompt» перед экспортом | 0.25 |
| | | **Итого по разделу** | **2.0** |

---

## Исправления компиляции custom layout (браузер)

| Файл | Изменение | Описание | Трудозатраты (чел.-ч.) |
|------|-----------|----------|------------------------|
| `servers/nextjs/app/hooks/compileLayout.ts` | `"Table"` в `RESERVED_FOR_LUCIDE` | `lucide-react` экспортирует иконку `Table`; это создавало два `const Table` в sandbox — `const Table = _Lucide["Table"]` и `const Table = 'table'` — что приводило к `SyntaxError: Identifier 'Table' has already been declared`. Диагностика потребовала проверки экспортов lucide-react | 3.0 |
| `servers/nextjs/app/hooks/compileLayout.ts` | Условный алиас `tableAlias` | Если скомпилированный код layout'а сам объявляет `const Table`, sandbox не предобъявляет его — устраняет конфликт для существующих layout'ов в БД | 1.0 |
| `servers/nextjs/app/hooks/compileLayout.ts` | Добавлены shadcn алиасы в sandbox | `const TableBody = 'tbody'`, `TableHeader = 'thead'` и др. — ранее эти замены делались только в Python, теперь и в JS sandbox | 0.5 |
| `servers/nextjs/app/hooks/compileLayout.ts` | Рефакторинг `getLucideBindingLines` | Упрощён до перебора `Object.keys(LucideReact)` с кешированием; убрана сложная логика сканирования JSX и import-строк | 2.0 |
| `servers/nextjs/app/hooks/compileLayout.ts` | Добавлена `buildSampleFromSchemaJSON` | Генерирует корректные sample data из JSON Schema: массивы → `[]`, объекты → `{}`, строки → `""` и т.д. Устраняет `?.map is not a function` — раньше при неудаче `Schema.parse({})` возвращался `{}`, и поля-массивы оставались объектами | 2.0 |
| `servers/nextjs/app/hooks/compileLayout.ts` | Дополнительные LLM-фиксы в `cleanCode` | Добавлены: замена `.description(` → `.describe(`, удаление `Icon`-префиксов у Lucide-имён, фикс `})).default({`, очистка TypeScript-аннотаций Schema, фикс template literal вокруг Schema | 1.5 |
| `servers/fastapi/templates/handler.py` | Замена `Table` → `table` в нормализации | `re.sub(r"\bTable\b", "table", ...)` для новых layout'ов предотвращает конфликт с sandbox-декларацией; работает только со словом «Table» — составные имена (`TableData`, `DataTable`) не затрагиваются | 1.0 |
| `servers/fastapi/templates/handler.py` | Рефакторинг `_normalize_layout_code_for_create` | Убран отдельный `_normalize_asset_fields`, логика перенесена внутрь; улучшена обработка export-деклараций (inline exports теперь сохраняются) | 2.0 |
| | | **Итого по разделу** | **13.0** |

---

## Обновления LLM-промптов

| Файл | Изменение | Описание | Трудозатраты (чел.-ч.) |
|------|-----------|----------|------------------------|
| `servers/fastapi/templates/prompts.py` | Правила работы с таблицами | Явный запрет shadcn Table-компонентов; указан эталонный паттерн с нативным `<table>/<thead>/<tbody>` | 1.0 |
| `servers/fastapi/templates/prompts.py` | Обязательный optional chaining | Добавлено правило: все поля данных могут быть `undefined`, обязателен `?.` | 0.5 |
| `servers/fastapi/templates/prompts.py` | Правила Schema | Уточнена запись `.describe()` (не `.description()`), корректная вложенность `z.object`/`z.array`, запрет TypeScript-аннотаций | 0.5 |
| `servers/fastapi/templates/presentation_layout.py` | Упрощён `to_string()` | Убран параметр `with_schema` и JSON-сериализация схемы — метод упрощён до базового описания слайдов | 0.5 |
| `servers/fastapi/templates/get_layout_by_name.py` | Удалены внутренние auth-заголовки | Убран `internal_request_headers()` из fallback-запроса к `/api/template`; удалена отдельная ветка для custom-шаблонов (маршрутизация через `get_layout_by_name`) | 1.0 |
| | | **Итого по разделу** | **3.5** |

---

## Функциональность предпросмотра шаблонов

| Файл | Изменение | Описание | Трудозатраты (чел.-ч.) |
|------|-----------|----------|------------------------|
| `servers/fastapi/templates/preview.py` | Полный рерайт | Добавлена загрузка шрифтов из PPTX (fontTools), анализ доступности системных шрифтов, хранение слайдов как HTML, API для проверки шрифтов в PPTX-файлах | 12.0 |
| | | **Итого по разделу** | **12.0** |

---

## Экспорт презентаций

| Файл | Изменение | Описание | Трудозатраты (чел.-ч.) |
|------|-----------|----------|------------------------|
| `servers/nextjs/lib/run-bundled-presentation-export.ts` | Retry-логика для PPTX | До 3 попыток при ошибках Puppeteer (`Navigation timeout`, `Chrome was not found`, `Failed to launch browser`); между попытками экспоненциальная задержка | 2.0 |
| | | **Итого по разделу** | **2.0** |

---

## Инфраструктура и Docker

| Файл | Изменение | Описание | Трудозатраты (чел.-ч.) |
|------|-----------|----------|------------------------|
| `Dockerfile` | Добавлен `INSTALL_LIBREOFFICE` ARG | Опциональная установка LibreOffice в production-образ | 0.5 |
| `Dockerfile` | `PUPPETEER_SKIP_DOWNLOAD=true` | Puppeteer не скачивает Chromium при установке — используется системный `/usr/bin/chromium` | 0.5 |
| `Dockerfile.dev` | Аналогичные изменения | Синхронизированы с `Dockerfile` | 0.5 |
| `docker-compose.yml` | `extra_hosts: host.docker.internal` | Все сервисы получают доступ к хосту через `host.docker.internal` — необходимо для подключения к ComfyUI и Ollama на хосте | 0.5 |
| `docker-compose.yml` | Сеть `observability-network` | Добавлена внешняя сеть для подключения к стеку мониторинга | 0.5 |
| `docker-compose.yml` | Убраны переменные веб-поиска | `WEB_SEARCH_PROVIDER`, `TAVILY_API_KEY`, `SEARXNG_BASE_URL` и др. вынесены из `environment` секций | 0.5 |
| `nginx.conf` | Обновлена конфигурация | Изменения проксирования запросов | 1.0 |
| `.gitignore` | Новые паттерны | Исключены `*.tar`, `*.tar.sha256`, `presentation-export/index.js`, `presentation-export/py/` | 0.25 |
| `start.js` | Обновлён скрипт запуска | Изменения в инициализации сервисов | 1.5 |
| | | **Итого по разделу** | **5.75** |

---

## Next.js конфигурация и UI

| Файл | Изменение | Описание | Трудозатраты (чел.-ч.) |
|------|-----------|----------|------------------------|
| `servers/nextjs/next.config.mjs` | Разрешены LAN-хосты | Убран жёсткий список `allowedDevOrigins`; добавлен комментарий о доступе с других хостов в сети | 0.25 |
| `servers/nextjs/proxy.ts` | Обновлён прокси | Изменения в конфигурации dev-прокси | 0.5 |
| `servers/nextjs/app/globals.css` | Обновлены глобальные стили | Изменения CSS-переменных и базовых стилей | 1.5 |
| `servers/nextjs/app/(export)/pdf-maker/PdfMakerPage.tsx` | Изменения PDF Maker | Обновлён интерфейс страницы экспорта в PDF | 3.0 |
| `servers/nextjs/app/(presentation-generator)/custom-template/CustomTemplatePage.tsx` | Обновлена страница кастомных шаблонов | Изменения в редакторе кастомных шаблонов | 4.0 |
| `servers/nextjs/package-lock.json` | Обновлён lock-файл | Обновление зависимостей пакетов | 0.5 |
| `servers/nextjs/tsconfig.tsbuildinfo` | Обновлён кеш TypeScript | Автоматически обновляется при сборке | 0.0 |
| | | **Итого по разделу** | **9.75** |

---

## Сводка по трудозатратам

| Категория | Чел.-ч. |
|-----------|---------|
| Исправления ошибок сборки | 3.0 |
| Исправления ComfyUI | 2.0 |
| Исправления компиляции custom layout | 13.0 |
| Обновления LLM-промптов | 3.5 |
| Функциональность предпросмотра шаблонов | 12.0 |
| Экспорт презентаций | 2.0 |
| Инфраструктура и Docker | 5.75 |
| Next.js конфигурация и UI | 9.75 |
| **Итого** | **51.0** |
