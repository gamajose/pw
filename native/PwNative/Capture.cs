using System.Text.Json.Nodes;
using static PwNative.Win32;

namespace PwNative;

/// <summary>
/// Captura do próximo clique do usuário (para configurar cliques de presets).
/// O clique capturado é "engolido" para não ser executado no jogo. ESC cancela.
/// </summary>
internal static class Capture
{
    private static readonly object Gate = new();
    private static TaskCompletionSource<JsonObject?>? _tcs;
    private static IntPtr _restrictTo;
    private static volatile bool _swallowUp;

    public static bool Pending
    {
        get { lock (Gate) return _tcs != null; }
    }

    public static bool SwallowingUp => _swallowUp;

    public static JsonObject? Run(JsonObject args)
    {
        var tcs = new TaskCompletionSource<JsonObject?>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (Gate)
        {
            if (_tcs != null) throw new NativeException("BUSY", "Já existe uma captura em andamento.");
            _tcs = tcs;
            _restrictTo = (IntPtr)(args["hwnd"]?.GetValue<long>() ?? 0);
        }

        int timeout = args["timeoutMs"]?.GetValue<int>() ?? 30000;
        try
        {
            HookThread.RefreshInputHooks();
            if (_restrictTo != IntPtr.Zero && (args["focus"]?.GetValue<bool>() ?? true)) WindowOps.Focus(_restrictTo);
            if (!tcs.Task.Wait(timeout)) throw new NativeException("TIMEOUT", "Nenhum clique foi capturado a tempo.");
            return tcs.Task.Result ?? throw new NativeException("CANCELLED", "Captura cancelada.");
        }
        finally
        {
            lock (Gate) _tcs = null;
            HookThread.RefreshInputHooks();
        }
    }

    public static void Cancel()
    {
        lock (Gate) _tcs?.TrySetResult(null);
    }

    /// <summary>Chamado pelo hook de mouse. Retorna true para engolir o evento.</summary>
    public static bool OnMouse(uint msg, POINT screenPt)
    {
        bool up = msg == WM_LBUTTONUP || msg == WM_RBUTTONUP;
        if (up)
        {
            if (!_swallowUp) return false;
            _swallowUp = false;
            Task.Run(() => { try { HookThread.RefreshInputHooks(); } catch { } });
            return true;
        }

        TaskCompletionSource<JsonObject?>? tcs;
        IntPtr restrict;
        lock (Gate)
        {
            tcs = _tcs;
            restrict = _restrictTo;
        }
        if (tcs == null) return false;

        var h = Root(WindowFromPoint(screenPt));
        if (restrict != IntPtr.Zero && h != restrict) return false; // clique fora da janela alvo passa normalmente

        var local = screenPt;
        ScreenToClient(h, ref local);
        GetClientRect(h, out var r);
        int w = Math.Max(1, r.Right - r.Left), hh = Math.Max(1, r.Bottom - r.Top);
        if (local.X < 0 || local.Y < 0 || local.X >= w || local.Y >= hh) return false;

        _swallowUp = true;
        tcs.TrySetResult(new JsonObject
        {
            ["hwnd"] = h.ToInt64(),
            ["pid"] = GetPid(h),
            ["button"] = msg == WM_RBUTTONDOWN ? "right" : "left",
            ["x"] = local.X,
            ["y"] = local.Y,
            ["rx"] = Math.Round((double)local.X / w, 5),
            ["ry"] = Math.Round((double)local.Y / hh, 5),
            ["clientWidth"] = w,
            ["clientHeight"] = hh,
        });
        return true;
    }
}
