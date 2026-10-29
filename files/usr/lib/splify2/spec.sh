# Спека ядра на диске: где она, как её читать и как писать. Подключают диспетчер rpcd, fast.sh и
# splify2-update-lists.
#
# ФАЙЛ ЯДРА — spec.yaml или spec.json (его ставит uci-defaults пустым, пока нет первой записи).
# Ядро читает тот, что лежит;
# два сразу — отказ «две спеки». `--spec /etc/steer/spec.json` у ядра значит «какая из двух
# лежит», поэтому вызовы ядра идут с $SPEC при любом формате.
#
# ЧИТАЕТ splify2 JSON: jsonfilter, jshn, ucode и панель по ubus YAML не разбирают. При spec.yaml
# JSON-вид отдаёт само ядро (`steer spec convert --json`), и лежит он в /tmp; пересчитывается,
# когда меняется spec.yaml (сверка по md5sum — секундная точность mtime пропустила бы две записи
# подряд). Поэтому ЧИТАТЬ — только через `spec_json`, а не $SPEC.
#
# ПИШЕТ splify2 через `spec_put`: spec.yaml (переводом присланной спеки ядром), прежний spec.json
# уходит с копией рядом.
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

# Путь JSON-вида спеки для чтения. Не вышел перевод ядром — путь пустого вида (файла нет):
# читатели видят «спеки нет», а не чужой текст.
spec_json() {
    if ! spec_is_yaml; then
        printf '%s' "$SPEC"
        return
    fi
    _sj_sum="$(md5sum < "$SPEC_YAML" 2>/dev/null | cut -c1-32)"
    if [ ! -s "$SPEC_VIEW" ] || [ "$(cat "$SPEC_VIEW.sum" 2>/dev/null)" != "$_sj_sum" ] || ! spec_own "$SPEC_VIEW"; then
        # Прежний вид НЕ удаляется перед пересчётом: параллельный читатель (spec_get посреди записи
        # спеки) получал бы путь к файлу, которого между `rm` и `mv` нет, и видел бы «спеки нет».
        # Новый вид кладётся поверх одним переименованием; удаляется старый, только если перевод не
        # вышел (устаревший вид хуже его отсутствия).
        # Временный файл — mktemp: имя с номером процесса в /tmp предсказуемо.
        _sj_t="$(mktemp "$SPEC_VIEW.XXXXXX" 2>/dev/null)" || _sj_t=""
        if [ -n "$_sj_t" ] && "$STEER" spec convert --json --spec "$SPEC_YAML" > "$_sj_t" 2>/dev/null &&
                [ "$(head -c 1 "$_sj_t")" = "{" ]; then
            mv -f "$_sj_t" "$SPEC_VIEW" && printf '%s' "$_sj_sum" > "$SPEC_VIEW.sum"
        else
            [ -z "$_sj_t" ] || rm -f "$_sj_t"
            rm -f "$SPEC_VIEW" "$SPEC_VIEW.sum"
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

# Поставить спеку из JSON-файла ВРЕМЕННОГО (рядом со спекой: mv внутри одной ФС — rename) на
# место. Код 1 — не легла; временный файл тогда удалён, прежняя спека цела.
spec_put() {  # ВРЕМЕННЫЙ_JSON
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
}

# ПЕРЕВОД spec.json НА spec.yaml при установке ядра (m-engine.sh, steer_install): ядро читает v1 и
# v2 и печатает v2. Копия v1 — spec.json.v1.bak (одна, старейшая). Ничего не делает, когда
# spec.json нет.
spec_migrate() {
    [ -s "$SPEC" ] || return 0
    _spm_t="$SPEC.new.$$"
    [ -e "$SPEC.v1.bak" ] || [ -n "$(jsonfilter -i "$SPEC" -e '@.version' 2>/dev/null)" ] ||
        cp "$SPEC" "$SPEC.v1.bak" 2>/dev/null
    cp "$SPEC" "$_spm_t" || return 1
    spec_put "$_spm_t"
}
