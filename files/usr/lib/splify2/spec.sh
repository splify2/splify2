# Спека ядра на диске: где она, как её читать и как писать. Подключают диспетчер rpcd, fast.sh и
# splify2-update-lists.
#
# ФАЙЛ ЯДРА — spec.yaml (с steer 2.1.0) или spec.json (прежние ядра). Ядро читает тот, что лежит;
# два сразу — отказ «две спеки». `--spec /etc/steer/spec.json` у ядра значит «какая из двух
# лежит», поэтому вызовы ядра идут с $SPEC при любом формате.
#
# ЧИТАЕТ splify2 JSON: jsonfilter, jshn, ucode и панель по ubus YAML не разбирают. При spec.yaml
# JSON-вид отдаёт само ядро (`steer spec convert --json`), и лежит он в /tmp; пересчитывается,
# когда меняется spec.yaml (сверка по md5sum — секундная точность mtime пропустила бы две записи
# подряд). Поэтому ЧИТАТЬ — только через `spec_json`, а не $SPEC.
#
# ПИШЕТ splify2 через `spec_put`: на ядре с `convert --json` — spec.yaml (переводом присланной
# спеки, v1 тоже), прежний spec.json уходит с копией рядом; на прежнем ядре — spec.json, как было.
# Применять (`steer apply`) — только с $SPEC: ядро кладёт присланное тело в текущий файл спеки, и
# JSON-вид в apply оставил бы JSON-текст в spec.yaml.

SPEC="${SPEC:-/etc/steer/spec.json}"
SPEC_YAML="${SPEC_YAML:-${SPEC%/*}/spec.yaml}"
SPEC_VIEW="${SPEC_VIEW:-/tmp/splify2-spec.json}"

# Спека есть — в каком-нибудь из двух файлов.
spec_have() {
    [ -s "$SPEC" ] || [ -s "$SPEC_YAML" ]
}

# Спека ведётся в spec.yaml (spec.json нет).
spec_is_yaml() {
    [ -s "$SPEC_YAML" ] && [ ! -e "$SPEC" ]
}

# Путь JSON-вида спеки для чтения. Ядро без `convert --json` при spec.yaml — путь пустого вида
# (файла нет): читатели видят «спеки нет», а не чужой текст.
spec_json() {
    if ! spec_is_yaml; then
        printf '%s' "$SPEC"
        return
    fi
    _sj_sum="$(md5sum < "$SPEC_YAML" 2>/dev/null | cut -c1-32)"
    if [ ! -s "$SPEC_VIEW" ] || [ "$(cat "$SPEC_VIEW.sum" 2>/dev/null)" != "$_sj_sum" ] || ! spec_own "$SPEC_VIEW"; then
        rm -f "$SPEC_VIEW" "$SPEC_VIEW.sum"
        if "$STEER" spec convert --json --spec "$SPEC_YAML" > "$SPEC_VIEW.$$" 2>/dev/null &&
                [ "$(head -c 1 "$SPEC_VIEW.$$")" = "{" ]; then
            mv -f "$SPEC_VIEW.$$" "$SPEC_VIEW" && printf '%s' "$_sj_sum" > "$SPEC_VIEW.sum"
        else
            rm -f "$SPEC_VIEW.$$"
        fi
    fi
    printf '%s' "$SPEC_VIEW"
}

# Ревизия спеки — md5 её JSON-вида (D-P2.7). Это то, что читает spec_get и против чего spec_set
# сверяет `rev` присланной правки: файл, переписанный кем-то за спиной страницы (вторая вкладка,
# ssh, самолечение apply, подписка), даёт другую ревизию. Хэш содержимого, а не mtime: секундная
# точность mtime пропустила бы две записи подряд, а счётчик изменений пришлось бы хранить рядом.
# Пусто — спеки нет.
spec_rev() {
    _sr="$(spec_json)"
    [ -s "$_sr" ] || return 0
    md5sum < "$_sr" 2>/dev/null | cut -c1-32
}

# Файл в /tmp годится, только если он наш (довод — own_file в rpcd/common.sh: /tmp пишут все).
spec_own() {
    [ -f "$1" ] || return 1
    set -- $(ls -ldn "$1" 2>/dev/null)
    [ -n "${3:-}" ] && [ "$3" = "$(id -u 2>/dev/null)" ]
}

# Ядро печатает спеку JSON-ом (steer 2.1.0, `spec_json` в status.features). Проверка — самой
# командой на пустой спеке: признак в status стоил бы полного опроса ядра.
spec_yaml_ok() {
    [ -n "${_spec_yaml_ok:-}" ] || {
        case "$(printf '{"version":2,"outputs":{"direct":{"kind":"direct"}}}' |
            "$STEER" spec convert --json --spec - 2>/dev/null)" in
            '{'*) _spec_yaml_ok=1 ;;
            *) _spec_yaml_ok=0 ;;
        esac
    }
    [ "$_spec_yaml_ok" = 1 ]
}

# Поставить спеку из JSON-файла ВРЕМЕННОГО (рядом со спекой: mv внутри одной ФС — rename) на
# место. Код 1 — не легла; временный файл тогда удалён, прежняя спека цела.
spec_put() {  # ВРЕМЕННЫЙ_JSON
    if spec_yaml_ok; then
        _sp_y="$SPEC_YAML.new.$$"
        if ! "$STEER" spec convert --spec "$1" > "$_sp_y" 2>/dev/null || [ ! -s "$_sp_y" ]; then
            rm -f "$_sp_y" "$1"
            return 1
        fi
        mv "$_sp_y" "$SPEC_YAML" || { rm -f "$_sp_y" "$1"; return 1; }
        # Прежний spec.json — копией рядом (одна, старейшая): перевод формата откатывается ею.
        if [ -e "$SPEC" ]; then
            [ -e "$SPEC.bak" ] || cmp -s "$SPEC" "$SPEC.v1.bak" || cp "$SPEC" "$SPEC.bak" 2>/dev/null
            rm -f "$SPEC"
        fi
        rm -f "$1"
        spec_json >/dev/null
        return 0
    fi
    # Прежнее ядро: spec.yaml рядом быть не может (ядро не читает две) — его пишут руками.
    [ -s "$SPEC_YAML" ] && { rm -f "$1"; return 1; }
    mv "$1" "$SPEC" || { rm -f "$1"; return 1; }
}

# ПЕРЕВОД НА spec.yaml при обновлении ядра (m-engine.sh, steer_install). Спеку v1 переводит
# СТАРОЕ ядро до замены пакета (`spec_premigrate`): ядро 2.1 v1 может уже не читать. Кладётся
# переведённое после установки (`spec_migrate`), и только если новое ядро печатает JSON-вид —
# иначе splify2 не смог бы прочесть собственную спеку; тогда остаётся spec.json как был.

# Печатает путь заготовки (YAML) или ничего. Только для v1 в spec.json.
spec_premigrate() {
    [ -s "$SPEC" ] || return 0
    [ -n "$(jsonfilter -i "$SPEC" -e '@.schema' 2>/dev/null)" ] || return 0
    [ -z "$(jsonfilter -i "$SPEC" -e '@.version' 2>/dev/null)" ] || return 0
    _spm="$SPEC.v2.$$"
    if "$STEER" spec convert --spec "$SPEC" > "$_spm" 2>/dev/null && [ -s "$_spm" ]; then
        printf '%s' "$_spm"
    else
        rm -f "$_spm"
    fi
}

# После установки ядра: spec.json → spec.yaml (заготовка v1 — вместо самого файла). Ничего не
# делает на ядре без JSON-вида и когда spec.json нет.
spec_migrate() {  # [ЗАГОТОВКА]
    _spm_pre="${1:-}"
    _spec_yaml_ok=""
    if [ ! -s "$SPEC" ] || ! spec_yaml_ok; then
        [ -n "$_spm_pre" ] && rm -f "$_spm_pre"
        return 0
    fi
    _spm_t="$SPEC.new.$$"
    if [ -n "$_spm_pre" ]; then
        [ -e "$SPEC.v1.bak" ] || cp "$SPEC" "$SPEC.v1.bak" 2>/dev/null
        mv "$_spm_pre" "$_spm_t" || return 1
    else
        cp "$SPEC" "$_spm_t" || return 1
    fi
    spec_put "$_spm_t"
}
