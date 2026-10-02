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
eval "$(sed -n '/^API=/p; /^RAW=/p; /^CODELOAD=/p; /^MIRROR=/p; /^DIST_BRANCH=/p; /^info()/p; /^gl_file() {/,/^}/p; /^gh_api_file() {/,/^}/p; /^gh_tarball() {/,/^}/p; /^gh_file() {/,/^}/p; /^latest() {/,/^}/p; /^fetch() {/,/^}/p; /^dl_url() {/,/^}/p; /^pm_add() {/,/^}/p' "$ROOT/install.sh")"
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
              "versions": [v("splify2", "26.9.2", "splify2/splify2", ["luci-app-splify2-26.9.2-1_noarch.apk"])]}}}
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
check "отказы ведут на страницу релизов (версии ядра и интерфейса, ядро старше 2.0, переход по opkg)" "4" \
    "$(grep -c 'Пакеты\|Пакет можно поставить руками' "$ROOT/install.sh")"

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
    "$(sed '/^pm_drop_old() {/,/^}/d; /^pm_forget_old() {/,/^}/d' "$ROOT/install.sh" | grep -c 'apk del\|opkg remove\|rm -rf /etc\|uci -q delete')"
check "снимаются только имена прежнего ядра" "2" \
    "$(sed -n '/^pm_drop_old() {/,/^}/p; /^pm_forget_old() {/,/^}/p' "$ROOT/install.sh" | grep -c 'steer|steer-extended|libsteer|libsteer-wolfssl)')"

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

# ---- ядро 2.0: модули вместо вариантов -------------------------------------------------
# Вариантов «базовый/расширенный» больше нет: ядро — steer-core, протоколы — модули. Состав
# установки: выбор человека (умолчание — vless, hysteria2, proxy), уже стоящие модули и, при
# переходе со steer-extended 1.x, вшитые в него vless, xsteer, obfs, tgws.
eval "$(sed -n '/^REPO_STEER=/p; /^pm_names() {/,/^}/p; /^pm_has() {/,/^}/p; /^STEER_MODULES=/p; /^STEER_DEFAULT_MODULES=/p; /^steer_mods() {/,/^}/p; /^steer_version() {/,/^}/p; /^BOX_INITD=/p; /^box_busy() {/,/^}/p' "$ROOT/install.sh")"
check "функция steer_mods достана из install.sh" "steer_mods" "$(command -v steer_mods >/dev/null && echo steer_mods)"
check "умолчание к первой установке — vless hysteria2 proxy" "vless hysteria2 proxy" "$STEER_DEFAULT_MODULES"
: > "$SB/pkglist"
check "чистый роутер: выбор человека как есть, по порядку" "vless proxy tgws" "$(steer_mods 'tgws proxy vless')"
printf '%s\n' 'steer-extended-1.5.9-r1 x86_64 {steer-extended} (GPL-2.0)' > "$SB/pkglist"
check "steer-extended 1.5.9: к выбору — вшитые в него модули" "vless hysteria2 proxy xsteer obfs tgws" \
    "$(steer_mods "$STEER_DEFAULT_MODULES")"
printf '%s\n' 'steer-1.5.9-r1 x86_64 {steer} (GPL-2.0)' > "$SB/pkglist"
check "steer 1.5.9: только выбор (имя steer не путается со steer-core)" "proxy" "$(steer_mods proxy)"
check "  и steer-core не считается стоящим" "нет" "$(pm_has steer-core && echo да || echo нет)"
printf '%s\n' 'steer-core-2.0.0-r1 x86_64 {steer-core}' 'steer-obfs-2.0.0-r1 x86_64 {steer-obfs}' > "$SB/pkglist"
check "стоящий модуль входит в состав" "vless obfs" "$(steer_mods vless)"
: > "$SB/pkglist"

# Версия ядра: стабильная 1.5.9 этому интерфейсу не годится (он пишет спеку v2) — тогда
# предварительная из перечня, если она 2.0 или новее.
relreset
mkrel "$SB/resp-rel-raw"
sed -i 's/"prerelease": null/"prerelease": "2.0.0"/' "$SB/resp-rel-raw"
check "стабильная 1.x — берётся предварительная 2.0.0" "2.0.0" "$(steer_version 2>/dev/null | tail -1)"
relreset
mkrel "$SB/resp-rel-raw"
check "предварительной нет — версия как есть (установщик откажет словами)" "1.5.9" "$(steer_version 2>/dev/null | tail -1)"
check "отказ на ядре старше 2.0 назван" "1" "$(grep -c 'этому интерфейсу нужно ядро 2.0 или новее' "$ROOT/install.sh")"
relreset

# Пакеты 2.0: ядро и модули — одной транзакцией, прежнее ядро — в ней же (`!имя`).
check "ядро и модули ставятся одним pm_add" "1" "$(grep -c 'if ! pm_add \$FILES \$EXTRA' "$ROOT/install.sh")"
check "имена файлов — steer-core и steer-<модуль>" "1" "$(grep -c 'for _p in steer-core ' "$ROOT/install.sh")"
check "прежних пакетов steer-extended/steer больше не ставит" "0" \
    "$(grep -c 'steer-extended-\${SV}\|\"steer-\${SV}' "$ROOT/install.sh")"

# Спека — v2, как в uci-defaults: ядро 2.0 прежнюю схему не читает.
check "пустая спека — v2" "1" "$(grep -c "printf '{\"version\":2,\"outputs\":{\"direct\":{\"kind\":\"direct\"}}}" "$ROOT/install.sh")"
check "спеки v1 установщик не пишет" "0" "$(grep -c '"schema":1' "$ROOT/install.sh")"

# Коннектор steer-box-connector: ядро — его, установщик ядро не ставит и службу steer не включает.
mkdir -p "$SB/box"; BOX_INITD="$SB/box/sing-box"
printf '# sing-box от steer-box-connector\n' > "$BOX_INITD"
check "коннектор узнаётся по его службе sing-box" "да" "$(box_busy && echo да || echo нет)"
printf '# sing-box\n' > "$BOX_INITD"
check "чужой sing-box коннектором не считается" "нет" "$(box_busy && echo да || echo нет)"
check "при коннекторе служба steer не включается" "1" "$(grep -c 'init.d/steer \] && ! box_busy' "$ROOT/install.sh")"

# Модули перечислены одинаково в установщике, бэкенде и интерфейсе.
check "перечень модулей установщика = бэкенда" \
    "$(sed -n 's/^STEER_MODULES="\(.*\)"/\1/p' "$ROOT/files/usr/lib/splify2/rpcd/m-engine.sh")" "$STEER_MODULES"
check "перечень модулей установщика = интерфейса" "$STEER_MODULES" \
    "$(sed -n "s/^export const STEER_MODULES = \[\(.*\)\]/\1/p" "$ROOT/ui/src/lib/engine.ts" | tr -d "'," )"
check "умолчание установщика = интерфейса" "$STEER_DEFAULT_MODULES" \
    "$(sed -n "s/^export const DEFAULT_MODULES = \[\(.*\)\]/\1/p" "$ROOT/ui/src/lib/engine.ts" | tr -d "'," )"

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

printf '\n%d проверок пройдено\n' "$pass"
if [ "$fail" -gt 0 ]; then
    printf 'ПРОВАЛЕНО: %d\n' "$fail"
    exit 1
fi
printf 'все проверки прошли\n'
