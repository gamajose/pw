using System.Text;

namespace FakeClient;

/// <summary>
/// Cliente simulado para testar e demonstrar o PW Manager sem o jogo.
/// Recebe os mesmos argumentos do elementclient (startbypatcher user:... pwd:... role:...)
/// e mostra/registra todas as teclas, caracteres e cliques que chegam na janela.
/// Argumento opcional "log:CAMINHO" grava os eventos num arquivo.
/// </summary>
internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new GameForm(args));
    }
}

internal sealed class GameForm : Form
{
    private const int WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_CHAR = 0x0102;
    private const int WM_LBUTTONDOWN = 0x0201, WM_LBUTTONUP = 0x0202, WM_RBUTTONDOWN = 0x0204, WM_RBUTTONUP = 0x0205;

    private readonly List<string> _lines = new();
    private readonly string? _logFile;
    private readonly string _header;
    private readonly StringBuilder _typed = new();

    public GameForm(string[] args)
    {
        string Arg(string key) => args.FirstOrDefault(a => a.StartsWith(key + ":", StringComparison.OrdinalIgnoreCase))?[(key.Length + 1)..] ?? "";
        _logFile = Arg("log") is { Length: > 0 } l ? l : null;
        string role = Arg("role");
        _header = $"user={Arg("user")}  pwd={(Arg("pwd").Length > 0 ? new string('*', Arg("pwd").Length) : "(vazio)")}  role={(role == "" ? "(nenhum)" : role)}";

        Text = "Element Client (simulado)";
        ClientSize = new Size(800, 600);
        BackColor = Color.FromArgb(24, 28, 36);
        ForeColor = Color.Gainsboro;
        Font = new Font("Consolas", 10f);
        DoubleBuffered = true;
        StartPosition = FormStartPosition.WindowsDefaultLocation;
        Log($"START args=[{string.Join(" ", args.Where(a => !a.StartsWith("log:")).Select(a => a.StartsWith("pwd:") ? "pwd:***" : a))}]");
    }

    private void Log(string line)
    {
        _lines.Add($"{DateTime.Now:HH:mm:ss.fff} {line}");
        if (_lines.Count > 30) _lines.RemoveAt(0);
        if (_logFile != null)
        {
            // Vários clientes escrevem no mesmo arquivo: abre compartilhado e tenta de novo se estiver ocupado.
            var bytes = Encoding.UTF8.GetBytes($"{Environment.ProcessId} {line}\n");
            for (int attempt = 0; attempt < 20; attempt++)
            {
                try
                {
                    using var fs = new FileStream(_logFile, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
                    fs.Write(bytes);
                    break;
                }
                catch (IOException)
                {
                    Thread.Sleep(5);
                }
            }
        }
        Invalidate();
    }

    protected override void WndProc(ref Message m)
    {
        int lp = (int)(long)m.LParam;
        int x = (short)(lp & 0xFFFF), y = (short)((lp >> 16) & 0xFFFF);
        switch (m.Msg)
        {
            case WM_KEYDOWN: Log($"KEYDOWN {(Keys)(int)m.WParam} vk=0x{(int)m.WParam:X2}"); break;
            case WM_KEYUP: Log($"KEYUP {(Keys)(int)m.WParam}"); break;
            case WM_CHAR:
                char c = (char)(int)m.WParam;
                if (c == '\t') { Log($"TYPED-FIELD \"{_typed}\""); _typed.Clear(); }
                else if (c == '\r') { Log($"TYPED-FIELD \"{_typed}\""); Log("ENTER"); _typed.Clear(); }
                else if (!char.IsControl(c)) _typed.Append(c);
                break;
            case WM_LBUTTONDOWN: Log($"LDOWN {x},{y} (cliente {ClientSize.Width}x{ClientSize.Height})"); break;
            case WM_LBUTTONUP: Log($"LUP {x},{y}"); break;
            case WM_RBUTTONDOWN: Log($"RDOWN {x},{y}"); break;
            case WM_RBUTTONUP: Log($"RUP {x},{y}"); break;
        }
        base.WndProc(ref m);
    }

    // Tab/Enter devem chegar como teclas normais (como no jogo), não como navegação de formulário.
    protected override bool ProcessDialogKey(Keys keyData) =>
        keyData is Keys.Tab or Keys.Enter ? false : base.ProcessDialogKey(keyData);

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        using var title = new Font("Segoe UI", 14f, FontStyle.Bold);
        g.DrawString(Text, title, Brushes.White, 12, 10);
        g.DrawString(_header, Font, Brushes.LightSkyBlue, 12, 44);
        g.DrawString($"digitando: {_typed}", Font, Brushes.Khaki, 12, 66);
        float yy = 96;
        foreach (var line in _lines)
        {
            g.DrawString(line, Font, Brushes.Gainsboro, 12, yy);
            yy += 17;
        }
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        Invalidate();
    }
}
