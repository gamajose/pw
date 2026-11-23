using System.Text.Json.Nodes;
using static PwNative.Win32;

namespace PwNative;

/// <summary>
/// Sync action: repete nos outros membros do grupo o que o usuário faz no personagem em foco.
/// Teclas espelhadas: F1–F12, 0–9, A–Z, Tab e Espaço, sem Shift/Ctrl/Alt/Win.
/// Cliques (esquerdo/direito) são convertidos proporcionalmente ao tamanho de cada janela.
/// Eventos injetados (pelo próprio PW Manager ou outros programas) nunca são espelhados.
/// </summary>
internal static class Sync
{
    private sealed record Config(IntPtr[] Members, bool MirrorKeys, bool MirrorClicks, bool ChatPause, bool ClickActivation, HashSet<int> ExcludedVks);

    private static volatile Config? _cfg;
    private static volatile bool _paused;
    private static readonly HashSet<int> MirroredDown = new();
    private static readonly Dictionary<IntPtr, (int x, int y)> PendingUp = new();

    public static bool Active => _cfg != null;

    public static JsonObject Start(JsonObject args)
    {
        _cfg = Parse(args);
        _paused = false;
        lock (MirroredDown) MirroredDown.Clear();
        HookThread.RefreshInputHooks();
        return State();
    }

    public static JsonObject Update(JsonObject args)
    {
        if (_cfg == null) return State();
        _cfg = Parse(args);
        return State();
    }

    public static JsonObject Stop()
    {
        _cfg = null;
        _paused = false;
        HookThread.RefreshInputHooks();
        return State();
    }

    public static JsonObject SetPaused(bool paused)
    {
        _paused = paused;
        Program.Emit("sync-paused", new JsonObject { ["paused"] = _paused });
        return State();
    }

    public static JsonObject State()
    {
        var c = _cfg;
        var arr = new JsonArray();
        if (c != null) foreach (var m in c.Members) arr.Add(m.ToInt64());
        return new JsonObject { ["active"] = c != null, ["paused"] = _paused, ["members"] = arr };
    }

    private static Config Parse(JsonObject a)
    {
        var members = (a["members"] as JsonArray ?? [])
            .Select(n => (IntPtr)(n?.GetValue<long>() ?? 0))
            .Where(h => h != IntPtr.Zero)
            .Distinct()
            .ToArray();
        var excluded = new HashSet<int>((a["excludeVks"] as JsonArray ?? []).Select(n => n?.GetValue<int>() ?? 0));
        string mode = a["mode"]?.GetValue<string>() ?? "keys";
        return new Config(
            members,
            MirrorKeys: mode == "keys",
            MirrorClicks: true,
            ChatPause: a["chatPause"]?.GetValue<bool>() ?? true,
            ClickActivation: a["clickActivation"]?.GetValue<bool>() ?? false,
            ExcludedVks: excluded);
    }

    private static bool IsMirroredKey(int vk) =>
        (vk >= 0x70 && vk <= 0x7B) ||   // F1–F12
        (vk >= 0x30 && vk <= 0x39) ||   // 0–9
        (vk >= 0x41 && vk <= 0x5A) ||   // A–Z
        vk == VK_TAB || vk == VK_SPACE;

    // ---------------- Teclado ----------------

    public static void OnKey(int vk, bool down)
    {
        var c = _cfg;
        if (c == null) return;

        var source = Root(GetForegroundWindow());
        if (Array.IndexOf(c.Members, source) < 0) return;

        if (c.ChatPause && down)
        {
            if (vk == VK_RETURN)
            {
                SetPaused(!_paused);
                return;
            }
            if (vk == VK_ESCAPE && _paused)
            {
                SetPaused(false);
                return;
            }
        }

        if (!c.MirrorKeys || !IsMirroredKey(vk) || c.ExcludedVks.Contains(vk)) return;

        lock (MirroredDown)
        {
            if (down)
            {
                if (_paused || AnyModifierDown()) return;
                MirroredDown.Add(vk);
            }
            else if (!MirroredDown.Remove(vk))
            {
                return; // o "down" desta tecla não foi espelhado
            }
        }

        foreach (var m in c.Members)
        {
            if (m == source || !IsWindow(m)) continue;
            if ((vk == VK_TAB || vk == VK_SPACE) && IsIconic(m)) continue;
            Input.PostKey(m, vk, !down);
        }
    }

    // ---------------- Mouse ----------------

    public static void OnMouse(uint msg, POINT screenPt)
    {
        var c = _cfg;
        if (c == null || !c.MirrorClicks) return;

        bool up = msg == WM_LBUTTONUP || msg == WM_RBUTTONUP;
        string button = (msg == WM_RBUTTONDOWN || msg == WM_RBUTTONUP) ? "right" : "left";

        if (up)
        {
            // Solta o botão nas mesmas coordenadas usadas no "down".
            Dictionary<IntPtr, (int x, int y)> targets;
            lock (PendingUp)
            {
                targets = new(PendingUp);
                PendingUp.Clear();
            }
            foreach (var (h, p) in targets)
                if (IsWindow(h)) Input.PostButton(h, button, true, p.x, p.y);
            return;
        }

        var source = Root(WindowFromPoint(screenPt));
        if (Array.IndexOf(c.Members, source) < 0) return;

        var local = screenPt;
        ScreenToClient(source, ref local);
        GetClientRect(source, out var sr);
        int sw = Math.Max(1, sr.Right - sr.Left), sh = Math.Max(1, sr.Bottom - sr.Top);
        if (local.X < 0 || local.Y < 0 || local.X >= sw || local.Y >= sh) return; // clique na borda/título
        double rx = (double)local.X / sw, ry = (double)local.Y / sh;

        lock (PendingUp)
        {
            PendingUp.Clear();
            foreach (var m in c.Members)
            {
                if (m == source || !IsWindow(m)) continue;
                var (x, y) = Input.FromRatio(m, rx, ry);
                if (c.ClickActivation) Input.PostActivate(m);
                Input.PostMouseMove(m, x, y);
                Input.PostButton(m, button, false, x, y);
                PendingUp[m] = (x, y);
            }
        }
    }
}
