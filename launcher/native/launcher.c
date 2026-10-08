/* Arxiv PDF Translate - native Win32 tray launcher (no runtime dependencies).
 *
 *   ArxivPdfTranslate.exe            启动服务 + 托盘 + 打开浏览器控制台
 *   ArxivPdfTranslate.exe --tray     仅托盘（用于开机自启，不打开浏览器）
 *   ArxivPdfTranslate.exe --server   仅启动本机服务，然后退出
 *
 * Build: launcher\build-native-launcher.bat  (MinGW-w64 gcc)
 */
#define WINVER 0x0601
#define _WIN32_WINNT 0x0601
#define _WIN32_IE 0x0600
#define WIN32_LEAN_AND_MEAN

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <objbase.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#define CLASS_NAME          L"ArxivPdfTranslateLauncherWnd"
#define RUN_KEY             L"Software\\Microsoft\\Windows\\CurrentVersion\\Run"
#define RUN_NAME            L"BrowserPDFTranslate"
#define SHORTCUT_NAME       L"Arxiv PDF Translate.lnk"
#define MUTEX_NAME          L"Local\\ArxivPdfTranslate.Launcher"
#define WM_TRAYMSG          (WM_APP + 1)
#define WM_APP_OPENCONSOLE  (WM_APP + 2)
#define TIMER_ID            1
#define PATHBUF             1024

enum {
    ID_OPENCONSOLE = 1001,
    ID_START,
    ID_STOP,
    ID_AUTO,
    ID_SHORTCUT,
    ID_EXIT
};

static wchar_t g_projectDir[PATHBUF];
static wchar_t g_serverDir[PATHBUF];
static wchar_t g_serverScript[PATHBUF];
static wchar_t g_logFile[PATHBUF];
static wchar_t g_python[PATHBUF];
static wchar_t g_exePath[PATHBUF];
static int     g_port = 18760;

static NOTIFYICONDATAW g_nid;
static PROCESS_INFORMATION g_serverProc = {0};
static int g_wsaReady = 0;

/* ---- path helpers ------------------------------------------------------ */
static BOOL FileExistsW(const wchar_t *path) {
    DWORD a = GetFileAttributesW(path);
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

static void GetExeDir(wchar_t *out, DWORD cap) {
    GetModuleFileNameW(NULL, out, cap);
    wchar_t *s = wcsrchr(out, L'\\');
    if (s) { *s = 0; }
}

static BOOL FindProjectRoot(const wchar_t *start, wchar_t *out, DWORD cap) {
    wchar_t dir[PATHBUF];
    wcsncpy(dir, start, PATHBUF - 1);
    dir[PATHBUF - 1] = 0;
    for (int i = 0; i < 8; i++) {
        wchar_t test[PATHBUF];
        swprintf(test, PATHBUF, L"%s\\server\\server.py", dir);
        if (FileExistsW(test)) {
            wcsncpy(out, dir, cap - 1);
            out[cap - 1] = 0;
            return TRUE;
        }
        wchar_t *s = wcsrchr(dir, L'\\');
        if (!s) { break; }
        if (s == dir + 2 && dir[1] == L':') { break; } /* drive root like C: */
        *s = 0;
    }
    return FALSE;
}

static int ReadPort(void) {
    wchar_t cfg[PATHBUF];
    swprintf(cfg, PATHBUF, L"%s\\config.json", g_serverDir);
    FILE *f = _wfopen(cfg, L"rb");
    if (!f) { return 18760; }
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (len <= 0 || len > 1000000) { fclose(f); return 18760; }
    char *buf = (char *)malloc((size_t)len + 1);
    if (!buf) { fclose(f); return 18760; }
    fread(buf, 1, (size_t)len, f);
    buf[len] = 0;
    fclose(f);
    int port = 18760;
    char *p = strstr(buf, "\"port\"");
    if (p) {
        p += 6;
        while (*p && *p != ':') { p++; }
        if (*p == ':') {
            p++;
            while (*p == ' ' || *p == '\t') { p++; }
            int v = atoi(p);
            if (v > 0 && v < 65536) { port = v; }
        }
    }
    free(buf);
    return port;
}

static void ResolvePaths(void) {
    wchar_t exeDir[PATHBUF];
    GetExeDir(exeDir, PATHBUF);
    if (!FindProjectRoot(exeDir, g_projectDir, PATHBUF)) {
        wcsncpy(g_projectDir, exeDir, PATHBUF - 1);
        g_projectDir[PATHBUF - 1] = 0;
        wchar_t *s = wcsrchr(g_projectDir, L'\\');
        if (s) { *s = 0; }
    }
    swprintf(g_serverDir, PATHBUF, L"%s\\server", g_projectDir);
    swprintf(g_serverScript, PATHBUF, L"%s\\server.py", g_serverDir);
    swprintf(g_logFile, PATHBUF, L"%s\\server.log", g_serverDir);
    g_port = ReadPort();
    wchar_t bundled[PATHBUF];
    swprintf(bundled, PATHBUF, L"%s\\engine\\runtime\\python.exe", g_projectDir);
    if (FileExistsW(bundled)) {
        wcsncpy(g_python, bundled, PATHBUF - 1);
    } else {
        wcsncpy(g_python, L"python", PATHBUF - 1);
    }
    g_python[PATHBUF - 1] = 0;
    GetModuleFileNameW(NULL, g_exePath, PATHBUF);
}

/* ---- tiny HTTP client (Winsock) --------------------------------------- */
static SOCKET ConnectTimeout(int timeoutMs) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) { return INVALID_SOCKET; }
    u_long nb = 1;
    ioctlsocket(s, FIONBIO, &nb);
    struct sockaddr_in a;
    memset(&a, 0, sizeof(a));
    a.sin_family = AF_INET;
    a.sin_port = htons((u_short)g_port);
    inet_pton(AF_INET, "127.0.0.1", &a.sin_addr);
    if (connect(s, (struct sockaddr *)&a, sizeof(a)) == SOCKET_ERROR) {
        int e = WSAGetLastError();
        if (e != WSAEWOULDBLOCK && e != WSAEINPROGRESS) { closesocket(s); return INVALID_SOCKET; }
        fd_set wf;
        FD_ZERO(&wf);
        FD_SET(s, &wf);
        struct timeval tv;
        tv.tv_sec = timeoutMs / 1000;
        tv.tv_usec = (timeoutMs % 1000) * 1000;
        if (select(0, NULL, &wf, NULL, &tv) <= 0) { closesocket(s); return INVALID_SOCKET; }
        int err = 0, el = sizeof(err);
        getsockopt(s, SOL_SOCKET, SO_ERROR, (char *)&err, &el);
        if (err != 0) { closesocket(s); return INVALID_SOCKET; }
    }
    nb = 0;
    ioctlsocket(s, FIONBIO, &nb);
    DWORD to = (DWORD)timeoutMs;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (char *)&to, sizeof(to));
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, (char *)&to, sizeof(to));
    return s;
}

/* Returns HTTP status code, or -1 on failure. Body (if any) into resp. */
static int HttpCall(const char *method, const char *path, const char *json,
                    char *resp, int cap, int timeoutMs) {
    if (!g_wsaReady) {
        WSADATA w;
        WSAStartup(MAKEWORD(2, 2), &w);
        g_wsaReady = 1;
    }
    SOCKET s = ConnectTimeout(timeoutMs);
    if (s == INVALID_SOCKET) { return -1; }

    char req[2048];
    int n = 0;
    n += snprintf(req + n, sizeof(req) - n,
                  "%s %s HTTP/1.0\r\nHost: 127.0.0.1:%d\r\nConnection: close\r\n",
                  method, path, g_port);
    if (json && *json) {
        n += snprintf(req + n, sizeof(req) - n,
                      "Content-Type: application/json\r\nContent-Length: %d\r\n",
                      (int)strlen(json));
    }
    n += snprintf(req + n, sizeof(req) - n, "\r\n");
    if (json && *json) {
        n += snprintf(req + n, sizeof(req) - n, "%s", json);
    }

    int sent = 0;
    while (sent < n) {
        int k = send(s, req + sent, n - sent, 0);
        if (k <= 0) { break; }
        sent += k;
    }

    int total = 0, status = -1;
    while (total < cap - 1) {
        int k = recv(s, resp + total, cap - 1 - total, 0);
        if (k <= 0) { break; }
        total += k;
    }
    resp[total] = 0;
    closesocket(s);

    if (total > 0) {
        char *sp = strstr(resp, " ");
        if (sp) { status = atoi(sp + 1); }
    }
    return status;
}

static BOOL IsServerUp(void) {
    char r[256];
    return HttpCall("GET", "/health", NULL, r, sizeof(r), 600) == 200;
}

static BOOL WaitForServerUp(int timeoutMs) {
    int waited = 0;
    while (waited < timeoutMs) {
        if (IsServerUp()) { return TRUE; }
        Sleep(250);
        waited += 250;
    }
    return IsServerUp();
}

/* ---- server lifecycle -------------------------------------------------- */
static void StartServer(void) {
    if (IsServerUp()) { return; }

    SECURITY_ATTRIBUTES sa;
    sa.nLength = sizeof(sa);
    sa.lpSecurityDescriptor = NULL;
    sa.bInheritHandle = TRUE;

    HANDLE hlog = CreateFileW(g_logFile, FILE_APPEND_DATA,
                              FILE_SHARE_READ | FILE_SHARE_WRITE, &sa,
                              OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    HANDLE hnul = CreateFileW(L"NUL", GENERIC_READ,
                              FILE_SHARE_READ | FILE_SHARE_WRITE, &sa,
                              OPEN_EXISTING, 0, NULL);

    STARTUPINFOW si;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = hnul;
    si.hStdOutput = hlog;
    si.hStdError = hlog;

    PROCESS_INFORMATION pi;
    ZeroMemory(&pi, sizeof(pi));

    wchar_t cmd[PATHBUF * 2];
    swprintf(cmd, PATHBUF * 2, L"\"%s\" \"%s\"", g_python, g_serverScript);

    BOOL ok = CreateProcessW(NULL, cmd, NULL, NULL, TRUE,
                             CREATE_NO_WINDOW, NULL, g_serverDir, &si, &pi);
    if (hlog != INVALID_HANDLE_VALUE) { CloseHandle(hlog); }
    if (hnul != INVALID_HANDLE_VALUE) { CloseHandle(hnul); }
    if (ok) {
        CloseHandle(pi.hThread);
        g_serverProc = pi;
    }
}

static void StopServer(void) {
    char r[128];
    HttpCall("POST", "/server/shutdown", "", r, sizeof(r), 1500);
    Sleep(400);
    if (g_serverProc.hProcess) {
        DWORD code = 0;
        if (GetExitCodeProcess(g_serverProc.hProcess, &code) && code == STILL_ACTIVE) {
            WaitForSingleObject(g_serverProc.hProcess, 1500);
            if (GetExitCodeProcess(g_serverProc.hProcess, &code) && code == STILL_ACTIVE) {
                TerminateProcess(g_serverProc.hProcess, 0);
            }
        }
        CloseHandle(g_serverProc.hProcess);
        g_serverProc.hProcess = NULL;
    }
}

static void OpenConsole(void) {
    wchar_t url[128];
    swprintf(url, 128, L"http://127.0.0.1:%d/", g_port);
    ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
}

// Open the console; if the service is not running, offer to start it first.
static void OpenConsoleGuarded(void) {
    if (IsServerUp()) {
        OpenConsole();
        return;
    }
    if (MessageBoxW(NULL,
                    L"本机服务当前未启动。\n是否启动服务并打开控制台？",
                    L"Arxiv PDF Translate",
                    MB_ICONQUESTION | MB_YESNO | MB_DEFBUTTON1) != IDYES) {
        return;
    }
    StartServer();
    if (WaitForServerUp(10000)) {
        OpenConsole();
    } else {
        MessageBoxW(NULL,
                    L"服务启动失败或超时，请稍后重试。\n可查看 server\\server.log 了解详情。",
                    L"Arxiv PDF Translate", MB_ICONERROR | MB_OK);
    }
}

/* ---- system integration ------------------------------------------------ */
static BOOL GetAutostart(void) {
    HKEY k;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, RUN_KEY, 0, KEY_READ, &k) != ERROR_SUCCESS) {
        return FALSE;
    }
    wchar_t buf[PATHBUF * 2];
    DWORD sz = sizeof(buf);
    DWORD type = 0;
    BOOL found = RegQueryValueExW(k, RUN_NAME, NULL, &type, (BYTE *)buf, &sz) == ERROR_SUCCESS;
    RegCloseKey(k);
    return found;
}

static void SetAutostart(BOOL enabled) {
    HKEY k;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, RUN_KEY, 0, NULL, 0, KEY_SET_VALUE,
                        NULL, &k, NULL) != ERROR_SUCCESS) {
        return;
    }
    if (enabled) {
        wchar_t val[PATHBUF * 2];
        swprintf(val, PATHBUF * 2, L"\"%s\" --tray", g_exePath);
        RegSetValueExW(k, RUN_NAME, 0, REG_SZ, (const BYTE *)val,
                       (DWORD)((wcslen(val) + 1) * sizeof(wchar_t)));
    } else {
        RegDeleteValueW(k, RUN_NAME);
    }
    RegCloseKey(k);
}

static void CreateShortcut(void) {
    wchar_t desktop[MAX_PATH];
    if (FAILED(SHGetFolderPathW(NULL, CSIDL_DESKTOPDIRECTORY | CSIDL_FLAG_CREATE,
                                NULL, 0, desktop))) {
        return;
    }
    wchar_t lnk[PATHBUF];
    swprintf(lnk, PATHBUF, L"%s\\%s", desktop, SHORTCUT_NAME);

    IShellLinkW *link = NULL;
    if (CoCreateInstance(&CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER,
                         &IID_IShellLinkW, (void **)&link) != S_OK) {
        return;
    }
    link->lpVtbl->SetPath(link, g_exePath);
    link->lpVtbl->SetWorkingDirectory(link, g_projectDir);
    link->lpVtbl->SetDescription(link, L"Arxiv PDF Translate");
    wchar_t ico[PATHBUF];
    swprintf(ico, PATHBUF, L"%s\\icons\\icon.ico", g_projectDir);
    link->lpVtbl->SetIconLocation(link, ico, 0);

    IPersistFile *pf = NULL;
    if (link->lpVtbl->QueryInterface(link, &IID_IPersistFile, (void **)&pf) == S_OK) {
        pf->lpVtbl->Save(pf, lnk, TRUE);
        pf->lpVtbl->Release(pf);
    }
    link->lpVtbl->Release(link);
}

/* ---- tray UI ----------------------------------------------------------- */
static HICON LoadAppIcon(void) {
    wchar_t ico[PATHBUF];
    swprintf(ico, PATHBUF, L"%s\\icons\\icon.ico", g_projectDir);
    HICON h = (HICON)LoadImageW(NULL, ico, IMAGE_ICON,
                                GetSystemMetrics(SM_CXSMICON),
                                GetSystemMetrics(SM_CYSMICON), LR_LOADFROMFILE);
    if (!h) { h = LoadIconW(NULL, IDI_APPLICATION); }
    return h;
}

static void UpdateTip(HWND hwnd) {
    (void)hwnd;
    BOOL up = IsServerUp();
    wchar_t tip[128];
    swprintf(tip, 128, L"Arxiv PDF Translate · %s（端口 %d）",
             up ? L"在线" : L"未启动", g_port);
    g_nid.uFlags = NIF_TIP;
    wcsncpy(g_nid.szTip, tip, 127);
    g_nid.szTip[127] = 0;
    Shell_NotifyIconW(NIM_MODIFY, &g_nid);
}

static void ShowMenu(HWND hwnd) {
    HMENU m = CreatePopupMenu();
    BOOL up = IsServerUp();
    AppendMenuW(m, MF_STRING, ID_OPENCONSOLE, L"打开控制台");
    AppendMenuW(m, MF_SEPARATOR, 0, NULL);
    AppendMenuW(m, MF_STRING | (up ? MF_GRAYED : 0), ID_START, L"启动服务");
    AppendMenuW(m, MF_STRING | (up ? 0 : MF_GRAYED), ID_STOP, L"停止服务");
    AppendMenuW(m, MF_STRING | (GetAutostart() ? MF_CHECKED : 0), ID_AUTO, L"开机自启");
    AppendMenuW(m, MF_SEPARATOR, 0, NULL);
    AppendMenuW(m, MF_STRING, ID_SHORTCUT, L"创建桌面快捷方式");
    AppendMenuW(m, MF_SEPARATOR, 0, NULL);
    AppendMenuW(m, MF_STRING, ID_EXIT, L"退出");

    POINT pt;
    GetCursorPos(&pt);
    SetForegroundWindow(hwnd);
    TrackPopupMenu(m, TPM_RIGHTBUTTON, pt.x, pt.y, 0, hwnd, NULL);
    DestroyMenu(m);
    PostMessageW(hwnd, WM_NULL, 0, 0);
}

static void DoExit(HWND hwnd) {
    KillTimer(hwnd, TIMER_ID);
    StopServer();
    Shell_NotifyIconW(NIM_DELETE, &g_nid);
    DestroyWindow(hwnd);
}

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_TRAYMSG:
        if (LOWORD(lParam) == WM_LBUTTONUP || LOWORD(lParam) == WM_LBUTTONDBLCLK) {
            OpenConsoleGuarded();
        } else if (LOWORD(lParam) == WM_RBUTTONUP || LOWORD(lParam) == WM_CONTEXTMENU) {
            ShowMenu(hwnd);
        }
        return 0;
    case WM_COMMAND:
        switch (LOWORD(wParam)) {
        case ID_OPENCONSOLE: OpenConsoleGuarded(); break;
        case ID_START:       StartServer(); UpdateTip(hwnd); break;
        case ID_STOP:        StopServer(); UpdateTip(hwnd); break;
        case ID_AUTO:        SetAutostart(!GetAutostart()); break;
        case ID_SHORTCUT:    CreateShortcut(); break;
        case ID_EXIT:        DoExit(hwnd); break;
        }
        return 0;
    case WM_APP_OPENCONSOLE:
        OpenConsoleGuarded();
        return 0;
    case WM_TIMER:
        UpdateTip(hwnd);
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE hPrev, LPWSTR lpCmdLine, int nCmdShow) {
    (void)hPrev;
    (void)lpCmdLine;
    (void)nCmdShow;

    ResolvePaths();

    if (!FileExistsW(g_serverScript)) {
        MessageBoxW(NULL,
                    L"未找到 server\\server.py。\n请确认启动器位于项目根目录的 launcher\\ 下。",
                    L"Arxiv PDF Translate", MB_ICONERROR | MB_OK);
        return 1;
    }

    int argc = 0;
    LPWSTR *argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    BOOL serverOnly = FALSE, trayOnly = FALSE;
    for (int i = 1; i < argc; i++) {
        if (!_wcsicmp(argv[i], L"--server")) { serverOnly = TRUE; }
        else if (!_wcsicmp(argv[i], L"--tray")) { trayOnly = TRUE; }
    }
    if (argv) { LocalFree(argv); }

    if (serverOnly) {
        StartServer();
        return 0;
    }

    HANDLE mutex = CreateMutexW(NULL, TRUE, MUTEX_NAME);
    if (mutex && GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND existing = FindWindowW(CLASS_NAME, NULL);
        if (existing) { PostMessageW(existing, WM_APP_OPENCONSOLE, 0, 0); }
        CloseHandle(mutex);
        return 0;
    }

    CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);

    WNDCLASSW wc;
    ZeroMemory(&wc, sizeof(wc));
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInst;
    wc.lpszClassName = CLASS_NAME;
    if (!RegisterClassW(&wc)) { return 1; }

    HWND hwnd = CreateWindowExW(0, CLASS_NAME, L"ArxivPdfTranslate",
                                WS_OVERLAPPED, 0, 0, 0, 0,
                                NULL, NULL, hInst, NULL);
    if (!hwnd) { return 1; }

    ZeroMemory(&g_nid, sizeof(g_nid));
    g_nid.cbSize = sizeof(NOTIFYICONDATAW);
    g_nid.hWnd = hwnd;
    g_nid.uID = 1;
    g_nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    g_nid.uCallbackMessage = WM_TRAYMSG;
    g_nid.hIcon = LoadAppIcon();
    wcsncpy(g_nid.szTip, L"Arxiv PDF Translate", 127);
    Shell_NotifyIconW(NIM_ADD, &g_nid);

    SetTimer(hwnd, TIMER_ID, 2500, NULL);

    StartServer();
    if (!trayOnly) {
        WaitForServerUp(9000);
        OpenConsole();
    }
    UpdateTip(hwnd);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    CoUninitialize();
    if (mutex) { CloseHandle(mutex); }
    return 0;
}
