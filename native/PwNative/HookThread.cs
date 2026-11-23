using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using static PwNative.Win32;

namespace PwNative;

/// <summary>
/// Thread dedicada com loop de mensagens Win32. Hospeda:
///  - hook de primeiro plano (avisa o PW Manager qual janela está em foco);
///  - hooks globais de teclado/mouse (Sync action e captura de clique).
/// Os callbacks precisam ser rápidos: o Windows remove hooks lentos (LowLevelHooksTimeout).
/// </summary>
internal static class HookThread
{
    private const uint WM_RUN_ACTIONS = WM_APP + 1;

    private static Thread? _thread;
    private static uint _threadId;
    private static readonly ManualResetEventSlim Ready = new(false);
    private static readonly ConcurrentQueue<Action> Actions = new();

    // Delegates mantidos em campos estáticos para o GC não coletá-los.
    private static readonly LowLevelProc KeyboardProc = OnKeyboard;
    private static readonly LowLevelProc MouseProc = OnMouse;
    private static readonly WinEventProc ForegroundProc = OnForeground;

    private static IntPtr _kbHook, _mouseHook, _fgHook;

    public static void Start()
    {
        _thread = new Thread(Loop) { IsBackground = true, Name = "pw-hooks" };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        Ready.Wait();
    }

    public static void Stop()
    {
        if (_threadId != 0) PostThreadMessageW(_threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
    }

    /// <summary>Executa uma ação na thread dos hooks (instalar/remover hooks precisa ser feito nela).</summary>
    public static void Invoke(Action action)
    {
        var done = new ManualResetEventSlim(false);
        Exception? error = null;
        Actions.Enqueue(() =>
        {
            try { action(); }
            catch (Exception ex) { error = ex; }
            finally { done.Set(); }
        });
        PostThreadMessageW(_threadId, WM_RUN_ACTIONS, IntPtr.Zero, IntPtr.Zero);
        if (!done.Wait(5000)) throw new NativeException("TIMEOUT", "A thread de hooks não respondeu.");
        if (error != null) throw error;
    }

    private static void Loop()
    {
        _threadId = GetCurrentThreadId();
        PeekMessageW(out _, IntPtr.Zero, 0, 0, 0); // cria a fila de mensagens da thread
        _fgHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, ForegroundProc, 0, 0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
        Ready.Set();

        while (GetMessageW(out var msg, IntPtr.Zero, 0, 0) > 0)
        {
            if (msg.hwnd == IntPtr.Zero && msg.message == WM_RUN_ACTIONS)
            {
                while (Actions.TryDequeue(out var a)) a();
                continue;
            }
            TranslateMessage(ref msg);
            DispatchMessageW(ref msg);
        }

        RemoveInputHooks();
        if (_fgHook != IntPtr.Zero) UnhookWinEvent(_fgHook);
    }

    // ------------------------------------------------------------------
    // Gerência dos hooks de entrada: só ficam instalados enquanto necessários.
    // ------------------------------------------------------------------

    public static void RefreshInputHooks()
    {
        bool needKeyboard = Sync.Active || Capture.Pending;
        bool needMouse = Sync.Active || Capture.Pending || Capture.SwallowingUp;
        Invoke(() =>
        {
            var mod = GetModuleHandleW(null);
            if (needKeyboard && _kbHook == IntPtr.Zero)
            {
                _kbHook = SetWindowsHookExW(WH_KEYBOARD_LL, KeyboardProc, mod, 0);
                if (_kbHook == IntPtr.Zero) throw new NativeException("HOOK_FAILED", $"Não foi possível instalar o hook de teclado ({Marshal.GetLastWin32Error()}).");
            }
            if (needMouse && _mouseHook == IntPtr.Zero)
            {
                _mouseHook = SetWindowsHookExW(WH_MOUSE_LL, MouseProc, mod, 0);
                if (_mouseHook == IntPtr.Zero) throw new NativeException("HOOK_FAILED", $"Não foi possível instalar o hook de mouse ({Marshal.GetLastWin32Error()}).");
            }
            if (!needKeyboard && _kbHook != IntPtr.Zero) { UnhookWindowsHookEx(_kbHook); _kbHook = IntPtr.Zero; }
            if (!needMouse && _mouseHook != IntPtr.Zero) { UnhookWindowsHookEx(_mouseHook); _mouseHook = IntPtr.Zero; }
        });
    }

    private static void RemoveInputHooks()
    {
        if (_kbHook != IntPtr.Zero) { UnhookWindowsHookEx(_kbHook); _kbHook = IntPtr.Zero; }
        if (_mouseHook != IntPtr.Zero) { UnhookWindowsHookEx(_mouseHook); _mouseHook = IntPtr.Zero; }
    }

    // ------------------------------------------------------------------
    // Callbacks
    // ------------------------------------------------------------------

    private static void OnForeground(IntPtr hook, uint evt, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
    {
        if (hwnd == IntPtr.Zero) return;
        var root = Root(hwnd);
        Program.Emit("foreground", new JsonObject { ["hwnd"] = root.ToInt64(), ["pid"] = GetPid(root) });
    }

    private static IntPtr OnKeyboard(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode == HC_ACTION)
        {
            try
            {
                var data = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
                bool injected = (data.flags & LLKHF_INJECTED) != 0;
                uint msg = (uint)wParam.ToInt64();
                bool down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;

                if (!injected && Capture.Pending && down && data.vkCode == VK_ESCAPE)
                {
                    Capture.Cancel();
                    return (IntPtr)1;
                }
                if (!injected && Sync.Active) Sync.OnKey((int)data.vkCode, down);
            }
            catch { /* nunca derrubar o hook */ }
        }
        return CallNextHookEx(_kbHook, nCode, wParam, lParam);
    }

    private static IntPtr OnMouse(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode == HC_ACTION)
        {
            try
            {
                var data = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(lParam);
                bool injected = (data.flags & LLMHF_INJECTED) != 0;
                uint msg = (uint)wParam.ToInt64();
                if (!injected && msg is WM_LBUTTONDOWN or WM_LBUTTONUP or WM_RBUTTONDOWN or WM_RBUTTONUP)
                {
                    if (Capture.Pending || Capture.SwallowingUp)
                    {
                        if (Capture.OnMouse(msg, data.pt)) return (IntPtr)1; // engole o clique capturado
                    }
                    else if (Sync.Active)
                    {
                        Sync.OnMouse(msg, data.pt);
                    }
                }
            }
            catch { /* nunca derrubar o hook */ }
        }
        return CallNextHookEx(_mouseHook, nCode, wParam, lParam);
    }
}
