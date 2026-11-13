#!/bin/sh
# Установщик splify2: определение версии (оба пути и оба отказа) и обнаружение splify
# первой версии на том же роутере.
#
# Зачем отдельный стенд. Однострочный установщик — заявленный основной способ установки,
# и версию он спрашивал ровно в одном месте: у api.github.com. У аудитории splify2 этот
# хост недоступен чаще, чем сам github.com — его блокируют отдельно, а за CGNAT
# неавторизованный лимит API (60 запросов в час на адрес) выбирают соседи. Тогда установка
# падала на «не удалось узнать версию движка (нет релизов?)», хотя релиз и пакет под
# нужную архитектуру существовали: splify2#5, два человека на mipsel_24kc, оба поставили
# те же самые пакеты руками. Находка I-058, roadmap R-048.
#
# Как проверяется. Функция latest() достаётся из install.sh текстом и выполняется в этой
# оболочке — тот же приём, что у dnsmatch.c и submatch.c в steer («файл включает
# исходник»): установщик целиком запускать нельзя, он поставит пакеты. wget подменяется
# заглушкой в PATH, и каждый случай задаёт ответы обоих хостов по отдельности.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

pass=0 fail=0
check() {
    if [ "$2" = "$3" ]; then
        pass=$((pass + 1))
    else
        fail=$((fail + 1))
        printf 'FAIL %s\n  ожидалось: %s\n  получено:  %s\n' "$1" "$2" "$3"
    fi
}

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT INT TERM
mkdir -p "$SB/bin"

# Заглушка wget: отвечает из файлов по признаку хоста в URL. Отсутствие файла — это
# «хост не ответил»: пустой вывод и ненулевой код, как у настоящего wget -q.
cat > "$SB/bin/wget" <<'STUB'
#!/bin/sh
url=""
for a in "$@"; do case "$a" in http*) url="$a" ;; esac; done
echo "$url" >> "$SB/wget.log"
case "$url" in
    # Перечень выпусков splify2/releases — три адреса одного version.json, у каждого свой ответ:
    # проверяется и порядок, и переход к следующему адресу.
    *raw.githubusercontent.com/splify2/releases/*) f="$SB/resp-rel-raw" ;;
    *cdn.jsdelivr.net/*)       f="$SB/resp-rel-cdn" ;;
    *splify2.github.io/*)      f="$SB/resp-rel-pages" ;;
    # Файлы выпуска: сначала выпуск в splify2/releases, потом исходный выпуск проекта (его же
    # адрес собирает и прежний путь, dl_url).
    *github.com/splify2/releases/releases/download/*) f="$SB/resp-asset-rel" ;;
    *github.com/*/releases/download/*) f="$SB/resp-asset-src" ;;
    # contents API — отдельная ветка: это ТРЕТИЙ путь к версии, и смешивать его с
    # ответом про релизы значило бы проверять «api ответил» вместо «ответил чем».
    *api.github.com*contents*) f="$SB/resp-contents" ;;
    *api.github.com*)          f="$SB/resp-api" ;;
    *raw.githubusercontent*)   f="$SB/resp-raw" ;;
    *gitlab.com*)              f="$SB/resp-mirror" ;;
    *codeload.github.com*)     f="$SB/resp-codeload" ;;
    *)                         exit 1 ;;
esac
[ -f "$f" ] || exit 1
# Файл, а не поток: архив ветки уезжает в файл (-qO ФАЙЛ), и cat в stdout его бы испортил.
outf=""
prev=""
for a in "$@"; do
    [ "$prev" = "-qO" ] && outf="$a"
    prev="$a"
done
if [ -n "$outf" ] && [ "$outf" != "-" ]; then cat "$f" > "$outf"; else cat "$f"; fi
STUB
chmod +x "$SB/bin/wget"
PATH="$SB/bin:$PATH"
export SB

# Сама проверяемая функция. Вместе с ней берутся и переменные хостов: если API или RAW
# в install.sh переименуют, стенд упадёт здесь, а не молча начнёт проверять пустоту.
# Вместе с latest() достаётся и обход по хостам самого GitHub: третий путь к версии
# идёт через него, и без этих функций стенд проверял бы отказ вместо обхода.
eval "$(sed -n '/^API=/p; /^RAW=/p; /^CODELOAD=/p; /^MIRROR=/p; /^DIST_BRANCH=/p; /^info()/p; /^gl_file() {/,/^}/p; /^gh_api_file() {/,/^}/p; /^gh_tarball() {/,/^}/p; /^gh_file() {/,/^}/p; /^latest() {/,/^}/p; /^fetch() {/,/^}/p; /^dl_url() {/,/^}/p; /^pm_add() {/,/^}/p; /^PM_OURS=/p; /^pm_world_heal() {/,/^}/p' "$ROOT/install.sh")"
TMP="$SB/tmp"; mkdir -p "$TMP"
die() { printf 'die: %s\n' "$*" >&2; return 1; }
check "функция latest достана из install.sh" "latest" "$(command -v latest >/dev/null && echo latest)"

# ---- обычный путь: API отвечает -----------------------------------------------
printf '{"tag_name": "v1.2.3", "name": "x"}\n' > "$SB/resp-api"
printf '9.9.9\n' > "$SB/resp-raw"
check "версия берётся из релиза" "1.2.3" "$(latest splify2/steer 2>/dev/null)"

# ---- api.github.com недоступен ------------------------------------------------
# Ровно случай splify2#5: API молчит, github.com и raw доступны, релиз существует.
rm -f "$SB/resp-api"
# Ветка — dist, а не main: VERSION в main двигают руками между выпусками (у steer он ушёл на
# три версии вперёд последнего релиза), а dist пишет только релизный workflow — рядом с
# пакетами и тем же числом, что в теге. Версия из main вела к скачиванию файла из релиза,
# которого нет.
check "API молчит — версия берётся из VERSION ветки dist" "1.1.2" \
    "$(printf '1.1.2\n' > "$SB/resp-raw"; latest splify2/steer 2>/dev/null)"
check "переход на второй путь объявлен вслух" "1" \
    "$(latest splify2/steer 2>&1 >/dev/null | grep -c 'api.github.com не ответил')"
# Объяснение обязано идти в stderr: stdout функции — это сама версия, и строка в нём
# уехала бы в имя файла пакета.
check "объяснение не попало в stdout" "1.1.2" "$(latest splify2/steer 2>/dev/null)"
check "VERSION спрашивается у ветки dist, а не main" "1" \
    "$(: > "$SB/wget.log"; latest splify2/steer >/dev/null 2>&1; grep -c '/splify2/steer/dist/VERSION' "$SB/wget.log")"

# ---- лимит API: 403 вместо релиза ---------------------------------------------
# Тело ответа есть, tag_name в нём нет — это не «пусто», а именно ответ про лимит.
printf '{"message": "API rate limit exceeded for 203.0.113.7."}\n' > "$SB/resp-api"
check "403 про лимит не читается как версия" "1.1.2" "$(latest splify2/steer 2>/dev/null)"

# ---- оба пути молчат ----------------------------------------------------------
rm -f "$SB/resp-api" "$SB/resp-raw"
check "оба хоста молчат — версии нет" "" "$(latest splify2/steer 2>/dev/null)"

# ---- мусор в VERSION ---------------------------------------------------------
# Пустая версия честнее подставленного мусора: с ним установщик пошёл бы качать файл с
# именем, которого нет, и сказал бы «не скачалось» вместо «не узнал версию».
printf 'dev\n' > "$SB/resp-raw"
check "нечисловой VERSION версией не считается" "" "$(latest splify2/steer 2>/dev/null)"
printf ' 1.0.0-rc1\n' > "$SB/resp-raw"
check "версия с хвостом обрезается до чисел" "1.0.0" "$(latest splify2/steer 2>/dev/null)"

# ---- закрыт githubusercontent: третий путь к версии и к пакету -----------------
#
# splify2#15. `raw.` и `release-assets.` — это одни и те же адреса Fastly, поэтому у
# человека с закрытым `githubusercontent.com` отваливались РАЗОМ второй путь к версии и
# скачивание самих пакетов: splify2 нельзя было ни поставить, ни обновить. Хосты самого
# GitHub при этом работают, и оба умеют отдать файл из ветки.
rm -f "$SB/resp-api" "$SB/resp-raw" "$SB/resp-codeload" "$SB/resp-contents"
printf '2.0.0\n' > "$SB/resp-mirror"
check "версия взята с зеркала, когда молчат и релизы, и raw" "2.0.0" \
    "$(latest splify2/steer 2>/dev/null)"
check "к хостам GitHub при живом зеркале не ходили" "" \
    "$(: > "$SB/wget.log"; latest splify2/steer >/dev/null 2>&1; grep -c 'codeload\|contents' "$SB/wget.log" | sed 's/^0$//')"
rm -f "$SB/resp-mirror"

printf '2.0.1\n' > "$SB/resp-contents"
check "версия взята через contents API, когда молчат и релизы, и raw" "2.0.1" \
    "$(latest splify2/steer 2>/dev/null)"
check "третий путь объявлен вслух" "1" \
    "$(latest splify2/steer 2>&1 >/dev/null | grep -c 'contents API')"

# contents API тоже молчит (лимит 60 в час за CGNAT) — остаётся архив ветки.
rm -f "$SB/resp-contents" "$TMP"/*.tgz
mkdir -p "$SB/tar/steer-dist"
printf '2.0.2\n' > "$SB/tar/steer-dist/VERSION"
( cd "$SB/tar" && tar -czf "$SB/resp-codeload" steer-dist )
check "версия вынута из архива ветки, когда молчит и contents API" "2.0.2" \
    "$(latest splify2/steer 2>/dev/null)"

# Пакет: прямая ссылка релиза не отдаёт (перенаправление на release-assets), тот же файл
# лежит в ветке dist.
rm -f "$TMP"/*.tgz
mkdir -p "$SB/tar2/steer-dist"
printf 'PKG\n' > "$SB/tar2/steer-dist/steer-2.0.2-1_x86_64.apk"
( cd "$SB/tar2" && tar -czf "$SB/resp-codeload" steer-dist )
rm -f "$SB/resp-contents"
url="$(dl_url splify2/steer 2.0.2 steer-2.0.2-1_x86_64.apk)"
printf 'PKG-MIRROR\n' > "$SB/resp-mirror"
check "прямая ссылка релиза не отдала — пакет берётся с зеркала" "PKG-MIRROR" \
    "$(fetch "$url" "$SB/pkg2.apk" splify2/steer steer-2.0.2-1_x86_64.apk >/dev/null 2>&1; cat "$SB/pkg2.apk" 2>/dev/null)"
rm -f "$SB/resp-mirror"
check "зеркало молчит — тогда ветка dist через хосты GitHub" "PKG" \
    "$(fetch "$url" "$SB/pkg.apk" splify2/steer steer-2.0.2-1_x86_64.apk >/dev/null 2>&1; cat "$SB/pkg.apk" 2>/dev/null)"
rm -f "$SB/resp-codeload" "$TMP"/*.tgz

# ---- перечень выпусков splify2/releases: version.json раньше api.github.com ------------
#
# Решение владельца: версии и адреса файлов установщик берёт СНАЧАЛА из version.json
# репозитория splify2/releases (три адреса одного файла по порядку), а api.github.com, VERSION
# ветки dist, зеркало и хосты GitHub остаются запасным путём в прежнем порядке. Файл качается по
# urls из version.json по порядку со сверкой sha256, затем — прежней лестницей по имени файла.
eval "$(sed -n '/^REL_JSON_URLS=/p; /^TAB=/p; /^rel_flat() {/,/^}/p; /^rel_get() {/,/^}/p; /^rel_val() {/,/^}/p; /^rel_stable() {/,/^}/p; /^rel_asset() {/,/^}/p; /^sum_ok() {/,/^}/p; /^fetch_pkg() {/,/^}/p' "$ROOT/install.sh")"
check "функции перечня выпусков достаны из install.sh" "rel_get fetch_pkg" \
    "$(command -v rel_get >/dev/null && printf 'rel_get '; command -v fetch_pkg >/dev/null && printf fetch_pkg)"

relreset() { rm -f "$SB"/resp-* "$TMP"/version.* "$TMP"/*.tgz "$SB/wget.log"; : > "$SB/wget.log"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
printf 'PKG-REL\n' > "$SB/body-rel"
printf 'PKG-SRC\n' > "$SB/body-src"
printf 'PKG-BAD\n' > "$SB/body-bad"
# version.json в том виде, в каком его пишет scripts/publish.py (json.dump, indent=1): старые имена
# пакетов steer 1.5.x как есть, у каждого файла — размер, sha256 и два адреса.
mkrel() {  # ФАЙЛ [ОТСТУП]  — отступ 0 даёт version.json одной строкой
    python3 - "$1" "${2:-1}" "$(sha "$SB/body-rel")" <<'PY'
import json, sys
out, ind, s = sys.argv[1], int(sys.argv[2]), sys.argv[3]
def a(prod, tag, src, name):
    return {"name": name, "size": 8, "sha256": s,
            "urls": [f"https://github.com/splify2/releases/releases/download/{tag}/{name}",
                     f"https://github.com/{src}/releases/download/v{tag.split('-v')[-1]}/{name}"]}
def v(prod, ver, src, names, ch="stable"):
    tag = f"{prod}-v{ver}"
    return {"version": ver, "channel": ch, "date": "2026-09-25", "tag": tag,
            "source": f"https://github.com/{src}/releases/tag/v{ver}",
            "changelog": f"changelogs/{prod}/{ver}.md", "assets": [a(prod, tag, src, n) for n in names]}
doc = {"schema": 1, "updated": "2026-10-02T10:17:36Z", "products": {
  "steer": {"title": "Ядро steer", "repo": "splify2/steer", "stable": "1.5.9", "prerelease": None,
            "versions": [v("steer", "1.5.9", "splify2/steer", ["steer-1.5.9-1_x86_64.apk", "steer-extended-1.5.9-1_x86_64.apk", "steer-extended-1.5.9-1_x86_64.ipk"]),
                         v("steer", "1.5.8", "splify2/steer", ["steer-extended-1.5.8-1_x86_64.apk"])]},
  "splify2": {"title": "splify2", "repo": "splify2/splify2", "stable": "26.9.2", "prerelease": None,
              "versions": [v("splify2", "26.9.2", "splify2/splify2", ["splify2-26.9.2-1_noarch.apk"])]}}}
with open(out, "w") as f:
    json.dump(doc, f, ensure_ascii=False, indent=ind if ind else None)
    f.write("\n")
PY
}

# ---- версия: version.json первым, и спрошен он первым ----------------------------------
relreset
mkrel "$SB/resp-rel-raw"
printf '{"tag_name": "v1.2.3", "name": "x"}\n' > "$SB/resp-api"
check "версия ядра берётся из version.json, а не из api.github.com" "1.5.9" "$(latest splify2/steer 2>/dev/null)"
check "версия интерфейса — оттуда же" "26.9.2" "$(latest splify2/splify2 2>/dev/null)"
check "первым спрошен version.json на raw.githubusercontent.com" \
    "https://raw.githubusercontent.com/splify2/releases/main/version.json" "$(head -1 "$SB/wget.log")"
check "к api.github.com при живом version.json не ходили" "0" "$(grep -c 'api.github.com' "$SB/wget.log")"
check "version.json скачан один раз на оба продукта" "1" "$(grep -c 'version.json' "$SB/wget.log")"

# Тот же файл одной строкой (без отступов) — разбор не зависит от того, как его отформатировали.
relreset
mkrel "$SB/resp-rel-raw" 0
check "version.json одной строкой читается так же" "1.5.9" "$(latest splify2/steer 2>/dev/null)"

# На роутере awk — из busybox, на машине стенда — gawk или mawk, и регулярные выражения у них
# расходятся (`\]` внутри скобок gawk понимает как знак, POSIX — нет: значение `null,` уходило с
# запятой, и схема не узнавалась). Разбор сверяется со всеми, какие есть.
mkrel "$SB/rel.json"
python3 - "$SB/rel.json" > "$SB/flat.want" <<'PY'
import json, sys
def walk(v, p):
    if isinstance(v, dict):
        for k, x in v.items(): yield from walk(x, p + [k])
    elif isinstance(v, list):
        for i, x in enumerate(v): yield from walk(x, p + [str(i)])
    else:
        yield "/".join(p) + "\t" + ("null" if v is None else str(v).lower() if isinstance(v, bool) else str(v))
print("\n".join(walk(json.load(open(sys.argv[1])), [])))
PY
for awkbin in gawk mawk "busybox awk"; do
    set -- $awkbin
    command -v "$1" >/dev/null 2>&1 || continue
    [ "$1" != busybox ] || busybox awk 'BEGIN{}' 2>/dev/null || continue
    mkdir -p "$SB/awk-$1"
    printf '#!/bin/sh\nexec %s "$@"\n' "$awkbin" > "$SB/awk-$1/awk"; chmod +x "$SB/awk-$1/awk"
    check "разбор version.json под $awkbin совпадает с python" "" \
        "$(PATH="$SB/awk-$1:$PATH" rel_flat "$SB/rel.json" | diff - "$SB/flat.want" | head -3)"
done

# ---- адреса version.json по порядку ----------------------------------------------------
relreset
mkrel "$SB/resp-rel-cdn"
check "raw молчит — version.json с cdn.jsdelivr.net" "1.5.9" "$(latest splify2/steer 2>/dev/null)"
check "адрес jsDelivr — второй по порядку" \
    "https://cdn.jsdelivr.net/gh/splify2/releases@main/version.json" "$(sed -n 2p "$SB/wget.log")"
relreset
mkrel "$SB/resp-rel-pages"
check "молчат raw и jsDelivr — version.json с splify2.github.io" "1.5.9" "$(latest splify2/steer 2>/dev/null)"
check "адрес сайта — третий по порядку" \
    "https://splify2.github.io/releases/version.json" "$(sed -n 3p "$SB/wget.log")"

# ---- откат на прежний путь -------------------------------------------------------------
relreset
printf '{"tag_name": "v1.2.3", "name": "x"}\n' > "$SB/resp-api"
check "version.json не отдался ни с одного адреса — версия из api.github.com" "1.2.3" \
    "$(latest splify2/steer 2>/dev/null)"
check "откат объявлен вслух" "1" \
    "$(rm -f "$TMP"/version.*; latest splify2/steer 2>&1 >/dev/null | grep -c 'перечень выпусков')"
relreset
printf '<html>не json</html>\n' > "$SB/resp-rel-raw"
printf '{"schema": 2, "products": {"steer": {"stable": "9.9.9"}}}\n' > "$SB/resp-rel-cdn"
printf '{"tag_name": "v1.2.3", "name": "x"}\n' > "$SB/resp-api"
check "битый version.json и чужая схема — версия из api.github.com" "1.2.3" \
    "$(latest splify2/steer 2>/dev/null)"
relreset
printf '1.1.2\n' > "$SB/resp-raw"
check "молчат и version.json, и api.github.com — VERSION ветки dist, как раньше" "1.1.2" \
    "$(latest splify2/steer 2>/dev/null)"

# ---- пакет: адреса из version.json по порядку, сверка sha256 ----------------------------
NAME=steer-extended-1.5.9-1_x86_64.apk
relreset
mkrel "$SB/resp-rel-raw"
cp "$SB/body-rel" "$SB/resp-asset-rel"; cp "$SB/body-src" "$SB/resp-asset-src"
check "пакет качается с первого адреса version.json — выпуска в splify2/releases" "PKG-REL" \
    "$(fetch_pkg steer 1.5.9 "$NAME" "$SB/p.apk" splify2/steer >/dev/null 2>&1; cat "$SB/p.apk" 2>/dev/null)"
check "адрес пакета — из version.json" \
    "https://github.com/splify2/releases/releases/download/steer-v1.5.9/$NAME" \
    "$(grep 'releases/download' "$SB/wget.log" | head -1)"

relreset
mkrel "$SB/resp-rel-raw"
cp "$SB/body-bad" "$SB/resp-asset-rel"; cp "$SB/body-rel" "$SB/resp-asset-src"
check "sha256 не сошёлся — следующий адрес из version.json" "PKG-REL" \
    "$(fetch_pkg steer 1.5.9 "$NAME" "$SB/p.apk" splify2/steer >/dev/null 2>&1; cat "$SB/p.apk" 2>/dev/null)"
check "несовпадение сказано вслух" "1" \
    "$(rm -f "$SB/p.apk"; fetch_pkg steer 1.5.9 "$NAME" "$SB/p.apk" splify2/steer 2>&1 | grep -c 'контрольная сумма')"

relreset
mkrel "$SB/resp-rel-raw"
printf 'PKG-REL\n' > "$SB/resp-mirror"
check "оба адреса version.json молчат — прежний путь по имени файла (ветка dist)" "PKG-REL" \
    "$(fetch_pkg steer 1.5.9 "$NAME" "$SB/p.apk" splify2/steer >/dev/null 2>&1; cat "$SB/p.apk" 2>/dev/null)"
check "прямой адрес выпуска второй раз не спрашивается — он уже был в version.json" "1" \
    "$(grep -c "github.com/splify2/steer/releases/download/v1.5.9/$NAME" "$SB/wget.log")"

relreset
mkrel "$SB/resp-rel-raw"
cp "$SB/body-bad" "$SB/resp-asset-rel"; cp "$SB/body-bad" "$SB/resp-asset-src"; cp "$SB/body-bad" "$SB/resp-mirror"
check "sha256 не сошёлся нигде — отказ, файла нет" "отказ;нет" \
    "$(fetch_pkg steer 1.5.9 "$NAME" "$SB/p.apk" splify2/steer >/dev/null 2>&1 && printf 'ok' || printf 'отказ'; [ -e "$SB/p.apk" ] && printf ';есть' || printf ';нет')"

# Версии в version.json нет (старый выпуск, ушедший из перечня) — прежний путь целиком.
relreset
mkrel "$SB/resp-rel-raw"
cp "$SB/body-src" "$SB/resp-asset-src"
check "версии нет в version.json — прямой адрес выпуска проекта, как раньше" "PKG-SRC" \
    "$(fetch_pkg steer 1.5.1 steer-extended-1.5.1-1_x86_64.apk "$SB/p.apk" splify2/steer >/dev/null 2>&1; cat "$SB/p.apk" 2>/dev/null)"

# version.json недоступен — пакет прежним путём, без сверки (сверять не с чем).
relreset
cp "$SB/body-src" "$SB/resp-asset-src"
check "version.json молчит — пакет прежним путём" "PKG-SRC" \
    "$(fetch_pkg steer 1.5.9 "$NAME" "$SB/p.apk" splify2/steer >/dev/null 2>&1; cat "$SB/p.apk" 2>/dev/null)"

# Без sha256sum на роутере сверка пропускается, а не роняет установку.
relreset
mkrel "$SB/resp-rel-raw"
cp "$SB/body-bad" "$SB/resp-asset-rel"
# PATH без sha256sum: заглушки стенда плюс ровно те команды, которыми пользуется установщик.
mkdir -p "$SB/nosha"
for c in awk sed grep rm cat tr head cut tar mkdir sh; do ln -sf "$(command -v "$c")" "$SB/nosha/$c"; done
check "без sha256sum файл берётся с первого адреса без сверки" "PKG-BAD" \
    "$(PATH="$SB/bin:$SB/nosha"; fetch_pkg steer 1.5.9 "$NAME" "$SB/p.apk" splify2/steer >/dev/null 2>&1; cat "$SB/p.apk" 2>/dev/null)"
relreset

# ---- отказ называет оба хоста -------------------------------------------------
# Сообщение «нет релизов?» отправляло человека искать релиз, которого не было только у
# него в сети. Проверяется, что в отказе названы оба источника и ручной путь.
for what in ядра интерфейса; do
    check "отказ по версии $what называет все источники" "1" \
        "$(grep -c "не удалось узнать версию $what: не ответили ни перечень выпусков splify2/releases, ни api.github.com, ни raw.githubusercontent.com, ни зеркало на gitlab.com" "$ROOT/install.sh")"
done
check "установщик ставит пакеты через fetch_pkg — с адресами из version.json" "2" \
    "$(grep -c '^ *fetch_pkg ' "$ROOT/install.sh")"
check "отказы ведут на страницу релизов (версии ядра и интерфейса, ядро старше 2.1, переход по opkg, ядро не обновилось)" "5" \
    "$(grep -c 'руками с https://github.com/\$REPO_[A-Z]*/releases' "$ROOT/install.sh")"

# ---- обнаружение splify первой версии (R-018) ----------------------------------
#
# Зачем стенд именно здесь. Обнаружение по НЕВЕРНОМУ признаку хуже отсутствия
# обнаружения: оно пугает человека, у которого ничего лишнего не стоит, и первым делом
# оно рискует опознать как «первую версию» наши же пакеты — имена у них однокоренные
# (`luci-app-splify2` против `luci-app-splify`). Поэтому главная проверка здесь — не
# «нашёл», а «на чистом роутере со splify2 не нашёл ничего».
#
# Как проверяется. Функции обнаружения достаются из install.sh тем же приёмом, что и
# latest() выше. Файловые признаки ищутся не в настоящем `/`, а в песочнице: в
# install.sh для этого есть шов V1ROOT, пустой на роутере. Пакеты, команды и nft
# подменяются заглушками в PATH.
V1BOX="$SB/root"
mkdir -p "$V1BOX/etc/init.d" "$V1BOX/usr/share/nftables.d/ruleset-post"
V1ROOT="$V1BOX"
PM=apk

# apk: список установленного берётся из файла, чтобы каждый случай задавал свой.
cat > "$SB/bin/apk" <<'STUB'
#!/bin/sh
[ -f "$SB/pkglist" ] && cat "$SB/pkglist"
exit 0
STUB
# nft: успех только для того набора, который назван в файле. Так проверяется, что
# смотрят именно на набор первой версии, а не на факт наличия nft.
cat > "$SB/bin/nft" <<'STUB'
#!/bin/sh
want="$(cat "$SB/nftset" 2>/dev/null)"
[ -n "$want" ] || exit 1
for a in "$@"; do [ "$a" = "$want" ] && exit 0; done
exit 1
STUB
chmod +x "$SB/bin/apk" "$SB/bin/nft"

eval "$(sed -n '/^V1ROOT=/p; /^V1_SIGNS=/p; /^v1_add() {/,/^}/p; /^v1_scan() {/,/^}/p; /^pm_installed() {/,/^}/p' "$ROOT/install.sh")"
check "функция v1_scan достана из install.sh" "v1_scan" "$(command -v v1_scan >/dev/null && echo v1_scan)"
check "песочница подставилась вместо корня" "$V1BOX" "$V1ROOT"

scan() { V1_SIGNS=""; v1_scan; printf '%s' "$V1_SIGNS"; }

# ---- чистый роутер со splify2: ни одного признака ------------------------------
# Ровно тот случай, в котором ложное срабатывание было бы виднее всего: наши пакеты
# однокоренные с пакетами первой версии, и наивный `grep splify` опознал бы их.
printf '%s\n' 'luci-app-splify2-1.1.1-r1 noarch {luci-app-splify2} (GPL-2.0)' \
               'steer-extended-1.1.2-r1 aarch64_cortex-a53 {steer-extended} (GPL-2.0)' \
               'nftables-1.0.9-r2 aarch64_cortex-a53 {nftables} (GPL-2.0)' > "$SB/pkglist"
check "свои пакеты за первую версию не принимаются" "" "$(scan)"

# ---- пакет первой версии -------------------------------------------------------
# Имя пакета v1 нигде не записано, поэтому шаблон описывает родство, а не имя: любой
# установленный пакет со splify в имени, кроме наших. Проверяются оба вероятных вида.
printf '%s\n' 'luci-app-splify2-1.1.1-r1 noarch {luci-app-splify2} (GPL-2.0)' \
               'luci-app-splify-1.0.3-r1 all {luci-app-splify} (GPL-2.0)' > "$SB/pkglist"
check "пакет luci-app-splify опознан" "  - пакет luci-app-splify" "$(scan)"
printf '%s\n' 'splify-1.0.3-r1 aarch64_cortex-a53 {splify} (GPL-2.0)' > "$SB/pkglist"
check "пакет splify опознан" "  - пакет splify" "$(scan)"

printf '%s\n' 'luci-app-splify2-1.1.1-r1 noarch {luci-app-splify2} (GPL-2.0)' > "$SB/pkglist"

# ---- службы (i18n.ts:430,463) --------------------------------------------------
: > "$V1BOX/etc/init.d/splify"
check "служба /etc/init.d/splify опознана" "  - служба /etc/init.d/splify" "$(scan)"
: > "$V1BOX/etc/init.d/splify-agent"
check "агент удалённого управления опознан отдельной строкой" "2" "$(scan | grep -c 'служба')"
rm -f "$V1BOX/etc/init.d/splify" "$V1BOX/etc/init.d/splify-agent"

# ---- команды (i18n.ts:287-479) -------------------------------------------------
printf '#!/bin/sh\n' > "$SB/bin/splify-apply"; chmod +x "$SB/bin/splify-apply"
check "команда splify-apply опознана" "  - команда splify-apply" "$(scan)"
rm -f "$SB/bin/splify-apply"

# ---- наборы nft в общей таблице fw4 (steer/src/dnsd.c:3,773,2028) --------------
printf 'splify_vpn_v4\n' > "$SB/nftset"
check "набор splify_vpn_v4 в inet fw4 опознан" "  - набор nft inet fw4 splify_vpn_v4" "$(scan)"
# Наличие самого nft признаком не является: иначе сработало бы на любом OpenWrt.
printf 'steer_direct_v4\n' > "$SB/nftset"
check "чужой набор в fw4 признаком не считается" "" "$(scan)"
rm -f "$SB/nftset"

# ---- файл правил 30-splify.nft (i18n.ts:477) ----------------------------------
# Имя файла известно точно, каталог — по соглашению OpenWrt, поэтому маска, а не путь.
: > "$V1BOX/usr/share/nftables.d/ruleset-post/30-splify.nft"
check "файл правил 30-splify.nft опознан" "1" "$(scan | grep -c '30-splify.nft')"
rm -f "$V1BOX/usr/share/nftables.d/ruleset-post/30-splify.nft"

# ---- несколько признаков разом -------------------------------------------------
: > "$V1BOX/etc/init.d/splify"
printf 'splify_fakeip_map\n' > "$SB/nftset"
printf '%s\n' 'splify-1.0.3-r1 aarch64_cortex-a53 {splify} (GPL-2.0)' > "$SB/pkglist"
check "перечисляется всё найденное, а не первое" "3" "$(scan | grep -c '  - ')"
rm -f "$V1BOX/etc/init.d/splify" "$SB/nftset"

# ---- что установщик делает с находкой ------------------------------------------
# Главное ограничение из roadmap (R-018, риск): автоматическое удаление чужой
# настройки недопустимо. Проверяется буквально — в установщике нет ни одной команды
# удаления пакета или файлов.
# Единственное, что установщик снимает, — прежние пакеты СВОЕГО ядра при переходе на steer-core
# (pm_drop_old у opkg, pm_forget_old — уборка world у apk), и только по своим именам.
check "установщик ничего не удаляет (кроме прежнего своего ядра)" "0" \
    "$(sed '/^pm_drop_old() {/,/^}/d; /^pm_forget_old() {/,/^}/d; /^pm_drop_old_ui() {/,/^}/d' "$ROOT/install.sh" | grep -c 'apk del\|opkg remove\|rm -rf /etc\|uci -q delete')"
check "снимаются только имена прежнего ядра (1.x и модули 2.0)" "2" \
    "$(sed -n '/^pm_drop_old() {/,/^}/p; /^pm_forget_old() {/,/^}/p' "$ROOT/install.sh" | grep -c 'case "\$_d" in steer|steer-extended|libsteer|libsteer-wolfssl[|)]')"
check "  и ничего чужого: у opkg — только наши имена" "steer steer-extended libsteer libsteer-wolfssl steer-vless steer-hysteria2 steer-proxy steer-xsteer steer-obfs steer-warpbox steer-tgws" \
    "$(sed -n '/^pm_drop_old() {/,/^}/p' "$ROOT/install.sh" | sed -n 's/.*case "\$_d" in \([^)]*\)).*/\1/p' | tr '|' ' ')"

# Ловушки set -e. Чтение отсутствующего ключа uci — не ошибка установки, а `_rt="$(uci -q get …)"`
# под set -e завершал скрипт молча ПОСЛЕ установки пакетов: без рестарта rpcd, пустой спеки и
# «Готово». И ловушка INT/TERM обязана завершать скрипт, а не только убирать временный каталог.
check "install.sh: чтение срока rpcd не роняет set -e" "1" \
    "$(grep -c 'uci -q get rpcd.@rpcd\[0\].timeout[^)]*|| true' "$ROOT/install.sh")"
check "install.sh: ловушка TERM завершает скрипт" "1" \
    "$(grep -c "trap '[^']*exit [0-9]*' INT TERM" "$ROOT/install.sh")"
check "сказано, что удаление и перенос — не его дело" "1" \
    "$(grep -c 'ничего из первой версии не удаляет и не переносит' "$ROOT/install.sh")"
# Обе ветки обязаны существовать: с терминалом человек решает сам, без терминала
# (`sh -c "$(wget -qO- ...)"` из скрипта) спрашивать некого, и упереться в вопрос там
# значило бы не установиться вовсе.
check "с терминалом спрашивают разрешение продолжить" "1" \
    "$(grep -c 'Продолжить установку splify2?' "$ROOT/install.sh")"
check "без терминала установка не упирается в вопрос" "1" \
    "$(grep -c 'Запуск без терминала — спросить некого' "$ROOT/install.sh")"
# Предупреждение повторяется в финале: без терминала первое уезжает за экран, и
# «Готово.» читается как «всё чисто».
check "в финале напоминают о первой версии" "1" \
    "$(grep -c 'Первая версия splify осталась на роутере' "$ROOT/install.sh")"

# Документация — второе место, куда приходит человек с первой версией, и там же названы
# признаки: без них совет «выключите первую версию» не выполним. С 26.10 подробности установки
# живут в docs/guide.md, а README — короткая витрина со ссылкой на него.
check "docs/guide.md объясняет, что делать с первой версией" "да" \
    "$(grep -qF 'Если на роутере стоит splify первой версии' "$ROOT/docs/guide.md" && echo да || echo нет)"
check "README ведёт на docs/guide.md" "да" \
    "$(grep -qF 'docs/guide.md' "$ROOT/README.md" && echo да || echo нет)"

# ---- ядро 2.1: один пакет steer-core, протоколы — плагины -------------------------------
# Пакетов модулей больше нет: ядро — steer-core, протоколы — плагины из его семени. Установщик спрашивает
# плагины только при первой установке ядра (умолчание — vless, hysteria2, proxy); при переходе с 2.0 состав
# решает `steer plugin migrate` по спеке и стоявшим пакетам, а сам установщик доводит лишь мост Telegram
# (его нет в семени ядра — migrate его пропускает).
eval "$(sed -n '/^R=/p; /^REPO_STEER=/p; /^pm_names() {/,/^}/p; /^pm_has() {/,/^}/p; /^pm_ver() {/,/^}/p; /^STEER_PLUGINS=/p; /^STEER_DEFAULT_PLUGINS=/p; /^STEER_MOD_PKGS=/p; /^steer_plugins() {/,/^}/p; /^ver_ok() {/,/^}/p; /^ver_ge() {/,/^}/p; /^steer_version() {/,/^}/p; /^BOX_INITD=/p; /^box_busy() {/,/^}/p' "$ROOT/install.sh")"
check "функция steer_plugins достана из install.sh" "steer_plugins" "$(command -v steer_plugins >/dev/null && echo steer_plugins)"
check "умолчание к первой установке — vless hysteria2 proxy" "vless hysteria2 proxy" "$STEER_DEFAULT_PLUGINS"
: > "$SB/pkglist"
check "чистый роутер: выбор человека как есть, по порядку" "vless proxy tgws" "$(steer_plugins 'tgws proxy vless')"
printf '%s\n' 'steer-core-2.0.5-r1 x86_64 {steer-core}' 'steer-tgws-2.0.5-r1 x86_64 {steer-tgws}' 'steer-vless-2.0.5-r1 x86_64 {steer-vless}' > "$SB/pkglist"
check "стоял пакет steer-tgws — мост доводится установщиком, остальное — migrate" "tgws" "$(steer_plugins '')"
check "версия пакета без ревизии" "2.0.5" "$(pm_ver steer-core)"
printf '%s\n' 'steer-1.5.9-r1 x86_64 {steer} (GPL-2.0)' > "$SB/pkglist"
check "steer 1.5.9: steer-core не считается стоящим (имя steer не путается)" "нет;" "$(pm_has steer-core && echo да || echo нет);$(pm_ver steer-core)"
: > "$SB/pkglist"
check "каждый протокол бэкенда (STEER_MODULES) — среди плагинов установщика" "" \
    "$(for m in $(sed -n 's/^STEER_MODULES="\(.*\)"/\1/p' "$ROOT/files/usr/lib/splify2/rpcd/pkg-lib.sh"); do case " $STEER_PLUGINS " in *" $m "*) ;; *) printf '%s ' "$m" ;; esac; done)"
check "ver_ge: 2.1.0 ≥ 2.1.0, 2.1.1 ≥ 2.1.0, 2.0.5 < 2.1.0" "да;да;нет" \
    "$(ver_ge 2.1.0 2.1.0 && echo да || echo нет);$(ver_ge 2.1.1 2.1.0 && echo да || echo нет);$(ver_ge 2.0.5 2.1.0 && echo да || echo нет)"

# Версия ядра: стабильная 1.5.9 этому интерфейсу не годится (он пишет спеку v2) — тогда
# предварительная из перечня, если она 2.1 или новее.
relreset
mkrel "$SB/resp-rel-raw"
sed -i 's/"prerelease": null/"prerelease": "2.1.0"/' "$SB/resp-rel-raw"
check "стабильная младше 2.1 — берётся предварительная 2.1.0" "2.1.0" "$(steer_version 2>/dev/null | tail -1)"
relreset
mkrel "$SB/resp-rel-raw"
check "предварительной нет — версия как есть (установщик откажет словами)" "1.5.9" "$(steer_version 2>/dev/null | tail -1)"
check "отказ на ядре старше 2.1 назван" "1" "$(grep -c 'этому интерфейсу нужно ядро 2.1 или новее' "$ROOT/install.sh")"
relreset

check "файлов пакетов модулей (steer-<модуль>-<версия>) установщик больше не качает" "0" \
    "$(grep -c 'steer-%s \|steer-\$_m-\|for _p in steer-core ' "$ROOT/install.sh")"
check "прежних пакетов steer-extended/steer больше не ставит" "0" \
    "$(grep -c 'steer-extended-\${SV}\|\"steer-\${SV}' "$ROOT/install.sh")"

# Спека — v2, как в uci-defaults: ядро 2.0 прежнюю схему не читает.
check "пустая спека — v2 (до ядра при первой установке и в конце)" "2" "$(grep -c "printf '{\"version\":2,\"outputs\":{\"direct\":{\"kind\":\"direct\"}}}" "$ROOT/install.sh")"
check "спеки v1 установщик не пишет" "0" "$(grep -c '"schema":1' "$ROOT/install.sh")"

# Коннектор steer-box-connector: ядро — его, установщик ядро не ставит и службу steer не включает.
mkdir -p "$SB/box"; BOX_INITD="$SB/box/sing-box"
printf '# sing-box от steer-box-connector\n' > "$BOX_INITD"
check "коннектор узнаётся по его службе sing-box" "да" "$(box_busy && echo да || echo нет)"
printf '# sing-box\n' > "$BOX_INITD"
check "чужой sing-box коннектором не считается" "нет" "$(box_busy && echo да || echo нет)"
check "при коннекторе служба steer не включается" "1" "$(grep -c 'init.d/steer" \] && ! box_busy' "$ROOT/install.sh")"
unset BOX_INITD

# ---- установка файла пакета: пустые списки/индексы не валят установку ------------------
# У 26.9 две зависимости (https-dns-proxy, ip-full), у 1.2.5 не было ни одной, поэтому
# ветка отказа по зависимости раньше не встречалась вовсе. opkg держит списки в /var, apk —
# индексы в /var/cache/apk; обе — tmpfs, и после перезагрузки установка локального файла с
# зависимостями падает у обоих (apk — «unable to select packages», проверено на роутере).
# Заглушки отказывают, пока `update` не оставит след, и протоколируют каждый вызов.
for pm in apk opkg; do
cat > "$SB/bin/$pm" <<STUB
#!/bin/sh
echo "\$1" >> "$SB/$pm.log"
case "\$1" in
    update) : > "$SB/$pm.index"; exit 0 ;;
    add|install)
        [ -f "$SB/$pm.index" ] && exit 0
        [ "$pm" = apk ] && echo "ERROR: unable to select packages:" >&2 \\
                        || echo " * pkg_hash_check_unresolved: cannot find dependency ip-full for steer" >&2
        exit 1 ;;
esac
exit 0
STUB
chmod +x "$SB/bin/$pm"
done
check "функция pm_add достана из install.sh" "pm_add" "$(command -v pm_add >/dev/null && echo pm_add)"
for pm in apk opkg; do
    rm -f "$SB/$pm.index" "$SB/$pm.log"
    PM=$pm pm_add "$SB/pkg.file" >/dev/null 2>&1
    check "$pm: отказ по зависимости → обновление списков → повтор, установка удалась" "0" "$?"
    check "$pm: списки обновлены один раз" "1" "$(grep -c '^update$' "$SB/$pm.log")"
    check "$pm: установка вызвана дважды" "2" "$(grep -cE '^(add|install)$' "$SB/$pm.log")"
    # info() установщика печатает в stdout — это его голос для человека, а не диагностика.
    check "$pm: переход объявлен вслух" "1" \
        "$(rm -f "$SB/$pm.index"; PM=$pm pm_add "$SB/pkg.file" 2>/dev/null | grep -c 'обновляю')"
done

# ---- закрепления в /etc/apk/world после оборванной установки -----------------------------
# `apk add ФАЙЛ` пишет в world «имя><хеш файла»; оборванная транзакция (кончилось место) оставляет
# хеши новых файлов при прежних пакетах в базе — и дальше любая команда apk отвечает «unable to
# select packages: breaks: world[steer-core><Q1…]» (воспроизведено на apk 3.0.5). Установщик
# чинит файл до своей команды и после неё, при любом исходе.
export APK_WORLD="$SB/apk.world" APK_DB="$SB/apk.db"
printf '%s\n' 'steer-core><QnEWcoreNEWcoreNEWcoreNEWcor=' 'steer-vless><QnEWvlessNEWvlessNEWvlessNEW=' \
    'zapret><QgoodZapretGoodZapretGoodZapretG=' '!libsteer' '!steer-extended' '!kmod-foo' > "$APK_WORLD.seed"
printf '%s\n' 'C:QoLdcoreOLDcoreOLDcoreOLDcoreO=' 'P:steer-core' 'V:2.0.3-r1' '' \
    'C:QgoodZapretGoodZapretGoodZapretG=' 'P:zapret' 'V:72-r1' '' > "$APK_DB"
cat > "$SB/bin/apk" <<STUB
#!/bin/sh
[ "\$1" = add ] && exit "\${APK_ADD_RC:-0}"
exit 0
STUB
chmod +x "$SB/bin/apk"
cp "$APK_WORLD.seed" "$APK_WORLD"
APK_ADD_RC=1 PM=apk pm_add "$SB/pkg.file" >/dev/null 2>&1
check "обрыв: закрепление стоящего ядра стало «именем»" "steer-core" "$(grep '^steer-core' "$APK_WORLD")"
check "обрыв: закрепление за пакетом, которого в базе нет, убрано" "0" "$(grep -c '^steer-vless' "$APK_WORLD")"
check "обрыв: чужое закрепление с верным хешом и чужой запрет целы, запреты наших имён сняты" \
    "zapret><QgoodZapretGoodZapretGoodZapretG= !kmod-foo" \
    "$(grep -e '^zapret' -e '^!' "$APK_WORLD" | tr '\n' ' ' | sed 's/ $//')"
cp "$APK_WORLD.seed" "$APK_WORLD"
APK_ADD_RC=0 PM=apk pm_add "$SB/pkg.file" >/dev/null 2>&1
check "успех: закрепление нашего пакета стало «именем» (пакет стоит)" "steer-core" "$(grep '^steer-core' "$APK_WORLD")"
# Запрет без единого закрепления (так оставляет world чужой менеджер, «удаливший Steer»): «breaks: world[!steer-extended]»
# на установке steer-core 2.1 — он provides steer-extended. Снимается и тогда, когда «><» в world нет вовсе.
printf '%s\n' 'zapret' '!steer-extended' '!steer' '!libsteer' '!libsteer-wolfssl' > "$APK_WORLD"
APK_ADD_RC=0 PM=apk pm_add "$SB/pkg.file" >/dev/null 2>&1
check "запреты наших имён без закреплений сняты, чужое имя цело" "zapret" "$(tr '\n' ' ' < "$APK_WORLD" | sed 's/ $//')"
cp "$APK_WORLD.seed" "$APK_WORLD"; rm -f "$APK_DB.none"
check "opkg: файла world нет — лечение молча ничего не делает" "0" \
    "$(rm -f "$SB/none.world"; APK_WORLD="$SB/none.world" PM=opkg pm_world_heal; echo $?)"
unset APK_WORLD APK_DB

# ---- установщик целиком: каждое начальное состояние, apk и opkg ----------------------------
#
# Зачем целиком. Переход на 2.1 — это порядок шагов (спека до ядра, ядро до панели, плагины после панели) и то, что
# менеджер пакетов делает между ними (steer-core 2.1 снимает пакеты модулей, его postinst зовёт migrate). Проверки
# функций по отдельности этого не видят. Песочница: корень INSTALL_ROOT, заглушки apk/opkg с базой пакетов, которые
# повторяют то, что о них известно со стенда (provides/replaces ядра 2.1, закрепления в world, отказ «breaks» на
# закреплении модуля), заглушки steer, splify2-host, splify2-seed, uci, init-скриптов и wget, отдающий version.json и
# файлы пакетов по имени. Настоящих apk и opkg здесь нет — их проверяет стенд QEMU (apk) и только он.
W="$SB/whole"
# Заглушки менеджеров из проверок выше — прочь из PATH: установщик выбирает менеджер по тому, какой нашёлся.
rm -f "$SB/bin/apk" "$SB/bin/opkg"
mkdir -p "$W/bin-apk" "$W/bin-opkg" "$W/bin" "$W/assets"
for f in steer-core-2.1.0-1_x86_64.apk steer-core-2.1.1-1_x86_64.apk splify2-26.11.0-1_noarch.apk steer-core-2.1.0-1_x86_64.ipk \
         steer-core-2.1.1-1_x86_64.ipk splify2-26.11.0-1_all.ipk; do
    printf 'PKG %s\n' "$f" > "$W/assets/$f"
done
mkwrel() {  # СТАБИЛЬНАЯ_STEER
    python3 - "$W/version.json" "$1" "$W/assets" <<'PY'
import hashlib, json, os, sys
out, stable, adir = sys.argv[1:4]
def asset(name):
    b = open(os.path.join(adir, name), "rb").read()
    return {"name": name, "size": len(b), "sha256": hashlib.sha256(b).hexdigest(),
            "urls": [f"https://github.com/splify2/releases/releases/download/x/{name}"]}
def ver(v, names):
    return {"version": v, "channel": "stable", "assets": [asset(n) for n in names if os.path.exists(os.path.join(adir, n))]}
core = lambda v: [f"steer-core-{v}-1_x86_64.apk", f"steer-core-{v}-1_x86_64.ipk"]
doc = {"schema": 1, "products": {
    "steer": {"stable": stable, "prerelease": None, "versions": [ver(v, core(v)) for v in ("2.1.1", "2.1.0") if v <= stable]},
    "splify2": {"stable": "26.11.0", "prerelease": None,
                "versions": [ver("26.11.0", ["splify2-26.11.0-1_noarch.apk", "splify2-26.11.0-1_all.ipk"])]}}}
json.dump(doc, open(out, "w"), indent=1)
PY
}
cat > "$W/bin/wget" <<'STUB'
#!/bin/sh
url=""; outf=""; prev=""
for a in "$@"; do case "$a" in http*) url="$a" ;; esac; [ "$prev" = "-qO" ] && outf="$a"; prev="$a"; done
echo "$url" >> "$W/wget.log"
case "$url" in
    *splify2/releases/main/version.json) f="$W/version.json" ;;
    *github.com/splify2/releases/releases/download/*) f="$W/assets/${url##*/}" ;;
    *) exit 1 ;;
esac
[ -f "$f" ] || exit 1
if [ -n "$outf" ] && [ "$outf" != "-" ]; then cat "$f" > "$outf"; else cat "$f"; fi
STUB
cat > "$W/bin/uci" <<'STUB'
#!/bin/sh
echo "uci $*" >> "$W/uci.log"
case "$*" in *" get "*) exit 1 ;; esac
exit 0
STUB
# База пакетов: $INSTALL_ROOT/pkgs, строки «имя версия». apk видит её как `apk list -I` и как /lib/apk/db/installed
# (C:/P:/V:), opkg — как `opkg list-installed`. Скрипты пакетов — файлы hook-<имя> песочницы.
cat > "$W/bin/pkgdb" <<'STUB'
#!/bin/sh
# pkgdb add ИМЯ ВЕРСИЯ | del ИМЯ | has ИМЯ — и перестройка базы apk
DB="$INSTALL_ROOT/pkgs"; touch "$DB"
case "$1" in
    add) sed -i "/^$2 /d" "$DB"; echo "$2 $3" >> "$DB" ;;
    del) sed -i "/^$2 /d" "$DB" ;;
    has) grep -q "^$2 " "$DB"; exit $? ;;
esac
mkdir -p "$INSTALL_ROOT/lib/apk/db"
while read -r n v; do printf 'C:Q1%s=\nP:%s\nV:%s-r1\n\n' "$n" "$n" "$v"; done < "$DB" > "$INSTALL_ROOT/lib/apk/db/installed"
STUB
# Что делает пакет при установке (postinst): ядро 2.1 снимает прежние пакеты (provides/replaces у apk, Conflicts и
# Replaces у opkg), кладёт steer и зовёт migrate; панель кладёт свои команды.
cat > "$W/bin/pkghook" <<'STUB'
#!/bin/sh
# pkghook ИМЯ ВЕРСИЯ
R="$INSTALL_ROOT"
case "$1" in
    steer-core)
        case "$2" in 2.0*) exit 0 ;; esac
        for o in steer libsteer libsteer-wolfssl steer-vless steer-hysteria2 steer-proxy steer-xsteer steer-obfs steer-warpbox steer-tgws steer-extended; do
            pkgdb has "$o" && { pkgdb del "$o"; echo "purge $o" >> "$W/pm.log"; }
        done
        mkdir -p "$R/usr/sbin" "$R/etc/init.d"
        cp "$W/bin/steer.stub" "$R/usr/sbin/steer"; chmod +x "$R/usr/sbin/steer"
        printf '#!/bin/sh\necho "steer-init $*" >> "$W/svc.log"\n' > "$R/etc/init.d/steer"; chmod +x "$R/etc/init.d/steer"
        # спека к моменту postinst ядра (порядок «пустая спека до ядра»)
        if [ -s "$R/etc/steer/spec.json" ] || [ -s "$R/etc/steer/spec.yaml" ]; then echo "spec-at-core yes" >> "$W/pm.log"; else echo "spec-at-core no" >> "$W/pm.log"; fi
        "$R/usr/sbin/steer" plugin migrate >/dev/null 2>&1 ;;
    splify2)
        mkdir -p "$R/usr/sbin"
        printf '#!/bin/sh\necho "host $*" >> "$W/host.log"\necho "{\\"ok\\":true}"\n' > "$R/usr/sbin/splify2-host"
        printf '#!/bin/sh\necho "seed $*" >> "$W/seed.log"\necho "installed andromeda 26.11.0"\n' > "$R/usr/sbin/splify2-seed"
        chmod +x "$R/usr/sbin/splify2-host" "$R/usr/sbin/splify2-seed" ;;
esac
exit 0
STUB
cat > "$W/bin/steer.stub" <<'STUB'
#!/bin/sh
echo "steer $*" >> "$W/steer.log"
case "$*" in "plugin ensure ${STEER_ENSURE_FAIL:-none}") exit 1 ;; esac
exit 0
STUB
cat > "$W/bin-apk/apk" <<'STUB'
#!/bin/sh
echo "apk $*" >> "$W/pm.log"
DB="$INSTALL_ROOT/pkgs"; WD="$APK_WORLD"; touch "$DB" "$WD"
case "$1" in
    list) while read -r n v; do echo "$n-$v-r1 x86_64 {$n} () [installed]"; done < "$DB"; exit 0 ;;
    update) exit 0 ;;
    del) shift; for n in "$@"; do pkgdb del "$n"; sed -i "/^$n\$/d; /^$n></d" "$WD"; done; exit 0 ;;
    add) shift
        files=""; names=""
        for a in "$@"; do case "$a" in --*) ;; *.apk) files="$files $a" ;; *) names="$names $a" ;; esac; done
        for f in $files; do
            case "${f##*/}" in steer-core-2.[1-9]*)
                # steer-core 2.1 берёт имена модулей на себя; закрепление модуля за файлом 2.0 не решается (снято на 3.0.5)
                pin="$(grep -E '^steer-(vless|hysteria2|proxy|xsteer|obfs|warpbox|tgws|extended)><' "$WD" | head -n 1)"
                [ -n "$pin" ] && { printf 'ERROR: unable to select packages:\n  steer-core:\n    breaks: world[%s]\n' "$pin"; exit 1; }
                # запрет имени, которое steer-core 2.1 provides, — в world или в самой команде (apk 3.0.2 на стенде)
                ban="$( { cat "$WD"; for a in $names; do echo "$a"; done; } | grep -E '^!(steer|steer-extended|libsteer|libsteer-wolfssl|steer-(vless|hysteria2|proxy|xsteer|obfs|warpbox|tgws))$' | head -n 1)"
                [ -n "$ban" ] && { printf 'ERROR: unable to select packages:\n  steer-core:\n    breaks: world[%s]\n' "$ban"; exit 1; } ;;
            esac
        done
        [ -n "${APK_ADD_FAIL:-}" ] && { echo "ERROR: $APK_ADD_FAIL"; exit 1; }
        for f in $files; do
            b="${f##*/}"; n="$(echo "$b" | sed 's/-[0-9].*//')"; v="$(echo "$b" | sed "s/^$n-//; s/-1_.*//")"
            # steer-core 2.1: конфликт и замена — прежние пакеты ядра и модулей снимаются в той же транзакции
            case "$b" in steer-core-2.[1-9]*)
                for o in steer steer-extended libsteer libsteer-wolfssl steer-vless steer-hysteria2 steer-proxy steer-xsteer steer-obfs steer-warpbox steer-tgws; do
                    pkgdb has "$o" && pkgdb del "$o"
                done ;;
            esac
            pkgdb add "$n" "$v"; sed -i "/^$n\$/d; /^$n></d" "$WD"; echo "$n><Q1$n=" >> "$WD"
            pkghook "$n" "$v"
        done
        for n in $names; do case "$n" in '!'*) pkgdb has "${n#!}" && pkgdb del "${n#!}" ;; *) grep -qx "$n" "$WD" || echo "$n" >> "$WD" ;; esac; done
        exit 0 ;;
esac
exit 0
STUB
cat > "$W/bin-opkg/opkg" <<'STUB'
#!/bin/sh
echo "opkg $*" >> "$W/pm.log"
DB="$INSTALL_ROOT/pkgs"; touch "$DB"
case "$1" in
    list-installed) while read -r n v; do echo "$n - $v-1"; done < "$DB"; exit 0 ;;
    update) exit 0 ;;
    remove) shift; for n in "$@"; do case "$n" in --*) ;; *) pkgdb del "$n" ;; esac; done; exit 0 ;;
    install) shift
        if [ -n "${OPKG_CONFLICT:-}" ]; then
            for m in steer-vless steer-proxy; do pkgdb has "$m" && { echo " * check_conflicts_for: The following packages conflict with steer-core: $m"; exit 1; }; done
        fi
        for f in "$@"; do
            case "$f" in --*) continue ;; esac
            b="${f##*/}"; n="$(echo "$b" | sed 's/-[0-9].*//')"; v="$(echo "$b" | sed "s/^$n-//; s/-1_.*//")"
            pkgdb add "$n" "$v"; pkghook "$n" "$v"
        done
        exit 0 ;;
esac
exit 0
STUB
chmod +x "$W"/bin/* "$W"/bin-apk/* "$W"/bin-opkg/*

# Состояние роутера: менеджер, пакеты «имя версия», world (apk), спека; печатает ничего.
wroot() {  # apk|opkg [ИМЯ ВЕРСИЯ]...
    WPM="$1"; shift
    rm -rf "$W/r" "$W"/*.log; mkdir -p "$W/r/etc/init.d" "$W/r/etc/apk" "$W/r/tmp"
    printf "DISTRIB_ARCH='x86_64'\n" > "$W/r/etc/openwrt_release"
    printf '#!/bin/sh\necho "rpcd $*" >> "$W/svc.log"\n' > "$W/r/etc/init.d/rpcd"; chmod +x "$W/r/etc/init.d/rpcd"
    : > "$W/r/pkgs"; : > "$W/r/etc/apk/world"
    while [ $# -ge 2 ]; do
        echo "$1 $2" >> "$W/r/pkgs"; echo "$1" >> "$W/r/etc/apk/world"; shift 2
    done
    INSTALL_ROOT="$W/r" PATH="$W/bin:$PATH" pkgdb rebuild
    # стоящее ядро — со своей командой и службой, как на роутере
    if grep -q '^steer-core ' "$W/r/pkgs"; then
        mkdir -p "$W/r/usr/sbin"; cp "$W/bin/steer.stub" "$W/r/usr/sbin/steer"; chmod +x "$W/r/usr/sbin/steer"
        printf '#!/bin/sh\necho "steer-init $*" >> "$W/svc.log"\n' > "$W/r/etc/init.d/steer"; chmod +x "$W/r/etc/init.d/steer"
    fi
}
# Запуск установщика без терминала (умолчания), как `sh install.sh </dev/null`. Вывод — в $W/out, код — в $W/rc.
wrun() {
    env INSTALL_ROOT="$W/r" W="$W" APK_WORLD="$W/r/etc/apk/world" APK_DB="$W/r/lib/apk/db/installed" \
        BOX_INITD="$W/r/etc/init.d/sing-box" PATH="$W/bin-$WPM:$W/bin:$PATH" "$@" \
        sh "$ROOT/install.sh" </dev/null > "$W/out" 2>&1
    echo $? > "$W/rc"
}
pkgs() { sort "$W/r/pkgs" | tr '\n' ';' | sed 's/;$//'; }
steerlog() { grep -o 'steer plugin [a-z]* *[a-z0-9]*' "$W/steer.log" 2>/dev/null | sed 's/ *$//' | tr '\n' ';' | sed 's/;$//'; }
mkwrel 2.1.0

# 1. Чистый роутер, apk.
wroot apk
wrun
check "чистый apk: установка прошла" "0" "$(cat "$W/rc")"
check "  поставлены steer-core 2.1.0 и splify2 26.11.0" "splify2 26.11.0;steer-core 2.1.0" "$(pkgs)"
check "  пустая спека легла ДО ядра (migrate ставит выбранное, а не всё семя)" "spec-at-core yes" "$(grep spec-at-core "$W/pm.log")"
check "  плагины: migrate (postinst и установщик), затем выбор по умолчанию" \
    "steer plugin migrate;steer plugin migrate;steer plugin ensure vless;steer plugin ensure hysteria2;steer plugin ensure proxy" "$(steerlog)"
check "  довод панели (engine settle) и итог семени" "host engine settle;seed --no-reload" "$(cat "$W/host.log" "$W/seed.log" 2>/dev/null | tr '\n' ';' | sed 's/;$//')"
check "  файлов модулей не качал" "0" "$(grep -c 'steer-vless\|steer-proxy' "$W/wget.log")"
check "  срок rpcd выставлен 120 (ключа не было — uci молчит)" "1" "$(grep -c 'uci -q set rpcd.@rpcd\[0\].timeout=120' "$W/uci.log")"
check "  без жалоб оболочки" "0" "$(grep -c 'Illegal number\|not found\|parameter not set' "$W/out")"
check "  rpcd перезапущен, служба steer включена" "rpcd restart;steer-init enable" "$(grep -e 'steer-init enable' -e 'rpcd restart' "$W/svc.log" | tr '\n' ';' | sed 's/;$//')"

# 2. Ядро 2.0.5 с модулями, поставленными файлами (закрепления в world), и прежняя панель 26.10.4 — состояние, которое
#    оставляет официальный установщик 26.10.4.
wroot apk steer-core 2.0.5 steer-vless 2.0.5 steer-hysteria2 2.0.5 steer-proxy 2.0.5 luci-app-splify2 26.10.4
printf '%s\n' 'steer-core><Q1steer-core=' 'steer-vless><Q1steer-vless=' 'steer-hysteria2><Q1steer-hysteria2=' \
    'steer-proxy><Q1steer-proxy=' 'luci-app-splify2><Q1luci-app-splify2=' 'zapret' > "$W/r/etc/apk/world"
mkdir -p "$W/r/etc/steer/lists"; printf 'version: 2\noutputs:\n  wgb: { kind: interface, device: wgb }\n' > "$W/r/etc/steer/spec.yaml"
echo 1.0.0.1 > "$W/r/etc/steer/lists/test.lst"
wrun
check "2.0.5 + модули файлами + 26.10.4 (apk): установка прошла" "0" "$(cat "$W/rc")"
check "  итог — steer-core 2.1.0 и splify2 26.11.0, пакетов модулей и luci-app-splify2 нет" "splify2 26.11.0;steer-core 2.1.0" "$(pkgs)"
check "  ядро ставилось одним файлом, без имён модулей в команде" "1;0" \
    "$(grep -c '^apk add .*steer-core-2.1.0-1_x86_64.apk' "$W/pm.log");$(grep '^apk add .*steer-core' "$W/pm.log" | grep -c 'steer-vless')"
check "  закрепления модулей за файлами сняты до транзакции (иначе breaks: world)" "0" "$(grep -c 'breaks' "$W/out")"
check "  чужая запись world цела" "zapret" "$(grep -x zapret "$W/r/etc/apk/world")"
check "  вопроса нет, выбор не навязан: только migrate" "steer plugin migrate;steer plugin migrate" "$(steerlog)"
check "  спека и списки на месте, пустая спека рядом не легла" "yes;1.0.0.1;no" \
    "$([ -s "$W/r/etc/steer/spec.yaml" ] && echo yes);$(cat "$W/r/etc/steer/lists/test.lst");$([ -e "$W/r/etc/steer/spec.json" ] && echo yes || echo no)"
check "  сказано, что модули заменяются плагинами" "1" "$(grep -c 'Ядро steer 2.0.5 → 2.1.0 (пакеты модулей steer-vless steer-hysteria2 steer-proxy заменяются плагинами)' "$W/out")"

# 3. Тот же переход, но стоял мост Telegram пакетом: плагин tgws ставится из сети после панели.
wroot apk steer-core 2.0.5 steer-vless 2.0.5 steer-tgws 2.0.5 splify2 26.11.0
wrun
check "2.0.5 + steer-tgws: после панели — ensure tgws" "steer plugin migrate;steer plugin migrate;steer plugin ensure tgws" "$(steerlog)"
wroot apk steer-core 2.0.5 steer-tgws 2.0.5
wrun STEER_ENSURE_FAIL=tgws
check "  tgws не встал (нет сети) — установка не падает, путь назван" "0;1" \
    "$(cat "$W/rc");$(grep -c 'tgws не встал (он ставится из сети' "$W/out")"

# 4. Уже 2.1.0 и 26.11.0, последний выпуск — 2.1.0: ядро не трогается, панель ставится заново, ничего не ломается.
wroot apk steer-core 2.1.0 splify2 26.11.0
mkdir -p "$W/r/etc/steer"; printf 'version: 2\n' > "$W/r/etc/steer/spec.yaml"
wrun
check "2.1.0 + 26.11.0, повтор: прошло, ядро не качалось и не ставилось" "0;0;0" \
    "$(cat "$W/rc");$(grep -c 'steer-core-' "$W/wget.log");$(grep -c '^apk add .*steer-core' "$W/pm.log")"
check "  сказано, что ядро последнее" "1" "$(grep -c 'Ядро steer 2.1.0 — последний выпуск, не трогаю' "$W/out")"
check "  панель — заново тем же выпуском, итог тот же" "1;splify2 26.11.0;steer-core 2.1.0" "$(grep -c 'тот же выпуск — ставлю заново' "$W/out");$(pkgs)"

# 5. 2.1.0 стоит, вышел 2.1.1 — обновляется.
mkwrel 2.1.1
wroot apk steer-core 2.1.0 splify2 26.11.0
wrun
check "2.1.0 → 2.1.1: обновлено" "0;splify2 26.11.0;steer-core 2.1.1" "$(cat "$W/rc");$(pkgs)"
mkwrel 2.1.0

# 6. Ядро 1.x (steer-extended): переход одной транзакцией без `!имя` — прежнее снимает конфликт steer-core; выбор по
# умолчанию. `!steer-extended` в той же транзакции ломал её: steer-core provides steer-extended (apk 3.0.2 на стенде).
wroot apk steer-extended 1.5.9
wrun
check "1.5.9 steer-extended (apk): прошло, итог steer-core 2.1.0" "0;splify2 26.11.0;steer-core 2.1.0" "$(cat "$W/rc");$(pkgs)"
check "  запретов в транзакции нет, в world не осталось" "0;0" "$(grep -c '^apk add .*!' "$W/pm.log");$(grep -c '^!' "$W/r/etc/apk/world")"

# 6б. После «удаления Steer» чужим менеджером: пакетов нет, в world — запреты всех имён ядра (чат: «breaks:
# world[!steer-extended]» на 25.12). Установка проходит, запретов не остаётся.
wroot apk
printf '%s\n' '!steer' '!steer-core' '!steer-extended' '!libsteer' '!libsteer-wolfssl' >> "$W/r/etc/apk/world"
wrun
check "запреты !steer* от чужого менеджера: прошло, итог steer-core 2.1.0" "0;splify2 26.11.0;steer-core 2.1.0" "$(cat "$W/rc");$(pkgs)"
check "  запретов в world не осталось" "0" "$(grep -c '^!' "$W/r/etc/apk/world")"

# 7. Коннектор: пакеты ядра не трогаются, плагины не ставятся; про ядро 2.0 сказано, что делать.
wroot apk steer-core 2.0.5 steer-box-connector 2.0.5
printf '# sing-box от steer-box-connector\n' > "$W/r/etc/init.d/sing-box"
wrun
check "коннектор: ядро не ставилось, migrate не звался, панель встала" "0;0;;splify2 26.11.0;steer-box-connector 2.0.5;steer-core 2.0.5" \
    "$(cat "$W/rc");$(grep -c '^apk add .*steer-core' "$W/pm.log");$(steerlog);$(pkgs)"
check "  сказано: ядро и коннектор обновляются вместе" "1" "$(grep -c 'Ядро и коннектор обновляются вместе' "$W/out")"
check "  спеку при коннекторе не заводит" "no" "$([ -e "$W/r/etc/steer/spec.json" ] && echo yes || echo no)"

# 8. Ядро обновляет сама панель (splify2-core-update идёт) — установщик не мешает ей второй транзакцией.
wroot apk steer-core 2.0.5 splify2 26.11.0
mkdir -p "$W/r/tmp/splify2-core-update"; sleep 30 & echo $! > "$W/r/tmp/splify2-core-update/pid"
wrun
check "панель обновляет ядро — отказ словами, пакеты не тронуты" "1;1;splify2 26.11.0;steer-core 2.0.5" \
    "$(cat "$W/rc");$(grep -c 'ядро сейчас обновляет сама панель' "$W/out");$(pkgs)"
kill "$(cat "$W/r/tmp/splify2-core-update/pid")" 2>/dev/null

# 9. apk отказал (места нет) — установка падает до панели, без «Готово».
wroot apk steer-core 2.0.5 steer-vless 2.0.5
wrun APK_ADD_FAIL="No space left on device"
check "apk отказал на ядре — отказ, панель не ставилась, прежнее ядро на месте" "1;0;steer-core 2.0.5;steer-vless 2.0.5" \
    "$(cat "$W/rc");$(grep -c 'splify2-26.11.0' "$W/wget.log");$(pkgs)"

# 10. opkg: чистый роутер, переход с 2.0.5 (Conflicts и Replaces снимают модули), отказ по конфликту.
wroot opkg
wrun
check "чистый opkg: прошло, ipk-файлы" "0;splify2 26.11.0;steer-core 2.1.0;1" \
    "$(cat "$W/rc");$(pkgs);$(grep -c '^opkg install .*steer-core-2.1.0-1_x86_64.ipk' "$W/pm.log")"
wroot opkg steer-core 2.0.5 steer-vless 2.0.5 steer-proxy 2.0.5 luci-app-splify2 26.10.4
mkdir -p "$W/r/etc/steer"; printf '{"version":2,"outputs":{"wgb":{"kind":"interface","device":"wgb"}}}\n' > "$W/r/etc/steer/spec.json"
wrun
check "2.0.5 + модули (opkg): Conflicts и Replaces ядра 2.1 снимают модули, итог 2.1.0 и 26.11.0" "0;splify2 26.11.0;steer-core 2.1.0" "$(cat "$W/rc");$(pkgs)"
check "  luci-app-splify2 снят перед панелью" "1" "$(grep -c '^opkg remove --force-depends luci-app-splify2' "$W/pm.log")"
check "  прежняя спека на месте" '{"version":2,"outputs":{"wgb":{"kind":"interface","device":"wgb"}}}' "$(cat "$W/r/etc/steer/spec.json")"
wroot opkg steer-core 2.0.5 steer-vless 2.0.5 steer-proxy 2.0.5
wrun OPKG_CONFLICT=1
check "opkg отказал конфликтом с модулями — сняты только наши модули, ядро встало со второго раза" "0;splify2 26.11.0;steer-core 2.1.0" "$(cat "$W/rc");$(pkgs)"
check "  снимались steer-vless и steer-proxy (--force-depends), steer-core — нет" "2;0" \
    "$(grep -c '^opkg remove --force-depends steer-\(vless\|proxy\)$' "$W/pm.log");$(grep -c '^opkg remove.* steer-core$' "$W/pm.log")"
wroot opkg steer-core 2.1.0 splify2 26.11.0
wrun
check "opkg 2.1.0 + 26.11.0, повтор: ядро не трогается" "0;0;splify2 26.11.0;steer-core 2.1.0" \
    "$(cat "$W/rc");$(grep -c '^opkg install .*steer-core' "$W/pm.log");$(pkgs)"
wroot opkg steer 1.5.9
wrun
check "opkg 1.5.9 steer: переход на steer-core 2.1.0" "0;splify2 26.11.0;steer-core 2.1.0" "$(cat "$W/rc");$(pkgs)"

# Последний выпуск ядра младше 2.1 и предварительной нет — отказ словами до любых пакетов.
python3 - "$W/version.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); d["products"]["steer"]["stable"] = "2.0.5"; d["products"]["steer"]["versions"] = [{"version": "2.0.5", "assets": []}]
json.dump(d, open(sys.argv[1], "w"))
PY
wroot apk
wrun
check "выпуск ядра 2.0.5 — отказ «нужно ядро 2.1», пакетов не ставил" "1;1;" \
    "$(cat "$W/rc");$(grep -c 'этому интерфейсу нужно ядро 2.1 или новее' "$W/out");$(pkgs)"
mkwrel 2.1.0

printf '\n%d проверок пройдено\n' "$pass"
if [ "$fail" -gt 0 ]; then
    printf 'ПРОВАЛЕНО: %d\n' "$fail"
    exit 1
fi
printf 'все проверки прошли\n'
