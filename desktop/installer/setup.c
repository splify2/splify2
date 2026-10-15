/* Установщик splify2 для компьютера — окно сразу, установка фоном.
 *
 * ЗАЧЕМ СВОЙ. Установщик Squirrel (Setup.exe из electron-winstaller) сначала молча распаковывает
 * весь пакет — ~140 МБ — во временный каталог и только потом запускает Update.exe, у которого и
 * есть окно с анимацией. Всё это время на экране ничего: человек щёлкает установщик, ждёт, щёлкает
 * снова (владелец: «окно всё ещё появляется позже»). Этот загрузчик — маленький exe, к которому
 * дописан Setup.exe Squirrel. Он показывает окно с анимацией в первые миллисекунды, а установку
 * Squirrel запускает фоном, тихо (`--silent`): сама установка, ярлыки, обновления — по-прежнему
 * Squirrel.
 *
 * Ещё две вещи, которых Squirrel не делает сам:
 *  - запущенная старая версия закрывается: полная установка Squirrel сносит каталог программы, и
 *    занятый каталог ронял установку («is the app still running???»);
 *  - после тихой установки Squirrel программу не запускает (Update.exe, invokePostInstall:
 *    silentInstall) — запускаем сами, как это делает обычная установка.
 *
 * Формат файла: [этот exe][Setup.exe Squirrel][8 байт: длина Setup.exe][8 байт: «SPLFY2S1»].
 * Сборка — installer/build.sh (mingw-w64 в docker). */
#define WIN32_LEAN_AND_MEAN
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <windows.h>
#include <tlhelp32.h>
#include <shellapi.h>
#include <shlobj.h>
#include <objidl.h>
#include <gdiplus.h>
#include <stdio.h>
#include <wchar.h>

#define APP_DIR L"splify2"
#define APP_EXE L"splify2.exe"
#define MAGIC "SPLFY2S1"
#define WM_DONE (WM_APP + 1)
#define TIMER_FRAME 1
#define TIMER_CLOSE 2
#define MIN_SHOW_MS 1500

static HWND g_wnd;
static GpImage *g_gif;
static UINT g_frames, g_frame;
static UINT *g_delays;
static int g_dpi = 96;
static int g_w, g_h;
static const wchar_t *g_text = L"Устанавливаем splify2…";
static DWORD g_started;
static wchar_t g_err[512];

static int S(int v) { return MulDiv(v, g_dpi, 96); }

/* ── анимация ─────────────────────────────────────────────────────────────── */

static void load_gif(void) {
    HRSRC r = FindResourceW(NULL, MAKEINTRESOURCEW(2), (LPCWSTR)RT_RCDATA);
    if (!r) return;
    DWORD n = SizeofResource(NULL, r);
    const void *p = LockResource(LoadResource(NULL, r));
    HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, n);
    if (!h || !p) return;
    memcpy(GlobalLock(h), p, n);
    GlobalUnlock(h);
    IStream *st = NULL;
    if (CreateStreamOnHGlobal(h, TRUE, &st) != S_OK) return;
    if (GdipLoadImageFromStream(st, &g_gif) != Ok) { g_gif = NULL; return; }
    GUID dim = FrameDimensionTime;
    GdipImageGetFrameCount(g_gif, &dim, &g_frames);
    if (g_frames < 1) g_frames = 1;
    g_delays = calloc(g_frames, sizeof(UINT));
    UINT sz = 0;
    if (GdipGetPropertyItemSize(g_gif, PropertyTagFrameDelay, &sz) == Ok && sz) {
        PropertyItem *pi = malloc(sz);
        if (pi && GdipGetPropertyItem(g_gif, PropertyTagFrameDelay, sz, pi) == Ok) {
            UINT cnt = pi->length / 4;
            for (UINT i = 0; i < g_frames && i < cnt; i++) g_delays[i] = ((UINT *)pi->value)[i] * 10;
        }
        free(pi);
    }
    for (UINT i = 0; i < g_frames; i++) if (g_delays[i] < 20) g_delays[i] = 60;
}

static void paint(HDC dc) {
    HDC mem = CreateCompatibleDC(dc);
    HBITMAP bmp = CreateCompatibleBitmap(dc, g_w, g_h);
    HGDIOBJ old = SelectObject(mem, bmp);
    HBRUSH bg = CreateSolidBrush(RGB(0x16, 0x12, 0x1f));
    RECT all = { 0, 0, g_w, g_h };
    FillRect(mem, &all, bg);
    DeleteObject(bg);

    int side = S(260);
    if (g_gif) {
        GpGraphics *gr = NULL;
        GdipCreateFromHDC(mem, &gr);
        GdipSetInterpolationMode(gr, InterpolationModeHighQualityBicubic);
        GdipDrawImageRectI(gr, g_gif, (g_w - side) / 2, S(28), side, side);
        GdipDeleteGraphics(gr);
    }

    HFONT f = CreateFontW(-S(15), 0, 0, 0, FW_SEMIBOLD, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
    HGDIOBJ of = SelectObject(mem, f);
    SetBkMode(mem, TRANSPARENT);
    SetTextColor(mem, RGB(0xec, 0xe9, 0xf7));
    RECT tr = { S(16), S(28) + side + S(8), g_w - S(16), g_h - S(16) };
    DrawTextW(mem, g_err[0] ? g_err : g_text, -1, &tr, DT_CENTER | DT_TOP | DT_WORDBREAK);
    SelectObject(mem, of);
    DeleteObject(f);

    BitBlt(dc, 0, 0, g_w, g_h, mem, 0, 0, SRCCOPY);
    SelectObject(mem, old);
    DeleteObject(bmp);
    DeleteDC(mem);
}

/* ── установка ────────────────────────────────────────────────────────────── */

static void app_root(wchar_t *out, size_t n) {
    wchar_t la[MAX_PATH] = L"";
    SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, la);
    _snwprintf(out, n, L"%ls\\%ls", la, APP_DIR);
    out[n - 1] = 0;
}

/* Закрыть запущенную программу из каталога установки: её каталог Squirrel снесёт и поставит
 * заново, а занятые файлы роняют установку. Чужие процессы с тем же именем не трогаем. */
static void close_running(void) {
    wchar_t root[MAX_PATH];
    app_root(root, MAX_PATH);
    size_t rl = wcslen(root);
    DWORD self = GetCurrentProcessId();
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return;
    PROCESSENTRY32W pe = { .dwSize = sizeof(pe) };
    for (BOOL ok = Process32FirstW(snap, &pe); ok; ok = Process32NextW(snap, &pe)) {
        if (pe.th32ProcessID == self || _wcsicmp(pe.szExeFile, APP_EXE) != 0) continue;
        HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | SYNCHRONIZE, FALSE, pe.th32ProcessID);
        if (!h) continue;
        wchar_t path[MAX_PATH];
        DWORD pl = MAX_PATH;
        if (QueryFullProcessImageNameW(h, 0, path, &pl) && pl > rl && _wcsnicmp(path, root, rl) == 0 && path[rl] == L'\\') {
            TerminateProcess(h, 0);
            WaitForSingleObject(h, 5000);
        }
        CloseHandle(h);
    }
    CloseHandle(snap);
}

/* Дописанный к себе Setup.exe — во временный файл. */
static BOOL extract(wchar_t *dst, size_t n) {
    wchar_t self[MAX_PATH];
    GetModuleFileNameW(NULL, self, MAX_PATH);
    HANDLE f = CreateFileW(self, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (f == INVALID_HANDLE_VALUE) return FALSE;
    LARGE_INTEGER size;
    GetFileSizeEx(f, &size);
    char tail[16];
    DWORD rd = 0;
    LARGE_INTEGER pos;
    pos.QuadPart = size.QuadPart - 16;
    SetFilePointerEx(f, pos, NULL, FILE_BEGIN);
    if (!ReadFile(f, tail, 16, &rd, NULL) || rd != 16 || memcmp(tail + 8, MAGIC, 8) != 0) { CloseHandle(f); return FALSE; }
    unsigned long long len;
    memcpy(&len, tail, 8);
    pos.QuadPart = size.QuadPart - 16 - (LONGLONG)len;
    SetFilePointerEx(f, pos, NULL, FILE_BEGIN);

    wchar_t tmp[MAX_PATH];
    GetTempPathW(MAX_PATH, tmp);
    _snwprintf(dst, n, L"%lssplify2-setup-%lu.exe", tmp, GetCurrentProcessId());
    dst[n - 1] = 0;
    HANDLE o = CreateFileW(dst, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, NULL);
    if (o == INVALID_HANDLE_VALUE) { CloseHandle(f); return FALSE; }
    static char buf[1 << 20];
    BOOL good = TRUE;
    while (len > 0) {
        DWORD want = len > sizeof(buf) ? sizeof(buf) : (DWORD)len, got = 0, wr = 0;
        if (!ReadFile(f, buf, want, &got, NULL) || got == 0 || !WriteFile(o, buf, got, &wr, NULL) || wr != got) { good = FALSE; break; }
        len -= got;
    }
    CloseHandle(o);
    CloseHandle(f);
    if (!good) DeleteFileW(dst);
    return good;
}

static DWORD WINAPI work(LPVOID unused) {
    (void)unused;
    close_running();
    wchar_t setup[MAX_PATH];
    if (!extract(setup, MAX_PATH)) {
        _snwprintf(g_err, 512, L"Установщик повреждён — скачайте его заново");
        PostMessageW(g_wnd, WM_DONE, 1, 0);
        return 1;
    }
    wchar_t cmd[MAX_PATH + 32];
    _snwprintf(cmd, MAX_PATH + 32, L"\"%ls\" --silent", setup);
    STARTUPINFOW si = { .cb = sizeof(si) };
    PROCESS_INFORMATION pi;
    DWORD code = 1;
    if (CreateProcessW(setup, cmd, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
        WaitForSingleObject(pi.hProcess, INFINITE);
        GetExitCodeProcess(pi.hProcess, &code);
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
    }
    DeleteFileW(setup);
    if (code != 0) {
        _snwprintf(g_err, 512, L"Установка не удалась (код %lu). Подробности — в %%LOCALAPPDATA%%\\SquirrelTemp\\SquirrelSetup.log", code);
        PostMessageW(g_wnd, WM_DONE, 1, 0);
        return 1;
    }
    /* Тихая установка Squirrel программу не запускает — запускаем через её корневой exe (он
     * выбирает последнюю версию из app-<версия>). */
    wchar_t exe[MAX_PATH];
    app_root(exe, MAX_PATH);
    wcsncat(exe, L"\\" APP_EXE, MAX_PATH - wcslen(exe) - 1);
    ShellExecuteW(NULL, L"open", exe, L"--squirrel-firstrun", NULL, SW_SHOWNORMAL);
    PostMessageW(g_wnd, WM_DONE, 0, 0);
    return 0;
}

/* ── окно ─────────────────────────────────────────────────────────────────── */

static LRESULT CALLBACK proc(HWND h, UINT m, WPARAM w, LPARAM l) {
    switch (m) {
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC dc = BeginPaint(h, &ps);
        paint(dc);
        EndPaint(h, &ps);
        return 0;
    }
    case WM_ERASEBKGND:
        return 1;
    case WM_TIMER:
        if (w == TIMER_FRAME && g_gif && g_frames > 1) {
            g_frame = (g_frame + 1) % g_frames;
            GUID dim = FrameDimensionTime;
            GdipImageSelectActiveFrame(g_gif, &dim, g_frame);
            SetTimer(h, TIMER_FRAME, g_delays[g_frame], NULL);
            InvalidateRect(h, NULL, FALSE);
        } else if (w == TIMER_CLOSE) {
            DestroyWindow(h);
        }
        return 0;
    case WM_DONE:
        if (w) {
            /* Ошибка: окно остаётся с текстом, закрыть — щелчком. */
            KillTimer(h, TIMER_FRAME);
            InvalidateRect(h, NULL, FALSE);
            return 0;
        }
        g_text = L"Готово";
        InvalidateRect(h, NULL, FALSE);
        {
            DWORD shown = GetTickCount() - g_started;
            SetTimer(h, TIMER_CLOSE, shown < MIN_SHOW_MS ? MIN_SHOW_MS - shown : 300, NULL);
        }
        return 0;
    case WM_LBUTTONDOWN:
        if (g_err[0]) { DestroyWindow(h); return 0; }
        /* Окно таскают за любое место. */
        ReleaseCapture();
        SendMessageW(h, WM_NCLBUTTONDOWN, HTCAPTION, 0);
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(h, m, w, l);
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, PWSTR cmd, int show) {
    (void)prev; (void)cmd; (void)show;
    g_started = GetTickCount();
    HDC sdc = GetDC(NULL);
    g_dpi = GetDeviceCaps(sdc, LOGPIXELSX);
    ReleaseDC(NULL, sdc);
    g_w = S(320);
    g_h = S(360);

    ULONG_PTR tok;
    GdiplusStartupInput gin = { 1, NULL, FALSE, FALSE };
    GdiplusStartup(&tok, &gin, NULL);
    load_gif();

    WNDCLASSW wc = { 0 };
    wc.lpfnWndProc = proc;
    wc.hInstance = inst;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(1));
    wc.lpszClassName = L"splify2-setup";
    RegisterClassW(&wc);

    RECT wa;
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &wa, 0);
    g_wnd = CreateWindowExW(WS_EX_APPWINDOW, wc.lpszClassName, L"Установка splify2", WS_POPUP,
                            wa.left + (wa.right - wa.left - g_w) / 2, wa.top + (wa.bottom - wa.top - g_h) / 2,
                            g_w, g_h, NULL, NULL, inst, NULL);
    SetWindowRgn(g_wnd, CreateRoundRectRgn(0, 0, g_w + 1, g_h + 1, S(28), S(28)), FALSE);
    ShowWindow(g_wnd, SW_SHOW);
    UpdateWindow(g_wnd);
    if (g_gif && g_frames > 1) SetTimer(g_wnd, TIMER_FRAME, g_delays[0], NULL);

    CloseHandle(CreateThread(NULL, 0, work, NULL, 0, NULL));

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    if (g_gif) GdipDisposeImage(g_gif);
    GdiplusShutdown(tok);
    return 0;
}
