using System.Diagnostics;
using System.Text.Json.Nodes;
using static PwNative.Win32;

namespace PwNative;

/// <summary>Operações sobre janelas de nível superior (listar, focar, mover, renomear).</summary>
internal static class WindowOps
{
    public static JsonObject Describe(IntPtr h)
    {
        GetWindowRect(h, out var wr);
        GetClientRect(h, out var cr);
        uint pid = GetPid(h);
        return new JsonObject
        {
            ["hwnd"] = h.ToInt64(),
            ["pid"] = pid,
            ["processName"] = ProcessName(pid),
            ["title"] = GetText(h),
            ["className"] = GetClass(h),
            ["minimized"] = IsIconic(h),
            ["visible"] = IsWindowVisible(h),
            ["x"] = wr.Left,
            ["y"] = wr.Top,
            ["width"] = wr.Right - wr.Left,
            ["height"] = wr.Bottom - wr.Top,
            ["clientWidth"] = cr.Right - cr.Left,
            ["clientHeight"] = cr.Bottom - cr.Top,
        };
    }

    public static string ProcessName(uint pid)
    {
        try
        {
            using var p = Process.GetProcessById((int)pid);
            return p.ProcessName + ".exe";
        }
        catch
        {
            return "";
        }
    }

    /// <summary>Janelas "de aplicativo": visíveis, sem dono e que não são tool windows.</summary>
    public static List<IntPtr> AppWindows(Func<IntPtr, uint, bool>? filter = null)
    {
        var list = new List<IntPtr>();
        EnumWindows((h, _) =>
        {
            if (!IsWindowVisible(h)) return true;
            if (GetWindow(h, 4 /* GW_OWNER */) != IntPtr.Zero) return true;
            long ex = GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64();
            if ((ex & WS_EX_TOOLWINDOW) != 0) return true;
            uint pid = GetPid(h);
            if (filter == null || filter(h, pid)) list.Add(h);
            return true;
        }, IntPtr.Zero);
        return list;
    }

    /// <summary>A maior janela visível do processo (ignora splash/caixas pequenas quando há a principal).</summary>
    public static IntPtr MainWindowOf(uint pid)
    {
        IntPtr best = IntPtr.Zero;
        long bestArea = -1;
        foreach (var h in AppWindows((_, p) => p == pid))
        {
            GetWindowRect(h, out var r);
            long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
            if (area > bestArea)
            {
                bestArea = area;
                best = h;
            }
        }
        return best;
    }

    public static IntPtr RequireWindow(JsonObject args)
    {
        var h = (IntPtr)(args["hwnd"]?.GetValue<long>() ?? 0);
        if (h == IntPtr.Zero || !IsWindow(h)) throw new NativeException("NOT_FOUND", "A janela do jogo não foi encontrada.");
        return h;
    }

    /// <summary>
    /// Traz a janela para o primeiro plano. O Windows restringe SetForegroundWindow,
    /// então anexamos a fila de entrada à da janela que está em foco no momento.
    /// </summary>
    public static bool Focus(IntPtr h)
    {
        if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
        if (GetForegroundWindow() == h) return true;

        // Um toque de ALT libera o "foreground lock" do Windows antes da chamada
        Input.SendVirtualKey(VK_MENU, false);
        Input.SendVirtualKey(VK_MENU, true);

        uint self = GetCurrentThreadId();
        IntPtr fgHwnd = GetForegroundWindow();
        uint fgThread = fgHwnd != IntPtr.Zero ? GetWindowThreadProcessId(fgHwnd, out _) : 0;
        uint targetThread = GetWindowThreadProcessId(h, out _);

        bool a1 = fgThread != 0 && fgThread != self && AttachThreadInput(self, fgThread, true);
        bool a2 = targetThread != 0 && targetThread != self && AttachThreadInput(self, targetThread, true);
        try
        {
            BringWindowToTop(h);
            ShowWindow(h, SW_SHOW);
            SetForegroundWindow(h);
        }
        finally
        {
            if (a1) AttachThreadInput(self, fgThread, false);
            if (a2) AttachThreadInput(self, targetThread, false);
        }

        for (int i = 0; i < 15 && GetForegroundWindow() != h; i++) Thread.Sleep(20);
        return GetForegroundWindow() == h;
    }

    public static void Move(IntPtr h, int x, int y, int w, int hgt)
    {
        if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
        SetWindowPos(h, IntPtr.Zero, x, y, w, hgt, SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
}
