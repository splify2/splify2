#!/bin/sh
# Плагин backup: архив настроек (методы get и put; на объекте splify2 они же backup_get и backup_put).
#
# Плагин знает ФОРМАТ архива и умеет передавать его по кускам; всё, что принадлежит другим, берёт у платформы через её
# API (plugin-sdk/docs/splify2-api.md):
#   - настройки каркаса — спека, подписки, ключи туннелей, выбор у групп, поля uci — выгружает и восстанавливает хост
#     (`splify2-host state export|check|import`): что входит в состояние каркаса и как проверять присланное, знает
#     каркас, а не архив;
#   - данные других плагинов (свои списки каталога, их настройки) — разделы `[plugin <id> <имя>]`: плагин с хуком
#     backup_sections отдаёт и принимает их сам (`splify2-host hook backup_sections`).
#
# Что едет в архив (формат 4; без разделов плагинов — формат 3, его читают и прежние версии): `[spec]`, `[sub]` и
# `[sub имя]`, `[select]`, `[xsteer имя]`, разделы плагинов, `[options]`.
#
# ПРО СЕКРЕТЫ. Архив содержит приватные ключи туннелей и ссылки vless:// — то же, что пароль от всех подключений.
# Предупреждение об этом стоит в шапке самого архива; собирается и разворачивается он в закрытом рабочем каталоге
# плагина (0700, память), под umask 077.
#
# Формат — строчный, с разделами в квадратных скобках, а не один JSON: разбирать присланный файл приходится здесь, в
# shell, и построчный разбор в awk можно прочитать глазами. Содержимое разделов дословное: спека остаётся спекой, список
# — списком. Строка, которую разборщик понимает как заголовок, в валидном JSON и в списке доменов встретиться не может.
# Строки раздела плагина едут с отступом в один пробел: никакая строка текста не может стать заголовком раздела.
. "${SPLIFY2_LIB:?программа запускается хостом splify2 (нет SPLIFY2_LIB)}"

RUN_DIR="${STEER_PLUGIN_STATE:?нет STEER_PLUGIN_STATE}"

# Через ubus одним куском едет только то, что заведомо влезает: тот же порядок величины, что у порций своего списка
# (1000 строк ≈ 20 КБ). Остальное — по кускам. Куски нарезаются ПО БАЙТАМ, а не по строкам: подписка бывает одним
# base64-блоком в одну строку, и по строкам такой файл не режется вовсе.
BACKUP_CHUNK="${BACKUP_CHUNK:-16384}"
# Архив собирается и принимается в памяти (рабочий каталог плагина — tmpfs), поэтому у него есть предел: настройка
# плагина `max_archive_kb`. Два мегабайта по умолчанию: свой список сам по себе разрешён до мегабайта, и предел на
# архив ниже этого означал бы настройку, которую МОЖНО завести, но НЕЛЬЗЯ вернуть из архива. Проверяется ДО записи чего
# бы то ни было: «принять, а посмотреть потом» на роутере с маленьким флешем — забитый флеш.
if [ -z "${BACKUP_MAX_BYTES:-}" ]; then
    _bk_kb="$(s2_setting max_archive_kb 2>/dev/null)"
    case "$_bk_kb" in ''|*[!0-9]*) _bk_kb=2048 ;; esac
    BACKUP_MAX_BYTES=$((_bk_kb * 1024))
    unset _bk_kb
fi
BACKUP_OUT="$RUN_DIR/backup.out"
BACKUP_IN="$RUN_DIR/restore.in"

# Версия формата определяется НАБОРОМ РАЗДЕЛОВ: 3 — разделы каркаса, 4 — плюс `[plugin <id> <имя>]`. Разбор принимает
# любую версию не новее своей: у людей уже лежат файлы, собранные прежними версиями, а архив, перестающий открываться от
# обновления, — не архив. Более НОВЫЙ файл отвергается целиком: там разделы, смысла которых мы не знаем, а восстановить
# половину хуже, чем не восстановить ничего.
BACKUP_FORMAT=3
BACKUP_FORMAT_EXT=4

# Плагин, которому достаются списки и настройки каталога из архивов формата 3 (до выноса каталога списков в плагин
# они лежали разделами `[list …]` и полями `manifest_url`, `list_shrink_factor` раздела `[options]`).
LEGACY_LISTS_PLUGIN=lists-catalog

# ---- разделы плагинов -------------------------------------------------------------------------------------------

# Выгрузка: каждый плагин с хуком backup_sections на {"op":"export"} отвечает {"ok":true,"sections":{"имя":"текст"}}.
# Имя — [A-Za-z0-9_]+, текст — обычный текст без управляющих знаков (кроме перевода строки и табуляции). Печатает
# разделы в stdout; упавший плагин архив не отменяет — строка в журнале.
backup_ext_export() {
    _bx_ctx="$RUN_DIR/ctx.export"
    printf '{"op":"export"}\n' > "$_bx_ctx"
    _bx_out="$("$SPLIFY2_HOST" hook backup_sections --ctx "$_bx_ctx")"
    rm -f "$_bx_ctx"
    json_load "$_bx_out" 2>/dev/null || return 0
    json_select results 2>/dev/null || return 0
    json_get_keys _bx_idx
    for _bx_i in $_bx_idx; do
        json_select "$_bx_i" 2>/dev/null || continue
        json_get_var _bx_id plugin
        json_get_var _bx_st status
        _bx_ok=1
        if [ "$_bx_st" = ok ] && json_select response 2>/dev/null; then
            _bx_rok=""
            json_get_var _bx_rok ok
            if [ "$_bx_rok" != 0 ] && json_select sections 2>/dev/null; then
                json_get_keys _bx_names
                for _bx_n in $_bx_names; do
                    case "$_bx_n" in ''|*[!A-Za-z0-9_]*) logger -t backup "plugin $_bx_id: the section name '$_bx_n' is not valid"; continue ;; esac
                    [ "${#_bx_n}" -le 64 ] || continue
                    _bx_t=""
                    json_get_var _bx_t "$_bx_n"
                    if [ -n "$(printf '%s' "$_bx_t" | LC_ALL=C tr -d '\11\12\40-\377')" ]; then
                        logger -t backup "plugin $_bx_id: section $_bx_n with control characters skipped"; continue
                    fi
                    printf '[plugin %s %s]\n' "$_bx_id" "$_bx_n"
                    printf '%s\n' "$_bx_t" | awk '{ print " " $0 }'
                done
                json_select ..
            fi
            json_select ..
        else
            logger -t backup "plugin $_bx_id gave no archive sections"
        fi
        json_select ..
    done
    return 0
}

# Контекст хука из разделов плагина (файлы plug.<id>.<имя> в каталоге разбора): {"op":…,"sections":{имя: текст}}.
backup_ext_ctx() {  # КАТАЛОГ ID ОПЕРАЦИЯ ФАЙЛ
    json_init
    json_add_string op "$3"
    json_add_object sections
    for _bc_f in "$1"/plug."$2".*; do
        [ -f "$_bc_f" ] || continue
        json_add_string "${_bc_f##*/plug.$2.}" "$(cat "$_bc_f")"
    done
    json_close_object
    json_dump > "$4"
}

# Результат хука одного плагина → BK_ST (статус хоста), BK_OK (ответ плагина: 1 — не возражает, 0 — отказ),
# BK_ERR (причина отказа), BK_WARN (предупреждения плагина, через «; »), BK_LISTS (что восстановлено: «вид:имя:сколько:
# отброшено» через пробел). Ответ хоста — первым аргументом, id плагина — вторым.
backup_ext_result() {  # ОТВЕТ_ХОСТА ID
    BK_ST=absent; BK_OK=1; BK_ERR=""; BK_WARN=""; BK_LISTS=""
    json_load "$1" 2>/dev/null || return 0
    json_select results 2>/dev/null || return 0
    json_get_keys _br_idx
    for _br_i in $_br_idx; do
        json_select "$_br_i" 2>/dev/null || continue
        json_get_var _br_id plugin
        if [ "$_br_id" = "$2" ]; then
            json_get_var BK_ST status
            if [ "$BK_ST" = ok ] && json_select response 2>/dev/null; then
                _br_rok=""
                json_get_var _br_rok ok
                [ "$_br_rok" = 0 ] && BK_OK=0
                json_get_var BK_ERR error
                if json_select warn 2>/dev/null; then
                    json_get_keys _br_wk
                    for _br_k in $_br_wk; do
                        json_get_var _br_w "$_br_k"
                        BK_WARN="${BK_WARN}${_br_w}; "
                    done
                    json_select ..
                fi
                if json_select restored 2>/dev/null; then
                    json_get_keys _br_rk
                    for _br_k in $_br_rk; do
                        json_select "$_br_k" 2>/dev/null || continue
                        json_get_var _br_n name; json_get_var _br_kind kind
                        json_get_var _br_c count; json_get_var _br_d dropped
                        BK_LISTS="$BK_LISTS $_br_kind:$_br_n:${_br_c:-0}:${_br_d:-0}"
                        json_select ..
                    done
                    json_select ..
                fi
                json_select ..
            fi
            json_select ..
            return 0
        fi
        json_select ..
    done
    return 0
}

# Проверка и восстановление разделов плагинов из каталога разбора. Плагин, которого нет или у которого нет хука, —
# предупреждение, а не отказ: остальное восстанавливается. Итог: BK_PLUG_DONE (сколько плагинов приняло), BK_PLUG_WARN,
# BK_PLUG_LISTS. ОПЕРАЦИЯ check ничего не меняет и может отказать (BK_PLUG_FAIL — причина): отказ отменяет всё до
# первой записи.
backup_ext_each() {  # КАТАЛОГ ОПЕРАЦИЯ
    BK_PLUG_DONE=0; BK_PLUG_WARN=""; BK_PLUG_LISTS=""; BK_PLUG_FAIL=""
    _be_ids=""
    for _be_f in "$1"/plug.*; do
        [ -f "$_be_f" ] || continue
        _be_b="${_be_f##*/}"; _be_b="${_be_b#plug.}"; _be_id="${_be_b%%.*}"
        case " $_be_ids " in *" $_be_id "*) ;; *) _be_ids="$_be_ids $_be_id" ;; esac
    done
    [ -n "$_be_ids" ] || return 0
    for _be_id in $_be_ids; do
        _be_ctx="$RUN_DIR/ctx.$2"
        backup_ext_ctx "$1" "$_be_id" "$2" "$_be_ctx"
        _be_out="$("$SPLIFY2_HOST" hook backup_sections --ctx "$_be_ctx" --plugin "$_be_id")"
        rm -f "$_be_ctx"
        backup_ext_result "$_be_out" "$_be_id"
        case "$BK_ST" in
            ok)
                if [ "$BK_OK" = 0 ]; then
                    if [ "$2" = check ]; then BK_PLUG_FAIL="$(s2_t backup.plugin_fail "Plugin {id}: {why}" id "$_be_id" why "${BK_ERR:-$(s2_t backup.archive_invalid "The archive is not valid")}")"; return 1; fi
                    BK_PLUG_WARN="${BK_PLUG_WARN}$(s2_t backup.plugin_rejected "Plugin {id} did not accept its settings from the archive{why}; " id "$_be_id" why "${BK_ERR:+ ($BK_ERR)}")"
                else
                    BK_PLUG_DONE=$((BK_PLUG_DONE + 1))
                fi
                BK_PLUG_WARN="$BK_PLUG_WARN$BK_WARN"
                BK_PLUG_LISTS="$BK_PLUG_LISTS$BK_LISTS" ;;
            absent)
                BK_PLUG_WARN="${BK_PLUG_WARN}$(s2_t backup.plugin_absent "The section of plugin {id} was not restored: the plugin is not installed or does not accept archive sections; " id "$_be_id")" ;;
            *)
                BK_PLUG_WARN="${BK_PLUG_WARN}$(s2_t backup.plugin_rejected_short "Plugin {id} did not accept its settings from the archive; " id "$_be_id")" ;;
        esac
    done
    return 0
}

# ---- сборка архива ----------------------------------------------------------------------------------------------

# Собрать архив в stdout из выгрузки хоста (каталог — первым аргументом).
backup_build() {  # КАТАЛОГ_ВЫГРУЗКИ
    # Разделы плагинов собираются ДО заголовка: от них зависит версия формата.
    _bb_ext="$(backup_ext_export; printf X)"
    _bb_ext="${_bb_ext%X}"
    _bb_fmt="$BACKUP_FORMAT"
    [ -n "$_bb_ext" ] && _bb_fmt="$BACKUP_FORMAT_EXT"
    printf 'splify2-backup %s\n' "$_bb_fmt"
    printf '# %s\n' "$(s2_t backup.header_1 "splify2 settings: the spec, subscriptions, tunnel keys, plugin data and uci fields.")"
    printf '# %s\n' "$(s2_t backup.header_2 "Restored by the same interface. Mirrors of the categories")"
    printf '# %s\n' "$(s2_t backup.header_3 "of the publisher are not here: the router downloads them itself, they are the same for everyone.")"
    printf '# %s\n' "$(s2_t backup.header_4 "WARNING: it holds vless:// links and private tunnel keys - the same as")"
    printf '# %s\n' "$(s2_t backup.header_5 "the password of all connections. Whoever gets this file gets access.")"
    printf '# %s\n' "$(s2_t backup.header_6 "Do not post it to a support chat or keep it in a shared folder.")"
    # awk 1, а не cat: файл без завершающего перевода строки склеил бы свою последнюю строку с заголовком следующего.
    [ -f "$1/spec" ] && { printf '[spec]\n'; awk 1 "$1/spec"; }
    [ -f "$1/sub" ] && { printf '[sub]\n'; awk 1 "$1/sub"; }
    [ -f "$1/select" ] && { printf '[select]\n'; awk 1 "$1/select"; }
    for _bb_f in "$1"/sub.*; do
        [ -f "$_bb_f" ] || continue
        printf '[sub %s]\n' "${_bb_f##*/sub.}"
        awk 1 "$_bb_f"
    done
    for _bb_f in "$1"/xsteer.*; do
        [ -f "$_bb_f" ] || continue
        printf '[xsteer %s]\n' "${_bb_f##*/xsteer.}"
        awk 1 "$_bb_f"
    done
    [ -n "$_bb_ext" ] && printf '%s' "$_bb_ext"
    if [ -f "$1/options" ]; then
        printf '[options]\n'
        cat "$1/options"
    fi
    return 0
}

# ---- разбор присланного архива ----------------------------------------------------------------------------------

# Разложить присланный файл по разделам в каталог-песочницу. Печатает причину и возвращает 1 на негодном файле.
#
# Разбор строгий и с отказом, а не «что понял — то и взял»: непонятный раздел означает либо чужой формат, либо файл от
# версии, которой этот плагин не знает, и в обоих случаях молча восстановить половину хуже, чем не восстановить ничего.
# Имена файлов в песочнице собираются ЗДЕСЬ из проверенных регулярным выражением частей — из присланного файла ни один
# путь не берётся.
# Разбор архива на разделы: при отказе печатает причину на языке каркаса (awk называет её кодом и подробностью через
# табуляцию, слова подставляет оболочка).
backup_split() {  # ФАЙЛ КАТАЛОГ
    _bs_out="$(backup_split_awk "$@")"; _bs_rc=$?
    [ "$_bs_rc" = 0 ] || {
        _bs_tab="$(printf '\t')"
        _bs_c="${_bs_out%%"$_bs_tab"*}"; _bs_a=""; [ "$_bs_c" = "$_bs_out" ] || _bs_a="${_bs_out#*"$_bs_tab"}"
        case "$_bs_c" in
            backup.not_settings) s2_t backup.not_settings "This is not a splify2 settings file" ;;
            backup.version) s2_t backup.version "The file is version {file}, this plugin understands up to {max}" file "${_bs_a%%"$_bs_tab"*}" max "${_bs_a#*"$_bs_tab"}" ;;
            backup.unknown_section) s2_t backup.unknown_section "Unknown section: {text}" text "$_bs_a" ;;
            backup.dup_section) s2_t backup.dup_section "The section repeats: {text}" text "$_bs_a" ;;
            backup.line_outside) s2_t backup.line_outside "A line outside any section: {text}" text "$_bs_a" ;;
            backup.line_indent) s2_t backup.line_indent "A plugin section line without an indent: {text}" text "$_bs_a" ;;
            *) printf '%s' "$_bs_out" ;;
        esac
    }
    return "$_bs_rc"
}
backup_split_awk() {  # ФАЙЛ КАТАЛОГ
    awk -v dir="$2" -v ver="$BACKUP_FORMAT_EXT" '
    NR == 1 {
        if ($0 !~ /^splify2-backup [0-9]+$/) { print "backup.not_settings"; exit 1 }
        if ($2 + 0 < 1 || $2 + 0 > ver + 0) {
            print "backup.version\t" $2 "\t" ver
            exit 1
        }
        next
    }
    # Комментарии выбрасываются везде, КРОМЕ разделов, которые едут дословно. Строки раздела плагина всегда
    # начинаются с пробела (отступ), поэтому комментарием быть не могут.
    /^#/ { if (kind != "xsteer") next }
    # Подписка в виде JSON бывает массивом: строка с `[` в начале — её содержимое, а не заголовок раздела. Внутри
    # раздела подписки заголовком считается только то, что называется нашим разделом.
    kind == "sub" && /^\[/ && !($0 == "[spec]" || $0 == "[sub]" || $0 == "[options]" || $0 == "[select]" ||
        $0 ~ /^\[(list (domains|prefixes)|sub|xsteer) [A-Za-z0-9_:@.-]+\]$/) { print > cur; next }
    /^\[/ {
        # Настройка туннеля — файл в формате WireGuard, и в нём есть СВОИ строки в квадратных скобках. Для разборщика
        # это содержимое, а не заголовки: файл обязан приехать дословно.
        if (kind == "xsteer" && ($0 == "[Interface]" || $0 == "[Peer]")) { print > cur; next }
        kind = ""
        if ($0 == "[spec]")         { cur = dir "/spec" }
        else if ($0 == "[sub]")     { cur = dir "/sub"; kind = "sub" }
        else if ($0 == "[options]") { cur = dir "/options" }
        else if ($0 == "[select]")  { cur = dir "/select" }
        # Свои списки формата 3: до выноса каталога списков в плагин они лежали разделом каркаса.
        else if ($0 ~ /^\[list (domains|prefixes) [A-Za-z0-9_-]+\]$/) {
            split(substr($0, 2, length($0) - 2), p, " ")
            cur = dir "/list." p[2] "." p[3]
        }
        # Имя подписки — слаг: латиница, цифры, подчёркивание. Оно становится и именем файла, и именем секции uci.
        else if ($0 ~ /^\[sub [A-Za-z0-9_]+\]$/) {
            split(substr($0, 2, length($0) - 2), p, " ")
            cur = dir "/sub." p[2]; kind = "sub"
        }
        # Имена туннелей — без ведущей точки: имя становится частью имени файла, и «..» означало бы запись мимо каталога.
        else if ($0 ~ /^\[xsteer [A-Za-z0-9_:@-][A-Za-z0-9_.:@-]*\]$/) {
            split(substr($0, 2, length($0) - 2), p, " ")
            cur = dir "/xsteer." p[2]; kind = "xsteer"
        }
        # Раздел плагина: id — как у манифеста, имя — буквы, цифры, подчёркивание. Оба становятся частью имени файла в
        # песочнице, поэтому точка в имени запрещена (в id дефис допускается, точки — нет).
        else if ($0 ~ /^\[plugin [a-z0-9][a-z0-9-]* [A-Za-z0-9_]+\]$/) {
            split(substr($0, 2, length($0) - 2), p, " ")
            cur = dir "/plug." p[2] "." p[3]; kind = "plugin"
        }
        else { print "backup.unknown_section\t" substr($0, 1, 40); exit 1 }
        if (seen[cur]++) { print "backup.dup_section\t" substr($0, 1, 40); exit 1 }
        printf "" > cur
        next
    }
    {
        if (cur == "") {
            if ($0 ~ /^[ \t]*$/) next
            print "backup.line_outside\t" substr($0, 1, 40)
            exit 1
        }
        if (kind == "plugin") {
            if (substr($0, 1, 1) != " ") { print "backup.line_indent\t" substr($0, 1, 40); exit 1 }
            print substr($0, 2) > cur
            next
        }
        print > cur
    }
    ' "$1"
}

# Архивы формата 3 несли данные каталога списков каркасными разделами и полями uci. Теперь их хозяин — плагин
# lists-catalog, и они переезжают к нему разделами плагина: `[list К ИМЯ]` → `list_К_<имя>`, поля manifest_url и
# list_shrink_factor → раздел `settings`. Кодировка имени — та, что у хука этого плагина: `_` → `__`, `-` → `_d`.
backup_legacy() {  # КАТАЛОГ
    for _bl_f in "$1"/list.*; do
        [ -f "$_bl_f" ] || continue
        _bl_b="${_bl_f##*/}"; _bl_rest="${_bl_b#list.}"; _bl_k="${_bl_rest%%.*}"; _bl_nm="${_bl_rest#*.}"
        _bl_enc="$(printf '%s' "$_bl_nm" | sed -e 's/_/__/g' -e 's/-/_d/g')"
        mv "$_bl_f" "$1/plug.$LEGACY_LISTS_PLUGIN.list_${_bl_k}_${_bl_enc}"
    done
    [ -f "$1/options" ] || return 0
    _bl_set=""
    _bl_sched=""
    _bl_keep="$1/options.keep"
    : > "$_bl_keep"
    json_init
    while IFS= read -r _bl_ln; do
        [ -n "$_bl_ln" ] || continue
        _bl_k="${_bl_ln%%=*}"; _bl_v="${_bl_ln#*=}"
        case "$_bl_k" in
            manifest_url) json_add_string manifest_url "$_bl_v"; _bl_set=1 ;;
            list_shrink_factor)
                case "$_bl_v" in ''|*[!0-9]*) printf '%s\n' "$_bl_ln" >> "$_bl_keep" ;; *) json_add_int list_shrink_factor "$_bl_v"; _bl_set=1 ;; esac ;;
            # Интервалы автообновления подписок — данные плагина subscriptions: раздел `schedule` («имя минуты»).
            *.auto) _bl_sn="${_bl_k%%.*}"; _bl_sched="${_bl_sched}${_bl_sn#*_} $_bl_v
" ;;
            *_auto) _bl_sched="${_bl_sched}main $_bl_v
" ;;
            *) printf '%s\n' "$_bl_ln" >> "$_bl_keep" ;;
        esac
    done < "$1/options"
    if [ -n "$_bl_sched" ] && [ ! -f "$1/plug.subscriptions.schedule" ]; then
        printf '%s' "$_bl_sched" > "$1/plug.subscriptions.schedule"
    fi
    if [ -n "$_bl_set" ] && [ ! -f "$1/plug.$LEGACY_LISTS_PLUGIN.settings" ]; then
        json_dump > "$1/plug.$LEGACY_LISTS_PLUGIN.settings"
    fi
    mv "$_bl_keep" "$1/options"
}

# Отказ с уборкой за собой: развёрнутый архив и накопленный файл убираются, причина уезжает человеку.
backup_giveup() {  # ПРИЧИНА
    rm -rf "$D"
    rm -f "$BACKUP_IN"
    s2_fail "$1"
}

# ---- методы -----------------------------------------------------------------------------------------------------

backup_get() {
    # Архив уезжает СТРОКОЙ и по кускам, а файл собирается в браузере. Готового способа отдать файл в платформе нет, а
    # cgi-io означал бы второй путь наружу со своими правами и своей проверкой.
    read -r input
    off="$(jsonfilter -s "$input" -e '@.offset' 2>/dev/null)"
    case "$off" in ''|*[!0-9]*) off=0 ;; esac
    # Пересобирается только на первом куске: пересборка на каждом означала бы, что куски приезжают из разных мгновений и
    # склеиваются в файл, которого не было.
    if [ "$off" = 0 ]; then
        # Под umask 077: в архиве ПРИВАТНЫЕ КЛЮЧИ туннелей. Рабочий каталог плагина закрыт (0700, root), файл между
        # запросами кусков лежит ровно столько, сколько длится выгрузка.
        rm -f "$BACKUP_OUT"
        E="$(mktemp -d "$RUN_DIR/export.XXXXXX")" || s2_fail_code backup.build_failed "Cannot build the archive"
        if ! "$SPLIFY2_HOST" state export "$E" >/dev/null; then
            rm -rf "$E"; s2_fail_code backup.export_failed "Cannot export the settings"
        fi
        ( umask 077; backup_build "$E" > "$BACKUP_OUT" ) ||
            { rm -rf "$E"; rm -f "$BACKUP_OUT"; s2_fail_code backup.build_failed "Cannot build the archive"; }
        rm -rf "$E"
    fi
    [ -s "$BACKUP_OUT" ] || s2_fail_code backup.not_built "The archive is not built: request it from the start"
    total="$(wc -c 2>/dev/null < "$BACKUP_OUT" || echo 0)"
    # Отказ на СОБСТВЕННОМ пределе восстановления, а не молчаливая отдача: экспорт, выдающий файл, который его же импорт
    # откажется принять, обнаруживается в тот день, когда бекап понадобился.
    if [ "$total" -gt "$BACKUP_MAX_BYTES" ]; then
        rm -f "$BACKUP_OUT"
        s2_fail_code backup.too_big_out "The settings with their own lists do not fit into the archive: {size} KB with a limit of {max} KB" size "$((total / 1024))" max "$((BACKUP_MAX_BYTES / 1024))"
    fi
    # Заплатка `printf X` и срезание её обратно: подстановка команды съедает ЗАВЕРШАЮЩИЕ переводы строки, а кусок обязан
    # приехать байт в байт — иначе на границе куска две строки настроек склеиваются в одну.
    text="$(tail -c "+$((off + 1))" "$BACKUP_OUT" | head -c "$BACKUP_CHUNK"; printf X)"
    text="${text%X}"
    got="$(printf '%s' "$text" | wc -c)"
    next=$((off + got))
    eof=0
    [ "$next" -ge "$total" ] && eof=1
    json_init
    json_add_boolean ok 1
    fmt="$(head -n 1 "$BACKUP_OUT" 2>/dev/null | cut -d' ' -f2)"
    case "$fmt" in ''|*[!0-9]*) fmt="$BACKUP_FORMAT" ;; esac
    json_add_int format "$fmt"
    json_add_int total "$total"
    json_add_int offset "$off"
    json_add_int next "$next"
    json_add_boolean eof "$eof"
    json_add_string text "$text"
    json_dump
    # Через `if`, а не через `&&`: последняя команда ветки задаёт код возврата всего скрипта.
    if [ "$eof" = 1 ]; then rm -f "$BACKUP_OUT"; fi
}

backup_put() {
    # Восстановление. Присланный файл — НЕДОВЕРЕННЫЙ ВВОД: порядок такой — принять по кускам с пределом на размер →
    # разложить строгим разборщиком по разделам → проверить КАЖДЫЙ раздел (каркас — хост, данные плагина — сам плагин,
    # операцией check) → и только потом писать на диск.
    #
    # Применения здесь нет и быть не должно: восстановленное человек видит как неприменённое и применяет сам (модель
    # «сохранено ≠ применено»).
    read -r input
    json_load "$input" 2>/dev/null || s2_fail_code req.unparsable "Unparsable request"
    text=''; append=''; final=''
    json_get_var text text
    json_get_var append append
    json_get_var final final
    case "$append" in 1|true) ;; *) rm -f "$BACKUP_IN" ;; esac
    have=0
    [ -f "$BACKUP_IN" ] && have="$(wc -c 2>/dev/null < "$BACKUP_IN" || echo 0)"
    add="$(printf '%s' "$text" | wc -c)"
    # Предел считается по НАКОПЛЕННОМУ, а не по куску: иначе он обходится самым обычным способом им пользоваться —
    # прислать двадцать кусков по пределу каждый.
    if [ "$((have + add))" -gt "$BACKUP_MAX_BYTES" ]; then
        rm -f "$BACKUP_IN"
        s2_fail_code backup.too_big_in "The archive is larger than {max} KB: settings are never that large" max "$((BACKUP_MAX_BYTES / 1024))"
    fi
    # Накопитель создаётся закрытым: присланный файл несёт чужие приватные ключи.
    [ -f "$BACKUP_IN" ] || ( umask 077; : > "$BACKUP_IN" )
    printf '%s' "$text" >> "$BACKUP_IN" || { rm -f "$BACKUP_IN"; s2_fail_code lists.write_failed "Cannot write: no space left"; }
    case "$final" in
        1|true) ;;
        *)  json_init; json_add_boolean ok 1; json_add_int bytes "$((have + add))"; json_dump; exit 0 ;;
    esac
    [ -s "$BACKUP_IN" ] || { rm -f "$BACKUP_IN"; s2_fail_code backup.empty "The archive is empty"; }
    # Управляющие байты — отдельной проверкой на весь файл и до разбора: перевод строки и табуляция законны, всё прочее
    # в текстовом файле означает либо двоичный мусор, либо попытку спрятать строку от построчного разборщика.
    if [ "$(LC_ALL=C tr -d '\11\12\40-\377' < "$BACKUP_IN" | wc -c)" != 0 ]; then
        rm -f "$BACKUP_IN"
        s2_fail_code backup.binary "The archive holds binary data: this is not a settings file"
    fi
    D="$(mktemp -d "$RUN_DIR/restore.XXXXXX")" || s2_fail_code backup.unpack_failed "Cannot unpack the archive"
    why="$(backup_split "$BACKUP_IN" "$D")" || backup_giveup "${why:-$(s2_t backup.unparsable "The archive cannot be parsed")}"
    backup_legacy "$D"
    fw=0
    for f in "$D/spec" "$D/sub" "$D/options" "$D/select" "$D"/sub.* "$D"/xsteer.*; do
        [ -f "$f" ] && fw=1
    done
    plug=0
    for f in "$D"/plug.*; do [ -f "$f" ] && plug=1; done
    [ "$fw$plug" != 00 ] || backup_giveup "$(s2_t state.archive_empty "The archive has neither settings nor lists")"

    # ---- проверка всего, ничего не записывая ----
    if [ "$fw" = 1 ]; then
        chk="$("$SPLIFY2_HOST" state check "$D")" || {
            json_load "$chk" 2>/dev/null; json_get_var why error
            backup_giveup "${why:-$(s2_t backup.archive_invalid "The archive is not valid")}"; }
    fi
    backup_ext_each "$D" check || backup_giveup "$BK_PLUG_FAIL"

    # ---- с этого места пишем на диск ----
    # Разделы плагинов — ДО настроек каркаса: спека из архива ссылается на файлы, которые эти плагины кладут (свои списки),
    # а ядро при проверке спеки читает их с диска. Положив спеку первой, мы получили бы отказ ядра на файлах, которые
    # едут в том же архиве.
    backup_ext_each "$D" restore
    warn="$BK_PLUG_WARN"
    plug_done="$BK_PLUG_DONE"
    plug_lists="$BK_PLUG_LISTS"
    spec_done=0; sub_done=0; subs_done=0; xsteer_done=0; select_done=0
    if [ "$fw" = 1 ]; then
        imp="$("$SPLIFY2_HOST" state import "$D")"; imp_rc=$?
        json_load "$imp" 2>/dev/null
        if [ "$imp_rc" != 0 ]; then
            json_get_var why error
            backup_giveup "${why:-$(s2_t backup.restore_failed "The settings were not restored")}"
        fi
        json_get_var spec_done spec; json_get_var sub_done sub; json_get_var subs_done subs
        json_get_var xsteer_done xsteer; json_get_var select_done select
        json_get_var iwarn warn
        [ -n "$iwarn" ] && warn="$warn$iwarn"
    fi
    # Помощников выходов после восстановления перезапускает демон при «Применить»: он сверяет прежнюю спеку с новой и
    # подпись помощника (параметры выхода и содержимое файла подписки) с запущенным.
    json_init
    json_add_boolean ok 1
    json_add_boolean spec "${spec_done:-0}"
    json_add_boolean sub "${sub_done:-0}"
    # Числами, а не одним «ок»: «восстановлено» без перечня не отличает «вернули всё» от «вернули один список».
    json_add_int subs "${subs_done:-0}"
    json_add_int xsteer "${xsteer_done:-0}"
    json_add_boolean select "${select_done:-0}"
    [ "$plug_done" -gt 0 ] && json_add_int plugins "$plug_done"
    json_add_array lists
    for e in $plug_lists; do
        k="${e%%:*}"; rest="${e#*:}"; nm="${rest%%:*}"; rest="${rest#*:}"
        json_add_object ""
        json_add_string name "$nm"
        json_add_string kind "$k"
        json_add_int count "${rest%%:*}"
        json_add_int dropped "${rest#*:}"
        json_close_object
    done
    json_close_array
    [ -n "$warn" ] && json_add_string warn "$warn"
    json_dump
    rm -rf "$D"
    rm -f "$BACKUP_IN"
}
