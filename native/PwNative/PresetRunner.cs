using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using static PwNative.Win32;

namespace PwNative;

/// <summary>
/// Executa presets (sequências de teclas, cliques e esperas) em segundo plano.
/// O PW Manager já envia os passos com as janelas-alvo resolvidas (hwnds).
/// Cada execução tem um runId e pode ser cancelada.
/// </summary>
internal static class PresetRunner
{
    private static readonly ConcurrentDictionary<string, CancellationTokenSource> Running = new();

    public static JsonObject Run(JsonObject args)
    {
        string runId = args["runId"]?.GetValue<string>() ?? Guid.NewGuid().ToString("N");
        var steps = (args["steps"] as JsonArray ?? []).Select(s => s!.AsObject()).ToList();
        int perTargetDelay = args["perTargetDelayMs"]?.GetValue<int>() ?? 0;
        int repeat = args["repeat"]?.GetValue<int>() ?? 1;
        int repeatDelay = args["repeatDelayMs"]?.GetValue<int>() ?? 0;
        if (steps.Count == 0) throw new NativeException("INVALID_INPUT", "O preset não tem comandos.");

        var cts = new CancellationTokenSource();
        if (!Running.TryAdd(runId, cts)) throw new NativeException("BUSY", "Este preset já está em execução.");

        _ = Task.Run(async () =>
        {
            string? error = null;
            try
            {
                for (int i = 0; repeat <= 0 || i < repeat; i++)
                {
                    foreach (var step in steps)
                    {
                        cts.Token.ThrowIfCancellationRequested();
                        await RunStep(step, perTargetDelay, cts.Token);
                    }
                    if (repeatDelay > 0 && (repeat <= 0 || i < repeat - 1)) await Task.Delay(repeatDelay, cts.Token);
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception ex) { error = ex.Message; }
            finally
            {
                Running.TryRemove(runId, out _);
                Program.Emit("preset-finished", new JsonObject
                {
                    ["runId"] = runId,
                    ["cancelled"] = cts.IsCancellationRequested,
                    ["error"] = error,
                });
                cts.Dispose();
            }
        });

        return new JsonObject { ["runId"] = runId };
    }

    public static JsonObject Stop(JsonObject args)
    {
        string? runId = args["runId"]?.GetValue<string>();
        int count = 0;
        foreach (var (id, cts) in Running)
        {
            if (runId != null && id != runId) continue;
            try { cts.Cancel(); count++; } catch (ObjectDisposedException) { }
        }
        return new JsonObject { ["stopped"] = count };
    }

    public static void StopAll() => Stop(new JsonObject());

    public static JsonArray List() => new(Running.Keys.Select(k => (JsonNode)k).ToArray());

    private static IEnumerable<IntPtr> Targets(JsonObject step) =>
        (step["hwnds"] as JsonArray ?? [])
            .Select(n => (IntPtr)(n?.GetValue<long>() ?? 0))
            .Where(h => h != IntPtr.Zero && IsWindow(h));

    private static async Task RunStep(JsonObject step, int perTargetDelay, CancellationToken ct)
    {
        string type = step["type"]?.GetValue<string>() ?? "";
        switch (type)
        {
            case "delay":
                await Task.Delay(Math.Max(0, step["ms"]?.GetValue<int>() ?? 0), ct);
                break;

            case "key":
            {
                int vk = step["vk"]?.GetValue<int>() ?? 0;
                int hold = step["holdMs"]?.GetValue<int>() ?? 30;
                if (vk <= 0) throw new NativeException("INVALID_INPUT", "Tecla inválida no preset.");
                bool first = true;
                foreach (var h in Targets(step))
                {
                    if (!first && perTargetDelay > 0) await Task.Delay(perTargetDelay, ct);
                    first = false;
                    Input.PostKeyPress(h, vk, hold);
                }
                break;
            }

            case "click":
            {
                string button = step["button"]?.GetValue<string>() ?? "left";
                double rx = step["rx"]?.GetValue<double>() ?? 0.5;
                double ry = step["ry"]?.GetValue<double>() ?? 0.5;
                bool activate = step["activate"]?.GetValue<bool>() ?? false;
                bool dbl = step["double"]?.GetValue<bool>() ?? false;
                bool first = true;
                foreach (var h in Targets(step))
                {
                    if (!first && perTargetDelay > 0) await Task.Delay(perTargetDelay, ct);
                    first = false;
                    var (x, y) = Input.FromRatio(h, rx, ry);
                    Input.PostClick(h, button, x, y, activate, 40, dbl);
                }
                break;
            }

            case "focus":
            {
                var h = Targets(step).FirstOrDefault();
                if (h != IntPtr.Zero) WindowOps.Focus(h);
                break;
            }

            default:
                throw new NativeException("INVALID_INPUT", $"Tipo de comando desconhecido: {type}");
        }
    }
}
