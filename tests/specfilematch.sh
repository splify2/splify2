#!/bin/sh
# Спека в spec.yaml (files/usr/lib/splify2/spec.sh): чтение JSON-видом, запись переводом ядра,
# перевод spec.json и v1 при обновлении ядра — ПОВЕДЕНИЕ на заглушке ядра.
#
# Заглушка `steer` умеет то, что нужно spec.sh от ядра 2.1: `spec convert --spec Ф` печатает
# «YAML» (строка-метка и JSON следом), `spec convert --json --spec Ф` — JSON (метка снимается).
# Без STUB_JSON=1 заглушка — прежнее ядро: `--json` не знает.
#
# Запуск: sh tests/specfilematch.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/etc"
cat > "$T/bin/steer" <<'STUB'
#!/bin/sh
[ "$1 $2" = "spec convert" ] || exit 2
shift 2
json=0; f=""
while [ $# -gt 0 ]; do
    case "$1" in --json) json=1 ;; --spec) f="$2"; shift ;; esac
    shift
done
[ "$json" = 1 ] && [ "${STUB_JSON:-0}" != 1 ] && { echo "unknown option --json" >&2; exit 2; }
if [ "$f" = - ]; then body="$(cat)"; else body="$(cat "$f")"; fi
body="$(printf '%s\n' "$body" | sed '/^# yaml$/d')"
case "$body" in *BAD*) echo "отказ" >&2; exit 2 ;; esac
# v1 → v2: заглушка меняет schema на version.
body="$(printf '%s' "$body" | sed 's/"schema":1/"version":2/')"
if [ "$json" = 1 ]; then printf '%s\n' "$body"; else printf '# yaml\n%s\n' "$body"; fi
STUB
chmod +x "$T/bin/steer"
# jsonfilter: только `-i Ф -e '@.ключ'` верхнего уровня с числом — столько спрашивает spec.sh.
cat > "$T/bin/jsonfilter" <<'STUB'
#!/bin/sh
f=""; k=""
while [ $# -gt 0 ]; do
    case "$1" in -i) f="$2"; shift ;; -e) k="${2#@.}"; shift ;; esac
    shift
done
sed -n "s/.*\"$k\":\([0-9]*\).*/\1/p" "$f"
STUB
chmod +x "$T/bin/jsonfilter"
PATH="$T/bin:$PATH"

pass=0; failn=0
check() {
    if [ "$2" = "$3" ]; then pass=$((pass + 1)); printf '%-60s ok\n' "$1"
    else failn=$((failn + 1)); printf '%-60s ПРОВАЛ\n    ожидалось: %s\n    получено:  %s\n' "$1" "$2" "$3"; fi
}

# Каждая проверка — в своей оболочке со свежим spec.sh.
run() {  # STUB_JSON КОД
    ( cd "$T/etc" && STUB_JSON="$1" STEER="$T/bin/steer" SPEC="$T/etc/spec.json" SPEC_VIEW="$T/view.json" \
        sh -c ". '$ROOT/files/usr/lib/splify2/spec.sh'; $2" )
}
reset() { rm -rf "$T/etc" "$T"/view.json*; mkdir -p "$T/etc"; }

# --- прежнее ядро: всё как было ---
reset
printf '{"version":2,"a":1}' > "$T/etc/spec.json.new.1"
check "прежнее ядро: spec_put кладёт spec.json" "0" "$(run 0 'spec_put spec.json.new.1; echo $?')"
check "  spec.yaml не появляется" "no" "$([ -e "$T/etc/spec.yaml" ] && echo yes || echo no)"
check "  читать — spec.json" "$T/etc/spec.json" "$(run 0 'spec_json')"
check "  умения нет" "no" "$(run 0 'spec_yaml_ok && echo yes || echo no')"
printf '# yaml\n{"version":2}\n' > "$T/etc/spec.yaml"
printf '{"version":2,"b":1}' > "$T/etc/spec.json.new.2"
check "прежнее ядро и spec.yaml рядом: spec_put отказывает" "1" "$(run 0 'spec_put spec.json.new.2; echo $?')"
check "  временный файл убран" "no" "$([ -e "$T/etc/spec.json.new.2" ] && echo yes || echo no)"

# --- ядро 2.1: запись spec.yaml ---
reset
printf '{"version":2,"a":1}' > "$T/etc/spec.json"
printf '{"version":2,"a":2}' > "$T/etc/spec.json.new.1"
check "ядро 2.1: spec_put" "0" "$(run 1 'spec_put spec.json.new.1; echo $?')"
check "  spec.yaml записан переводом" "# yaml" "$(head -1 "$T/etc/spec.yaml")"
check "  spec.json убран" "no" "$([ -e "$T/etc/spec.json" ] && echo yes || echo no)"
check "  прежний spec.json — копией" '{"version":2,"a":1}' "$(cat "$T/etc/spec.json.bak")"
check "  читать — JSON-вид" '{"version":2,"a":2}' "$(run 1 'cat "$(spec_json)"')"
check "  спека есть" "yes" "$(run 1 'spec_have && echo yes')"
printf '# yaml\n{"version":2,"a":3}\n' > "$T/etc/spec.yaml"
check "правка spec.yaml руками — вид пересчитан сразу" '{"version":2,"a":3}' "$(run 1 'cat "$(spec_json)"')"
printf '{"version":2,"BAD":1}' > "$T/etc/spec.json.new.3"
check "ядро отвергло — spec_put 1" "1" "$(run 1 'spec_put spec.json.new.3; echo $?')"
check "  прежняя спека цела" '{"version":2,"a":3}' "$(run 1 'cat "$(spec_json)"')"
check "  временные убраны" "" "$(ls "$T/etc" | grep new)"
check "прежнее ядро при spec.yaml: вида нет — не чужой текст" "no" "$(rm -f "$T"/view.json*; run 0 '[ -s "$(spec_json)" ] && echo yes || echo no')"

# --- перевод при обновлении ядра ---
reset
printf '{"schema":1,"outputs":{}}' > "$T/etc/spec.json"
pre="$(run 0 'spec_premigrate')"
check "v1: заготовку делает прежнее ядро" "# yaml" "$(head -1 "$pre" 2>/dev/null)"
check "  новое ядро без --json — spec.json остаётся" "yes" "$(run 0 "spec_migrate '$pre'; [ -e spec.json ] && echo yes")"
check "  заготовка убрана" "no" "$([ -e "$pre" ] && echo yes || echo no)"
pre="$(run 0 'spec_premigrate')"
run 1 "spec_migrate '$pre'" >/dev/null
check "  новое ядро с --json — spec.yaml из заготовки" '{"version":2,"outputs":{}}' "$(run 1 'cat "$(spec_json)"')"
check "  копия v1" '{"schema":1,"outputs":{}}' "$(cat "$T/etc/spec.json.v1.bak")"
check "  лишней копии нет" "no" "$([ -e "$T/etc/spec.json.bak" ] && echo yes || echo no)"
reset
printf '{"version":2,"z":1}' > "$T/etc/spec.json"
check "v2 JSON: заготовки нет" "" "$(run 1 'spec_premigrate')"
run 1 'spec_migrate ""' >/dev/null
check "  переведена в spec.yaml" '{"version":2,"z":1}' "$(run 1 'cat "$(spec_json)"')"
check "  spec.json убран" "no" "$([ -e "$T/etc/spec.json" ] && echo yes || echo no)"

# --- вид спеки пересчитывается без окна «файла нет» ---
# Прежний вид не удалялся лишь после перевода: читатель между `rm` и `mv` получал путь к несуществующему
# файлу. Теперь старый вид лежит, пока не заменён переименованием; пересчёт, у которого перевод не
# вышел, убирает его (устаревший хуже отсутствующего).
check "пересчёт не стирает вид заранее (rm перед переводом убран)" "0" \
    "$(grep -c '^        rm -f "\$SPEC_VIEW" "\$SPEC_VIEW.sum"$' "$ROOT/files/usr/lib/splify2/spec.sh")"

echo
echo "$pass проверок пройдено, $failn ПРОВАЛЕНО"
[ "$failn" = 0 ]
