using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using static PwNative.Win32;

namespace PwNative;

/// <summary>Despacho dos comandos recebidos do PW Manager.</summary>
internal static class Commands
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern short VkKeyScanW(char ch);

    public static JsonNode? Run(string cmd, JsonObject a) => cmd switch
    {
        "ping" => "pong",

        // ----- janelas -----
        "list-windows" => ListWindows(a),
        "window-info" => WindowOps.Describe(WindowOps.RequireWindow(a)),
        "window-for-pid" => WindowForPid(a),
        "foreground" => Foreground(),
        "focus" => new JsonObject { ["focused"] = WindowOps.Focus(WindowOps.RequireWindow(a)) },
        "minimize" => Bool(ShowWindow(WindowOps.RequireWindow(a), SW_MINIMIZE)),
        "restore" => Bool(ShowWindow(WindowOps.RequireWindow(a), SW_RESTORE)),
        "hide" => Bool(ShowWindow(WindowOps.RequireWindow(a), SW_HIDE)),
        "show" => Bool(ShowWindow(WindowOps.RequireWindow(a), SW_SHOW)),
        "close" => Bool(PostMessageW(WindowOps.RequireWindow(a), WM_CLOSE, IntPtr.Zero, IntPtr.Zero)),
        "set-title" => Bool(SetWindowTextW(WindowOps.RequireWindow(a), a["title"]?.GetValue<string>() ?? "")),
        "move" => MoveWindow(a),
        "alive" => Alive(a),

        // ----- entrada -----
        "send-key" => SendKey(a),
        "click" => Click(a),
        "type-login" => TypeLogin(a),
        "capture-click" => Capture.Run(a),
        "cancel-capture" => CancelCapture(),

        // ----- sync action -----
        "sync-start" => Sync.Start(a),
        "sync-update" => Sync.Update(a),
        "sync-stop" => Sync.Stop(),
        "sync-pause" => Sync.SetPaused(a["paused"]?.GetValue<bool>() ?? true),
        "sync-state" => Sync.State(),

        // ----- presets -----
        "preset-run" => PresetRunner.Run(a),
        "preset-stop" => PresetRunner.Stop(a),
        "preset-list" => PresetRunner.List(),

        // ----- memória, câmera e métricas -----
        "read-memory" => ReadMemory(a),
        "read-equipment" => ReadEquipment(a),
        "align-camera" => AlignCamera(a),
        "process-metrics" => ProcessMetrics(a),

        _ => throw new NativeException("UNKNOWN_COMMAND", $"Comando desconhecido: {cmd}")
    };

    private static JsonObject ReadMemory(JsonObject a)
    {
        uint pid = a["pid"]?.GetValue<uint>() ?? 0;
        if (pid == 0) throw new NativeException("BAD_REQUEST", "PID inválido.");
        var config = a["config"] as JsonObject ?? new JsonObject();
        return MemoryOps.ReadStats(pid, config);
    }

    private static JsonObject ReadEquipment(JsonObject a)
    {
        uint pid = a["pid"]?.GetValue<uint>() ?? 0;
        if (pid == 0) throw new NativeException("BAD_REQUEST", "PID inválido.");
        var config = a["config"] as JsonObject ?? new JsonObject();
        return MemoryOps.ReadEquipment(pid, config);
    }

    private static JsonObject AlignCamera(JsonObject a)
    {
        uint leaderPid = a["leaderPid"]?.GetValue<uint>() ?? 0;
        var fArr = a["followerPids"] as JsonArray ?? [];
        var followerPids = fArr.Select(x => x?.GetValue<uint>() ?? 0).Where(x => x > 0).ToArray();
        var config = a["cameraConfig"] as JsonObject ?? new JsonObject();
        return MemoryOps.AlignCamera(leaderPid, followerPids, config);
    }

    private static JsonArray ProcessMetrics(JsonObject a)
    {
        var pArr = a["pids"] as JsonArray ?? [];
        var pids = pArr.Select(x => x?.GetValue<uint>() ?? 0).Where(x => x > 0).ToArray();
        return MemoryOps.GetMetrics(pids);
    }

    private static JsonObject Bool(bool ok) => new() { ["ok"] = ok };

    private static JsonArray ListWindows(JsonObject a)
    {
        string? name = a["processName"]?.GetValue<string>();
        var arr = new JsonArray();
        foreach (var h in WindowOps.AppWindows())
        {
            var d = WindowOps.Describe(h);
            if (name != null && !string.Equals((string?)d["processName"], name, StringComparison.OrdinalIgnoreCase)) continue;
            arr.Add(d);
        }
        return arr;
    }

    private static JsonNode? WindowForPid(JsonObject a)
    {
        uint pid = a["pid"]?.GetValue<uint>() ?? 0;
        int timeout = a["timeoutMs"]?.GetValue<int>() ?? 0;
        var sw = Stopwatch.StartNew();
        while (true)
        {
            var h = WindowOps.MainWindowOf(pid);
            if (h != IntPtr.Zero)
            {
                GetClientRect(h, out var r);
                // Ignora a janela enquanto ela ainda não tem tamanho (criação em andamento).
                if (r.Right - r.Left > 0 && r.Bottom - r.Top > 0) return WindowOps.Describe(h);
            }
            if (sw.ElapsedMilliseconds >= timeout) return null;
            try { if (Process.GetProcessById((int)pid).HasExited) return null; }
            catch (ArgumentException) { return null; } // processo não existe mais
            catch (System.ComponentModel.Win32Exception) { /* processo elevado: sem acesso, mas está vivo */ }
            catch (InvalidOperationException) { return null; }
            Thread.Sleep(250);
        }
    }

    private static JsonObject Foreground()
    {
        var h = Root(GetForegroundWindow());
        return new JsonObject { ["hwnd"] = h.ToInt64(), ["pid"] = GetPid(h) };
    }

    private static JsonObject MoveWindow(JsonObject a)
    {
        var h = WindowOps.RequireWindow(a);
        WindowOps.Move(h,
            a["x"]?.GetValue<int>() ?? 0, a["y"]?.GetValue<int>() ?? 0,
            a["width"]?.GetValue<int>() ?? 800, a["height"]?.GetValue<int>() ?? 600);
        return Bool(true);
    }

    private static JsonArray Alive(JsonObject a)
    {
        var arr = new JsonArray();
        foreach (var n in a["hwnds"] as JsonArray ?? [])
        {
            var h = (IntPtr)(n?.GetValue<long>() ?? 0);
            if (h != IntPtr.Zero && IsWindow(h)) arr.Add(h.ToInt64());
        }
        return arr;
    }

    private static IEnumerable<IntPtr> Hwnds(JsonObject a) =>
        (a["hwnds"] as JsonArray ?? [])
            .Select(n => (IntPtr)(n?.GetValue<long>() ?? 0))
            .Where(h => h != IntPtr.Zero && IsWindow(h));

    private static JsonObject SendKey(JsonObject a)
    {
        int vk = a["vk"]?.GetValue<int>() ?? 0;
        if (vk <= 0) throw new NativeException("INVALID_INPUT", "Tecla inválida.");
        int hold = a["holdMs"]?.GetValue<int>() ?? 30;
        int sent = 0;
        foreach (var h in Hwnds(a)) if (Input.PostKeyPress(h, vk, hold)) sent++;
        return new JsonObject { ["sent"] = sent };
    }

    private static JsonObject Click(JsonObject a)
    {
        string button = a["button"]?.GetValue<string>() ?? "left";
        double rx = a["rx"]?.GetValue<double>() ?? 0.5, ry = a["ry"]?.GetValue<double>() ?? 0.5;
        bool activate = a["activate"]?.GetValue<bool>() ?? false;
        bool dbl = a["double"]?.GetValue<bool>() ?? false;
        int sent = 0;
        foreach (var h in Hwnds(a))
        {
            var (x, y) = Input.FromRatio(h, rx, ry);
            if (Input.PostClick(h, button, x, y, activate, 40, dbl)) sent++;
        }
        return new JsonObject { ["sent"] = sent };
    }

    private static JsonObject CancelCapture()
    {
        Capture.Cancel();
        return Bool(true);
    }

    // ------------------------------------------------------------------
    // Digitação de login/senha na tela de login do jogo.
    // ------------------------------------------------------------------

    private static JsonObject TypeLogin(JsonObject a)
    {
        var h = WindowOps.RequireWindow(a);
        string login = a["login"]?.GetValue<string>() ?? "";
        string password = a["password"]?.GetValue<string>() ?? "";
        string method = a["method"]?.GetValue<string>() ?? "unicode"; // unicode | vk | post
        bool enter = a["enter"]?.GetValue<bool>() ?? true;
        int charDelay = Math.Clamp(a["charDelayMs"]?.GetValue<int>() ?? 15, 0, 500);
        var deadline = Stopwatch.StartNew();
        const int TimeoutMs = 30000;

        if (method == "vk")
            foreach (char c in login + password)
                if (VkKeyScanW(c) == -1) throw new NativeException("INVALID_INPUT", "O login ou a senha têm um caractere que não dá para digitar.");

        if (method == "post")
        {
            foreach (char c in login) { Check(h, false, deadline, TimeoutMs); if (!Input.PostChar(h, c)) throw new NativeException("POST_FAILED", "O jogo não aceitou as teclas enviadas."); Thread.Sleep(charDelay); }
            Input.PostKeyPress(h, VK_TAB);
            Thread.Sleep(60);
            foreach (char c in password) { Check(h, false, deadline, TimeoutMs); if (!Input.PostChar(h, c)) throw new NativeException("POST_FAILED", "O jogo não aceitou as teclas enviadas."); Thread.Sleep(charDelay); }
            if (enter) { Thread.Sleep(60); Input.PostKeyPress(h, VK_RETURN); }
            return Bool(true);
        }

        // Métodos de primeiro plano: esperar o usuário soltar os modificadores do atalho.
        var wait = Stopwatch.StartNew();
        while (AnyModifierDown())
        {
            if (wait.ElapsedMilliseconds > 2000) throw new NativeException("MODIFIERS_HELD", "Solte Ctrl, Shift, Alt e Win logo depois de apertar o atalho.");
            Thread.Sleep(25);
        }

        WindowOps.Focus(h);
        Thread.Sleep(150);
        IntPtr curFg = GetForegroundWindow();
        if (curFg != IntPtr.Zero && curFg != h)
        {
            GetWindowThreadProcessId(curFg, out uint fgPid);
            GetWindowThreadProcessId(h, out uint targetPid);
            if (fgPid != targetPid) throw new NativeException("NOT_FOREGROUND", "A janela do jogo não estava em primeiro plano. Clique nela e tente de novo.");
        }

        TypeForeground(h, login, method, charDelay, deadline, TimeoutMs);
        PressForeground(h, VK_TAB, deadline, TimeoutMs);
        Thread.Sleep(60);
        TypeForeground(h, password, method, charDelay, deadline, TimeoutMs);
        if (enter)
        {
            Thread.Sleep(60);
            PressForeground(h, VK_RETURN, deadline, TimeoutMs);
        }
        return Bool(true);
    }

    private static void Check(IntPtr h, bool needForeground, Stopwatch sw, int timeoutMs)
    {
        if (!IsWindow(h)) throw new NativeException("WINDOW_CLOSED", "A janela do jogo fechou no meio da digitação.");
        if (needForeground)
        {
            IntPtr fg = GetForegroundWindow();
            if (fg != IntPtr.Zero && Root(fg) != h)
            {
                GetWindowThreadProcessId(fg, out uint fgPid);
                GetWindowThreadProcessId(h, out uint targetPid);
                if (fgPid != targetPid) throw new NativeException("FOCUS_LOST", "A janela do jogo perdeu o foco no meio da digitação.");
            }
        }
        if (sw.ElapsedMilliseconds > timeoutMs) throw new NativeException("TIMEOUT", "A digitação demorou demais e foi cancelada.");
    }

    private static void PressForeground(IntPtr h, int vk, Stopwatch sw, int timeoutMs)
    {
        Check(h, true, sw, timeoutMs);
        if (!Input.SendVirtualKeyPress(vk) && !Input.PostKeyPress(h, vk))
            throw new NativeException("INPUT_BLOCKED", "O Windows bloqueou a digitação. O jogo pode estar aberto como administrador.");
    }

    private static void TypeForeground(IntPtr h, string text, string method, int charDelay, Stopwatch sw, int timeoutMs)
    {
        foreach (char c in text)
        {
            Check(h, true, sw, timeoutMs);
            bool ok;
            if (method == "vk")
            {
                short scan = VkKeyScanW(c);
                int vk = scan & 0xFF;
                int shiftState = (scan >> 8) & 0xFF;
                ok = true;
                if ((shiftState & 1) != 0) ok &= Input.SendVirtualKey(VK_SHIFT, false) == 1;
                if ((shiftState & 2) != 0) ok &= Input.SendVirtualKey(VK_CONTROL, false) == 1;
                if ((shiftState & 4) != 0) ok &= Input.SendVirtualKey(VK_MENU, false) == 1;
                ok &= Input.SendVirtualKeyPress(vk);
                if ((shiftState & 4) != 0) Input.SendVirtualKey(VK_MENU, true);
                if ((shiftState & 2) != 0) Input.SendVirtualKey(VK_CONTROL, true);
                if ((shiftState & 1) != 0) Input.SendVirtualKey(VK_SHIFT, true);
                if (!ok) ok = Input.PostChar(h, c);
            }
            else
            {
                ok = Input.SendUnicodeChar(c);
                if (!ok) ok = Input.PostChar(h, c);
            }
            if (!ok) throw new NativeException("INPUT_BLOCKED", "O Windows bloqueou a digitação. O jogo pode estar aberto como administrador.");
            if (charDelay > 0) Thread.Sleep(charDelay);
        }
    }
}
