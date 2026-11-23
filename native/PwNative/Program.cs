using System.Text;
using System.Text.Json.Nodes;

namespace PwNative;

/// <summary>
/// Módulo nativo do PW Manager.
///
/// Protocolo (JSON por linha, UTF-8):
///   entrada (stdin):  {"id": 1, "cmd": "focus", "args": {"hwnd": 123}}
///   resposta (stdout): {"id": 1, "ok": true, "result": ...}
///                      {"id": 1, "ok": false, "code": "NOT_FOUND", "error": "mensagem"}
///   eventos (stdout):  {"event": "foreground", "data": {...}}
///
/// O processo termina quando o stdin é fechado (o PW Manager fechou).
/// </summary>
internal static class Program
{
    private static readonly object OutLock = new();
    private static TextWriter _out = Console.Out;
    private static int _inFlight;

    public static void Send(JsonObject obj)
    {
        var line = obj.ToJsonString();
        lock (OutLock)
        {
            _out.Write(line);
            _out.Write('\n');
            _out.Flush();
        }
    }

    public static void Emit(string name, JsonNode? data = null) =>
        Send(new JsonObject { ["event"] = name, ["data"] = data });

    private static async Task<int> Main()
    {
        var utf8 = new UTF8Encoding(false);
        Console.InputEncoding = utf8;
        _out = new StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = false, NewLine = "\n" };
        var stdin = new StreamReader(Console.OpenStandardInput(), utf8);

        HookThread.Start();
        Emit("ready", new JsonObject { ["version"] = "1.0.0", ["pid"] = Environment.ProcessId });

        string? line;
        while ((line = await stdin.ReadLineAsync()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var copy = line;
            Interlocked.Increment(ref _inFlight);
            _ = Task.Run(() =>
            {
                try { Handle(copy); }
                finally { Interlocked.Decrement(ref _inFlight); }
            });
        }

        // stdin fechado: dá um tempo para as respostas pendentes saírem.
        for (int i = 0; i < 40 && Volatile.Read(ref _inFlight) > 0; i++) await Task.Delay(50);
        PresetRunner.StopAll();
        HookThread.Stop();
        return 0;
    }

    private static void Handle(string line)
    {
        JsonNode? id = null;
        try
        {
            var req = JsonNode.Parse(line)?.AsObject() ?? throw new NativeException("BAD_REQUEST", "Requisição vazia");
            id = req["id"]?.DeepClone();
            var cmd = req["cmd"]?.GetValue<string>() ?? throw new NativeException("BAD_REQUEST", "Comando ausente");
            var args = req["args"] as JsonObject ?? new JsonObject();
            var result = Commands.Run(cmd, args);
            Send(new JsonObject { ["id"] = id, ["ok"] = true, ["result"] = result });
        }
        catch (NativeException ex)
        {
            Send(new JsonObject { ["id"] = id, ["ok"] = false, ["code"] = ex.Code, ["error"] = ex.Message });
        }
        catch (Exception ex)
        {
            Send(new JsonObject { ["id"] = id, ["ok"] = false, ["code"] = "FAILED", ["error"] = ex.Message });
        }
    }
}

/// <summary>Erro com código estável, traduzido para mensagem amigável no PW Manager.</summary>
internal sealed class NativeException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
