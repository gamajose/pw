using System.Runtime.InteropServices;
using static PwNative.Win32;

namespace PwNative;

/// <summary>
/// Envio de teclas e cliques.
///  - Post*: mensagens direto na fila da janela (funciona em segundo plano, não move o mouse real).
///  - Send*: SendInput (entrada "real"; exige a janela em primeiro plano).
/// </summary>
internal static class Input
{
    private static readonly int InputSize = Marshal.SizeOf<INPUT>();

    // ---------------- Mensagens (segundo plano) ----------------

    public static bool PostKey(IntPtr h, int vk, bool up) =>
        PostMessageW(h, up ? WM_KEYUP : WM_KEYDOWN, (IntPtr)vk, KeyLParam(vk, up));

    public static bool PostKeyPress(IntPtr h, int vk, int holdMs = 30)
    {
        bool ok = PostKey(h, vk, false);
        if (holdMs > 0) Thread.Sleep(holdMs);
        ok &= PostKey(h, vk, true);
        return ok;
    }

    public static bool PostChar(IntPtr h, char c) =>
        PostMessageW(h, WM_CHAR, (IntPtr)c, (IntPtr)1);

    /// <summary>Simula ativação da janela para servidores que ignoram cliques em janela inativa.</summary>
    public static void PostActivate(IntPtr h)
    {
        PostMessageW(h, WM_ACTIVATEAPP, (IntPtr)1, IntPtr.Zero);
        PostMessageW(h, WM_ACTIVATE, (IntPtr)WA_ACTIVE, IntPtr.Zero);
        PostMessageW(h, WM_SETFOCUS, IntPtr.Zero, IntPtr.Zero);
    }

    public static bool PostMouseMove(IntPtr h, int x, int y) =>
        PostMessageW(h, WM_MOUSEMOVE, IntPtr.Zero, MakeLParam(x, y));

    public static bool PostButton(IntPtr h, string button, bool up, int x, int y)
    {
        bool right = button == "right";
        uint msg = right ? (up ? WM_RBUTTONUP : WM_RBUTTONDOWN) : (up ? WM_LBUTTONUP : WM_LBUTTONDOWN);
        IntPtr wp = up ? IntPtr.Zero : (IntPtr)(right ? MK_RBUTTON : MK_LBUTTON);
        return PostMessageW(h, msg, wp, MakeLParam(x, y));
    }

    public static bool PostClick(IntPtr h, string button, int x, int y, bool activate, int holdMs = 40, bool dbl = false)
    {
        if (activate) PostActivate(h);
        bool ok = PostMouseMove(h, x, y);
        Thread.Sleep(10);
        ok &= PostButton(h, button, false, x, y);
        Thread.Sleep(holdMs);
        ok &= PostButton(h, button, true, x, y);
        if (dbl)
        {
            Thread.Sleep(60);
            ok &= PostButton(h, button, false, x, y);
            Thread.Sleep(holdMs);
            ok &= PostButton(h, button, true, x, y);
        }
        return ok;
    }

    /// <summary>Converte coordenadas relativas (0..1) para pixels da área cliente da janela.</summary>
    public static (int x, int y) FromRatio(IntPtr h, double rx, double ry)
    {
        GetClientRect(h, out var r);
        int w = Math.Max(1, r.Right - r.Left);
        int hh = Math.Max(1, r.Bottom - r.Top);
        int x = (int)Math.Round(Math.Clamp(rx, 0, 1) * (w - 1));
        int y = (int)Math.Round(Math.Clamp(ry, 0, 1) * (hh - 1));
        return (x, y);
    }

    // ---------------- SendInput (primeiro plano) ----------------

    public static uint SendVirtualKey(int vk, bool up)
    {
        uint flags = up ? KEYEVENTF_KEYUP : 0;
        if (IsExtendedKey(vk)) flags |= KEYEVENTF_EXTENDEDKEY;
        var input = new INPUT
        {
            type = INPUT_KEYBOARD,
            U = new InputUnion
            {
                ki = new KEYBDINPUT
                {
                    wVk = (ushort)vk,
                    wScan = (ushort)MapVirtualKeyW((uint)vk, MAPVK_VK_TO_VSC),
                    dwFlags = flags,
                }
            }
        };
        return SendInput(1, [input], InputSize);
    }

    public static bool SendVirtualKeyPress(int vk)
    {
        uint a = SendVirtualKey(vk, false);
        Thread.Sleep(20);
        uint b = SendVirtualKey(vk, true);
        return a == 1 && b == 1;
    }

    /// <summary>Digita um caractere Unicode via SendInput (não depende do layout do teclado).</summary>
    public static bool SendUnicodeChar(char c)
    {
        var down = new INPUT
        {
            type = INPUT_KEYBOARD,
            U = new InputUnion { ki = new KEYBDINPUT { wVk = 0, wScan = c, dwFlags = KEYEVENTF_UNICODE } }
        };
        var up = down;
        up.U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        return SendInput(2, [down, up], InputSize) == 2;
    }
}
